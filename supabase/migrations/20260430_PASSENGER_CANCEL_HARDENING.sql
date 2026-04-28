-- ==============================================================================
-- 20260430_PASSENGER_CANCEL_HARDENING.sql
-- Propósito: Garantizar integridad en reembolsos y notificar al conductor.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
    v_refund_amount DECIMAL;
    v_penalty_amount DECIMAL;
    v_refund_percent DECIMAL;
    v_hours_until_departure DECIMAL;
    v_status_msg TEXT;
    v_driver_id UUID;
    v_passenger_name TEXT;
BEGIN
    -- 1. Bloqueo de fila para evitar condiciones de carrera (Race Conditions)
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- 2. Validar que el pasajero tenga una reserva CONFIRMADA (evita doble reembolso)
    SELECT p INTO v_passenger_entry
    FROM jsonb_array_elements(v_ride_record.passengers) AS p
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' = 'confirmed';

    IF v_passenger_entry IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No tienes una reserva confirmada para cancelar');
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    v_passenger_name := COALESCE(v_passenger_entry->>'displayName', 'Un pasajero');

    -- 3. Lógica de Reembolso por Tramos
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    IF v_hours_until_departure > 24 THEN
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total (antelación > 24h)';
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_percent := 0.5;
        v_status_msg := 'Reembolso del 50% (cancelación tardía)';
    ELSE
        v_refund_percent := 0.0;
        v_status_msg := 'Sin reembolso (menos de 2h)';
    END IF;

    -- Caso especial: Si el viaje ya pasó o está en curso y el pasajero cancela,
    -- asumimos que el conductor no inició el viaje a tiempo. (Opcional, depende de política)
    IF v_hours_until_departure < 0 THEN
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total por incumplimiento de horario';
    END IF;

    v_refund_amount := v_booked_price * v_refund_percent;
    v_penalty_amount := v_booked_price - v_refund_amount;

    -- 4. Actualización Financiera
    UPDATE public.wallets
    SET held_balance = GREATEST(0, held_balance - v_booked_price),
        balance = balance + v_refund_amount,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- 5. Registro de Transacciones
    IF v_refund_amount > 0 THEN
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_passenger_id, v_refund_amount, 'refund', v_status_msg, p_ride_id);
    END IF;

    -- 6. Notificar al Conductor (Crucial para UX)
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
        v_driver_id,
        'passenger_cancelled',
        'Baja en tu viaje',
        v_passenger_name || ' ha cancelado su reserva. Se ha liberado un asiento.'
    );

    -- 7. Actualizar el Viaje y Liberar Asiento
    UPDATE public.rides
    SET
        seats_available = seats_available + 1,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id THEN
                        p || jsonb_build_object('status', 'cancelled', 'cancelled_at', NOW(), 'refund_processed', v_refund_amount)
                    ELSE p
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        ),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', v_status_msg,
        'refunded', v_refund_amount
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
