-- ==============================================================================
-- 20260510_SYNC_PASSENGER_CANCELLATION_ELITE.sql
-- Sincronización de Cancelación de Pasajero con Estándar Elite V3
-- Soporta: Multi-plazas, Reembolso Parcial, Tesorería y Notificaciones Unificadas.
-- ==============================================================================

-- 0. Limpieza para cambio de JSON a JSONB
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid);

CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price NUMERIC;
    v_seats_booked INTEGER;
    v_total_paid NUMERIC;
    v_refund_amount NUMERIC;
    v_penalty_amount NUMERIC;
    v_refund_percent NUMERIC;
    v_hours_until_departure NUMERIC;
    v_status_msg TEXT;
    v_driver_id UUID;
    v_passenger_name TEXT;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- 1. Bloqueo de seguridad (FOR UPDATE)
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.status NOT IN ('scheduled', 'active') THEN
        RETURN jsonb_build_object('success', false, 'message', 'El viaje ya no permite cancelaciones (Estado actual: ' || v_ride_record.status || ')');
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- 2. Localizar al pasajero y sus datos de reserva
    SELECT p INTO v_passenger_entry
    FROM jsonb_array_elements(v_ride_record.passengers) AS p
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' = 'confirmed';

    IF v_passenger_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No tienes una reserva confirmada activa');
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::NUMERIC;
    v_seats_booked := COALESCE((v_passenger_entry->>'seats_booked')::INTEGER, (v_passenger_entry->>'num_seats')::INTEGER, 1);
    v_total_paid := v_booked_price * v_seats_booked;

    v_passenger_name := COALESCE(
        v_passenger_entry->>'displayName',
        (SELECT full_name FROM public.profiles WHERE id = v_passenger_id),
        'Un pasajero'
    );

    -- 3. Lógica de Reembolso Fair Play (Elite Standard)
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    IF v_hours_until_departure > 24 THEN
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total (>24h antelación)';
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_percent := 0.5;
        v_status_msg := 'Reembolso 50% (Cancelación tardía)';
    ELSE
        v_refund_percent := 0.0;
        v_status_msg := 'Sin reembolso (<2h para la salida)';
    END IF;

    -- Proteccion: si el conductor nunca inició el viaje y ya pasó la hora
    IF v_hours_until_departure < 0 AND v_ride_record.status = 'scheduled' THEN
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total por demora del conductor';
    END IF;

    v_refund_amount := v_total_paid * v_refund_percent;
    v_penalty_amount := v_total_paid - v_refund_amount;

    -- 4. Ejecución Financiera Atómica
    -- A. Liberar dinero del pasajero (Held -> Balance)
    UPDATE public.wallets
    SET held_balance = GREATEST(0, held_balance - v_total_paid),
        balance = balance + v_refund_amount,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- B. Si hay multa, mover a Tesorería
    IF v_penalty_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_penalty_amount,
            updated_at = NOW()
        WHERE user_id = v_treasury_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_treasury_id, v_penalty_amount, 'fee', 'Multa cancelación pasajero: ' || v_passenger_id, p_ride_id);
    END IF;

    -- C. Registrar devolución al pasajero
    IF v_refund_amount > 0 THEN
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_passenger_id, v_refund_amount, 'refund', v_status_msg, p_ride_id);
    END IF;

    -- 5. Notificaciones Unificadas (create_notification)
    -- Al Conductor
    PERFORM public.create_notification(
        v_driver_id,
        'passenger_cancelled',
        'Baja en tu viaje',
        v_passenger_name || ' ha cancelado su reserva (' || v_seats_booked || ' plazas).',
        jsonb_build_object('ride_id', p_ride_id, 'seats_recovered', v_seats_booked)
    );

    -- Al Pasajero (Confirmación)
    PERFORM public.create_notification(
        v_passenger_id,
        'booking_cancelled',
        'Reserva Cancelada',
        'Has cancelado tu reserva. ' || v_status_msg,
        jsonb_build_object('ride_id', p_ride_id, 'refund', v_refund_amount)
    );

    -- 6. Actualización de Ride y Recuperación de Plazas
    UPDATE public.rides
    SET
        seats_available = seats_available + v_seats_booked,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id AND p->>'status' = 'confirmed' THEN
                        p || jsonb_build_object(
                            'status', 'cancelled',
                            'cancelled_at', NOW(),
                            'refund_amount', v_refund_amount,
                            'penalty_amount', v_penalty_amount
                        )
                    ELSE p
                END
            )
            FROM jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p
        ),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', v_status_msg,
        'refunded', v_refund_amount,
        'penalty', v_penalty_amount,
        'seats_recovered', v_seats_booked
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
