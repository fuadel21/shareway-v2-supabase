-- ==============================================================================
-- FAIR-PLAY CANCELLATIONS: EQUILIBRIO Y PROTECCIÓN ANTIFRAUDE
-- ==============================================================================

-- 1. REFACTOR: cancel_booking_and_refund (Pasajero cancela)
-- Ahora compensa al conductor en cancelaciones tardías
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund_v2(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
    v_refund_amount DECIMAL;
    v_driver_compensation DECIMAL := 0;
    v_hours_until_departure DECIMAL;
    v_status_msg TEXT;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    SELECT p INTO v_passenger_entry
    FROM jsonb_array_elements(v_ride_record.passengers) AS p
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' = 'confirmed';

    IF v_passenger_entry IS NULL THEN RAISE EXCEPTION 'RESERVA_NO_ENCONTRADA'; END IF;
    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- LÓGICA DE REEMBOLSO Y COMPENSACIÓN
    IF v_hours_until_departure > 24 THEN
        v_refund_amount := v_booked_price;
        v_status_msg := 'Reembolso total (+24h)';
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_amount := v_booked_price * 0.5;
        v_driver_compensation := v_booked_price * 0.3; -- El conductor recibe un 30% por el hueco dejado
        v_status_msg := 'Reembolso 50% + Compensación a conductor';
    ELSE
        v_refund_amount := 0;
        v_driver_compensation := v_booked_price * 0.8; -- El conductor recibe el 80% (casi todo)
        v_status_msg := 'Sin reembolso. Compensación mayor al conductor por cancelación de última hora.';
    END IF;

    -- PROCESAR DINERO
    -- A. Devolver al pasajero
    UPDATE public.wallets SET
        held_balance = held_balance - v_booked_price,
        balance = balance + v_refund_amount,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- B. Pagar al conductor si aplica
    IF v_driver_compensation > 0 THEN
        UPDATE public.wallets SET
            balance = balance + v_driver_compensation,
            updated_at = NOW()
        WHERE user_id = v_ride_record.driver_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_ride_record.driver_id, v_driver_compensation, 'compensation', 'Compensación por cancelación de pasajero', p_ride_id);
    END IF;

    -- C. Actualizar Viaje
    UPDATE public.rides SET
        seats_available = seats_available + 1,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = v_passenger_id THEN p || jsonb_build_object('status', 'cancelled', 'refunded', v_refund_amount) ELSE p END)
            FROM jsonb_array_elements(v_ride_record.passengers) p
        )
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'refunded', v_refund_amount, 'driver_paid', v_driver_compensation);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. NUEVA FUNCIÓN: cancel_ride_by_driver (Conductor cancela)
-- Protege al pasajero y penaliza al conductor
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID, p_reason TEXT)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger RECORD;
    v_hours_until_departure DECIMAL;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;

    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- 1. REEMBOLSO TOTAL E INMEDIATO A TODOS LOS PASAJEROS
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) AS p WHERE p->>'status' = 'confirmed' LOOP
        UPDATE public.wallets SET
            held_balance = held_balance - (v_passenger.value->>'booked_price')::DECIMAL,
            balance = balance + (v_passenger.value->>'booked_price')::DECIMAL,
            updated_at = NOW()
        WHERE user_id = (v_passenger.value->>'id')::UUID;

        INSERT INTO public.notifications (user_id, type, title, body)
        VALUES ((v_passenger.value->>'id')::UUID, 'ride_cancelled', 'Viaje Cancelado por Conductor', 'El conductor ha cancelado el viaje. Se ha reembolsado el 100% de tu pago.');
    END LOOP;

    -- 2. PENALIZACIÓN DE REPUTACIÓN AL CONDUCTOR
    IF v_hours_until_departure < 2 THEN
        UPDATE public.profiles SET
            rating = GREATEST(1.0, rating - 0.5), -- Golpe duro a la reputación
            trust_score = GREATEST(0, trust_score - 20)
        WHERE id = v_driver_id;
    END IF;

    -- 3. MARCAR VIAJE COMO CANCELADO
    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado y pasajeros reembolsados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
