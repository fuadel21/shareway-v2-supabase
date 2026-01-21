-- ==========================================
-- SCRIPT DE SEGURIDAD: RED TEAMING FIXES
-- ==========================================
-- 1. Evita doble reembolso por concurrencia
-- 2. Evita completar viajes antes de tiempo
-- ==========================================

-- 1. CORRECCIÓN: cancel_booking_and_refund (Race Condition)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(
    p_ride_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_departure_time TIMESTAMPTZ;
    v_passengers JSONB;
    v_new_passengers JSONB;
    v_refund_amount DECIMAL;
    v_refund_percentage INTEGER;
    v_hours_until_departure FLOAT;
    v_driver_id UUID;
    v_penalty_amount DECIMAL;
    v_driver_compensation DECIMAL := 0;
    v_booked_at TIMESTAMPTZ;
    v_minutes_since_booking FLOAT;
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- BLOQUEO PESIMISTA: For Update
    -- Esto evita que dos peticiones lean el pasajero y reembolsen a la vez
    SELECT driver_id, departure_time, passengers
    INTO v_driver_id, v_departure_time, v_passengers
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled'
    FOR UPDATE; 
    
    IF v_passengers IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe o no puede ser cancelado';
    END IF;
    
    -- Buscar datos específicos de la reserva del pasajero
    SELECT 
        (passenger->>'booked_price')::DECIMAL,
        (passenger->>'booked_at')::TIMESTAMPTZ
    INTO v_booked_price, v_booked_at
    FROM jsonb_array_elements(v_passengers) AS passenger
    WHERE (passenger->>'id')::UUID = v_passenger_id;

    IF v_booked_price IS NULL THEN
        RAISE EXCEPTION 'No tienes una reserva en este viaje';
    END IF;
    
    -- LÓGICA DE REEMBOLSO
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_departure_time - NOW())) / 3600;
    v_minutes_since_booking := EXTRACT(EPOCH FROM (NOW() - v_booked_at)) / 60;

    -- Regla de Oro: Periodo de gracia de 15 min si el viaje no es inminente (< 3h)
    IF v_minutes_since_booking <= 15 AND v_hours_until_departure > 3 THEN
        v_refund_percentage := 100;
        v_refund_amount := v_booked_price;
    ELSIF v_hours_until_departure > 24 THEN
        v_refund_percentage := 100;
        v_refund_amount := v_booked_price;
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_percentage := 50;
        v_refund_amount := ROUND(v_booked_price * 0.5, 2);
    ELSE
        -- Menos de 2 horas o ya pasado el tiempo: Sin reembolso
        v_refund_percentage := 0;
        v_refund_amount := 0;
    END IF;

    -- LÓGICA DE COMPENSACIÓN AL CONDUCTOR
    v_penalty_amount := v_booked_price - v_refund_amount;
    
    -- Remover al pasajero del array (en memoria)
    SELECT jsonb_agg(passenger)
    INTO v_new_passengers
    FROM jsonb_array_elements(v_passengers) AS passenger
    WHERE (passenger->>'id')::UUID != v_passenger_id;
    
    -- 1. Procesar Reembolso al Pasajero
    IF v_refund_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_refund_amount,
            held_balance = held_balance - v_booked_price
        WHERE user_id = v_passenger_id;
    ELSE
         UPDATE public.wallets
         SET held_balance = held_balance - v_booked_price
         WHERE user_id = v_passenger_id;
    END IF;
    
    -- Transacción Pasajero
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'refund', v_refund_amount, balance, 
           'Reembolso (' || v_refund_percentage || '%) por cancelación del pasajero', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;

    -- 2. Compensación Conductor
    IF v_penalty_amount > 0 THEN
        v_driver_compensation := ROUND(v_penalty_amount * 0.8, 2);
        
        UPDATE public.wallets
        SET balance = balance + v_driver_compensation
        WHERE user_id = v_driver_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
        SELECT id, user_id, 'cancellation_compensation', v_driver_compensation, balance, 
               'Compensación por cancelación tardía de pasajero', p_ride_id
        FROM public.wallets
        WHERE user_id = v_driver_id;

        PERFORM public.create_notification(
            v_driver_id,
            'Compensación por Cancelación',
            'Un pasajero ha cancelado tarde. Se ha ingresado una compensación de ' || v_driver_compensation || '€ en tu balance.',
            'info',
            jsonb_build_object('ride_id', p_ride_id)
        );
    END IF;
    
    -- 3. Actualizar viaje (Persistir cambio de pasajeros)
    UPDATE public.rides
    SET passengers = COALESCE(v_new_passengers, '[]'::JSONB),
        participant_ids = array_remove(participant_ids, v_passenger_id),
        seats_available = seats_available + 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'message', 'Reserva cancelada con reembolso del ' || v_refund_percentage || '%', 'refundAmount', v_refund_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. CORRECCIÓN: complete_ride (Anti-Fraude Tiempo)
-- Solo permitimos completar si ya pasó la hora de salida
CREATE OR REPLACE FUNCTION public.complete_ride(
    p_ride_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_ride_driver UUID;
    v_passengers JSONB;
    v_new_passenger_state JSONB;
    v_passenger RECORD;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_platform_fee DECIMAL;
    v_driver_earning DECIMAL;
    v_co2_saved DECIMAL;
    v_distance DECIMAL;
    v_passenger_count INTEGER;
    v_passengers_updated_list JSONB := '[]'::JSONB;
    v_departure_time TIMESTAMPTZ;
BEGIN
    v_driver_id := auth.uid();
    
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    SELECT driver_id, passengers, distance, departure_time
    INTO v_ride_driver, v_passengers, v_distance, v_departure_time
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE; 
    
    IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe'; END IF;
    IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede completar el viaje'; END IF;
    
    -- ANTI-FRAUDE: Validar tiempo
    IF NOW() < v_departure_time THEN
        RAISE EXCEPTION 'No puedes completar un viaje antes de su hora de salida';
    END IF;

    -- Calcular CO2
    v_passenger_count := jsonb_array_length(v_passengers);
    IF v_distance > 0 AND v_passenger_count > 0 THEN
        v_co2_saved := (v_distance * 0.12) * v_passenger_count;
    ELSE
        v_co2_saved := 0;
    END IF;
    
    -- Procesar pagos (con Idempotencia del script anterior)
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_passengers)
    LOOP
        v_new_passenger_state := v_passenger.value;

        IF (v_passenger.value->>'status') IN ('confirmed', 'verified', 'confirmed_by_pin') THEN
            v_passenger_id := (v_passenger.value->>'id')::UUID;
            v_booked_price := (v_passenger.value->>'booked_price')::DECIMAL;
            v_platform_fee := ROUND(v_booked_price * 0.15, 2);
            v_driver_earning := v_booked_price - v_platform_fee;

            UPDATE public.wallets SET held_balance = held_balance - v_booked_price WHERE user_id = v_passenger_id;
            INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
            SELECT id, user_id, 'trip_payment', -v_booked_price, balance, 'Pago final viaje', p_ride_id FROM public.wallets WHERE user_id = v_passenger_id;

            UPDATE public.wallets SET balance = balance + v_driver_earning WHERE user_id = v_driver_id;
            INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
            SELECT id, user_id, 'trip_earning', v_driver_earning, balance, 'Ganancia por viaje completado', p_ride_id FROM public.wallets WHERE user_id = v_driver_id;

            v_new_passenger_state := jsonb_set(v_new_passenger_state, '{status}', '"completed"');
        END IF;

        v_passengers_updated_list := v_passengers_updated_list || v_new_passenger_state;
    END LOOP;
    
    UPDATE public.rides
    SET status = 'completed',
        passengers = v_passengers_updated_list,
        co2_saved = v_co2_saved
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'message', 'Viaje completado', 'co2_saved', v_co2_saved);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Resumen
DO $$
BEGIN
    RAISE NOTICE '✅ PARCHES RED TEAM APLICADOS:';
    RAISE NOTICE '   - Doble Reembolso: BLOQUEADO';
    RAISE NOTICE '   - Completado Prematuro: BLOQUEADO';
END $$;
