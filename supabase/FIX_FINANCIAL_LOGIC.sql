-- ==========================================
-- SCRIPT DE SEGURIDAD FINANCIERA
-- ==========================================
-- Corrige vulnerabilidades de Race Condition y Doble Gasto
-- ==========================================

-- 1. CORRECCIÓN: confirm_trip_and_pay
-- Añade bloqueo FOR UPDATE en la wallet para evitar saldo negativo por concurrencia
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID[];
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Obtener info del pasajero
    SELECT display_name, photo_url, gender
    INTO v_passenger_name, v_passenger_photo, v_passenger_gender
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- Bloqueo pesimista del VIAJE (Evita overbooking)
    SELECT price, seats_available, driver_id, participant_ids, is_women_only
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_is_women_only
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled'
    FOR UPDATE; 

    IF v_ride_price IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe o no está disponible';
    END IF;

    -- Validaciones de negocio
    IF v_is_women_only AND (v_passenger_gender IS NULL OR v_passenger_gender != 'female') THEN
         RAISE EXCEPTION 'Este viaje es exclusivo para mujeres';
    END IF;
    
    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'No quedan asientos disponibles';
    END IF;
    
    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes reservar tu propio viaje';
    END IF;
    
    IF v_passenger_id = ANY(v_participant_ids) THEN
        RAISE EXCEPTION 'Ya tienes una reserva en este viaje';
    END IF;
    
    -- 🔥 CORRECCIÓN CRÍTICA: Bloqueo pesimista de la WALLET 🔥
    -- Esto impide que dos transacciones lean el mismo saldo simultáneamente
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id
    FOR UPDATE;
    
    IF v_wallet_balance IS NULL THEN
        RAISE EXCEPTION 'Wallet no encontrada';
    END IF;
    
    IF v_wallet_balance < v_ride_price THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;
    
    -- Generar PIN
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    -- Crear objeto pasajero
    v_new_passenger := jsonb_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    );
    
    -- Actualizar wallet
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;
    
    -- Registrar transacción
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -v_ride_price, balance, 'Pago retenido para viaje (Precio congelado)', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;
    
    -- Manejo de solicitud previa (si aplica)
    IF p_request_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.ride_requests 
            WHERE id = p_request_id 
            AND status = 'accepted' 
            AND payment_expires_at > NOW()
            AND requester_id = v_passenger_id
        ) THEN
            RAISE EXCEPTION 'La solicitud de viaje ha expirado o ya no es válida para pago.';
        END IF;

        UPDATE public.ride_requests
        SET status = 'fulfilled'
        WHERE id = p_request_id;
    END IF;

    -- Actualizar viaje
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. CORRECCIÓN: complete_ride
-- Asegura idempotencia y consistencia en el estado de los pagos
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
BEGIN
    v_driver_id := auth.uid();
    
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Info del viaje
    SELECT driver_id, passengers, distance
    INTO v_ride_driver, v_passengers, v_distance
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE; -- Bloqueo para evitar ejecuciones concurrentes de completado
    
    IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe'; END IF;
    IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede completar el viaje'; END IF;
    
    -- Calcular CO2
    v_passenger_count := jsonb_array_length(v_passengers);
    IF v_distance > 0 AND v_passenger_count > 0 THEN
        v_co2_saved := (v_distance * 0.12) * v_passenger_count;
    ELSE
        v_co2_saved := 0;
    END IF;
    
    -- Procesar pagos
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_passengers)
    LOOP
        v_new_passenger_state := v_passenger.value;

        -- Solo procesar si está confirmado y NO ha sido procesado previamente
        IF (v_passenger.value->>'status') IN ('confirmed', 'verified', 'confirmed_by_pin') THEN
            v_passenger_id := (v_passenger.value->>'id')::UUID;
            v_booked_price := (v_passenger.value->>'booked_price')::DECIMAL;
            
            v_platform_fee := ROUND(v_booked_price * 0.15, 2);
            v_driver_earning := v_booked_price - v_platform_fee;

            -- 1. Actualizar Wallet Pasajero (Liberar Held)
            UPDATE public.wallets
            SET held_balance = held_balance - v_booked_price
            WHERE user_id = v_passenger_id;
            
            INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
            SELECT id, user_id, 'trip_payment', -v_booked_price, balance, 'Pago final viaje (Liberación de retención)', p_ride_id
            FROM public.wallets WHERE user_id = v_passenger_id;

            -- 2. Actualizar Wallet Conductor (Pago)
            UPDATE public.wallets
            SET balance = balance + v_driver_earning
            WHERE user_id = v_driver_id;
            
            INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
            SELECT id, user_id, 'trip_earning', v_driver_earning, balance, 'Ganancia por viaje completado (Pasajero: ' || (v_passenger.value->>'displayName') || ')', p_ride_id
            FROM public.wallets WHERE user_id = v_driver_id;

            -- 3. Marcar pasajero como COMPLETADO en el JSON local para persistirlo luego
            v_new_passenger_state := jsonb_set(v_new_passenger_state, '{status}', '"completed"');
        END IF;

        -- Reconstruir lista de pasajeros con los nuevos estados
        v_passengers_updated_list := v_passengers_updated_list || v_new_passenger_state;
    END LOOP;
    
    -- Actualizar viaje final
    UPDATE public.rides
    SET status = 'completed',
        passengers = v_passengers_updated_list, -- Guardar estados actualizados (completed)
        co2_saved = v_co2_saved
    WHERE id = p_ride_id;
    
    RETURN json_build_object(
        'success', true, 
        'message', 'Viaje completado y pagos procesados',
        'co2_saved', v_co2_saved
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Resumen
DO $$
BEGIN
    RAISE NOTICE '✅ Correcciones financieras aplicadas:';
    RAISE NOTICE '   - confirm_trip_and_pay: Bloqueo de wallet activo';
    RAISE NOTICE '   - complete_ride: Idempotencia y validación de estados';
END $$;
