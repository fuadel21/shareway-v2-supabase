-- ==============================================================================
-- 20260430_PASSENGER_NO_SHOW_ELITE.sql
-- Propósito: Manejar pasajeros que no se presentan, protegiendo al conductor.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(
    p_ride_id UUID,
    p_passenger_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
    v_passenger_name TEXT;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
    v_platform_fee_percent DECIMAL := 0.20; -- 20% comisión plataforma
    v_driver_payout DECIMAL;
    v_platform_fee DECIMAL;
BEGIN
    -- 1. Validar que quien reporta es el conductor
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'No tienes permiso para reportar este no-show');
    END IF;

    -- 2. Localizar al pasajero y validar su estado (solo confirmados pueden ser no-show)
    SELECT p INTO v_passenger_entry
    FROM jsonb_array_elements(v_ride_record.passengers) AS p
    WHERE (p->>'id')::UUID = p_passenger_id AND p->>'status' = 'confirmed';

    IF v_passenger_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'El pasajero no tiene una reserva confirmada');
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    v_passenger_name := COALESCE(v_passenger_entry->>'displayName', 'Pasajero');

    -- 3. PROCESO FINANCIERO (Compensación al Conductor)
    -- El pasajero pierde el 100% del pago por no presentarse.
    -- Se reparte entre el Conductor y la Plataforma.
    v_platform_fee := ROUND(v_booked_price * v_platform_fee_percent, 2);
    v_driver_payout := v_booked_price - v_platform_fee;

    -- A. Sacar de escrow (held_balance) del pasajero
    UPDATE public.wallets
    SET held_balance = GREATEST(0, held_balance - v_booked_price),
        updated_at = NOW()
    WHERE user_id = p_passenger_id;

    -- B. Pagar al Conductor
    UPDATE public.wallets
    SET balance = balance + v_driver_payout,
        updated_at = NOW()
    WHERE user_id = v_driver_id;

    -- C. Comisión a Tesorería
    UPDATE public.wallets
    SET balance = balance + v_platform_fee,
        updated_at = NOW()
    WHERE user_id = v_treasury_id;

    -- 4. REGISTRAR TRANSACCIONES
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (p_passenger_id, -v_booked_price, 'penalty', 'Cargo por No-Show (No presentado al viaje)', p_ride_id);

    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_driver_id, v_driver_payout, 'payout', 'Compensación por No-Show de pasajero: ' || v_passenger_name, p_ride_id);

    -- 5. PENALIZAR REPUTACIÓN DEL PASAJERO
    UPDATE public.profiles
    SET trust_score = GREATEST(0, trust_score - 15), -- Pierde 15 puntos de confianza
        updated_at = NOW()
    WHERE id = p_passenger_id;

    -- 6. ACTUALIZAR ESTADO DEL PASAJERO EN EL VIAJE
    UPDATE public.rides
    SET passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN
                        p || jsonb_build_object('status', 'no_show', 'reported_at', NOW(), 'compensation_paid', v_driver_payout)
                    ELSE p
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        ),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- 7. NOTIFICACIONES
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (p_passenger_id, 'no_show_penalty', 'Reporte de No-Show', 'Has sido reportado por no presentarte al viaje. Se ha aplicado el cargo correspondiente.');

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Pasajero marcado como No-Show. Se ha procesado tu compensación.',
        'payout', v_driver_payout
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
