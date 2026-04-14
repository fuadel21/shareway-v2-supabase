-- ========================================================
-- MIGRACIÓN: PLATFORM TREASURY SYSTEM v1.1
-- Objetivo: Recaudación de comisiones, penalizaciones y sostenibilidad.
-- Corregido: Error de clave ajena en auth.users
-- ========================================================

-- 1. CREACIÓN DE LA ENTIDAD "PLATAFORMA" EN AUTH Y PUBLIC
-- Usamos un UUID fijo para la Tesorería para que sea fácil de auditar.
DO $$ 
DECLARE
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- A) Insertar en auth.users (Necesario para satisfacer la Foreign Key de profiles)
    -- Se usa una contraseña aleatoria y se marca como sistema si es posible
    INSERT INTO auth.users (
        id, 
        instance_id, 
        aud, 
        role, 
        email, 
        encrypted_password, 
        email_confirmed_at, 
        raw_app_meta_data, 
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
    )
    VALUES (
        v_platform_id, 
        '00000000-0000-0000-0000-000000000000', 
        'authenticated', 
        'authenticated', 
        'treasury@shareway.com', 
        'SYSTEM_ACCOUNT_NO_LOGIN', 
        now(), 
        '{"provider":"email","is_system":true}', 
        '{"display_name":"ShareWay Treasury"}',
        now(),
        now(),
        '',
        '',
        '',
        ''
    ) ON CONFLICT (id) DO NOTHING;

    -- B) Crear Perfil de Sistema
    INSERT INTO public.profiles (id, display_name, email, role, is_admin)
    VALUES (v_platform_id, 'ShareWay Treasury', 'treasury@shareway.com', 'admin', true)
    ON CONFLICT (id) DO UPDATE SET is_admin = true, role = 'admin';

    -- C) Crear Wallet de Sistema
    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (v_platform_id, 0.00, 0.00)
    ON CONFLICT (user_id) DO NOTHING;
END $$;

-- 2. UNIFICACIÓN DE COBRO CON RECAUDACIÓN (complete_ride v2.1)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_ride RECORD;
    v_pax RECORD;
    v_total_to_driver DECIMAL := 0;
    v_total_to_platform DECIMAL := 0;
    v_fee_percentage DECIMAL := 0.15; -- 15% Comisión
BEGIN
    -- Bloqueo y validación
    SELECT * INTO v_ride FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'active'
    FOR UPDATE;

    IF v_ride.id IS NULL THEN
        RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE: El viaje no existe o no eres el conductor.';
    END IF;

    -- Procesar cada pasajero
    FOR v_pax IN SELECT * FROM jsonb_array_elements(v_ride.passengers) LOOP
        -- CASO: Conductor cobra (Verificado o No-Show)
        IF v_pax.value->>'status' IN ('verified', 'no_show') THEN
            -- Desglose
            v_total_to_driver := v_total_to_driver + ((v_pax.value->>'booked_price')::DECIMAL * (1 - v_fee_percentage));
            v_total_to_platform := v_total_to_platform + ((v_pax.value->>'booked_price')::DECIMAL * v_fee_percentage);
            
            -- Quitar del Held del pasajero
            UPDATE public.wallets 
            SET held_balance = held_balance - (v_pax.value->>'booked_price')::DECIMAL 
            WHERE user_id = (v_pax.value->>'id')::UUID;

        -- CASO: Devuelto al pasajero (Solo Confirmado sin PIN)
        ELSIF v_pax.value->>'status' = 'confirmed' THEN
            UPDATE public.wallets 
            SET balance = balance + (v_pax.value->>'booked_price')::DECIMAL,
                held_balance = held_balance - (v_pax.value->>'booked_price')::DECIMAL
            WHERE user_id = (v_pax.value->>'id')::UUID;
        END IF;
    END LOOP;

    -- 3. MOVIMIENTO MAESTRO DE FONDOS
    -- Pago al Conductor
    IF v_total_to_driver > 0 THEN
        UPDATE public.wallets SET balance = balance + v_total_to_driver WHERE user_id = v_driver_id;
        INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_driver_id, v_total_to_driver, 'ride_earning', 'Ganancia por viaje (Neto)', p_ride_id);
    END IF;

    -- Pago a la Plataforma (Tesorería)
    IF v_total_to_platform > 0 THEN
        UPDATE public.wallets SET balance = balance + v_total_to_platform WHERE user_id = v_platform_id;
        INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, related_ride_id)
        VALUES (v_platform_id, v_platform_id, v_total_to_platform, 'platform_fee', 'Comisión recaudada (15%)', p_ride_id);
    END IF;

    UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'driver_payout', v_total_to_driver, 'platform_revenue', v_total_to_platform);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. MEJORA: cancel_booking_and_refund (Redirección de Penalización a Tesorería)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) 
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_booked_price DECIMAL;
    v_status TEXT;
    v_departure_time TIMESTAMPTZ;
    v_passengers JSONB;
    v_new_passengers JSONB;
    v_refund_amount DECIMAL;
    v_hours_until_departure FLOAT;
    v_driver_id UUID;
    v_penalty_amount DECIMAL;
    v_driver_comp DECIMAL;
    v_platform_comp DECIMAL;
    v_booked_at TIMESTAMPTZ;
BEGIN
    SELECT driver_id, departure_time, passengers, status INTO v_driver_id, v_departure_time, v_passengers, v_status
    FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje ya no está disponible para cancelación.'; END IF;

    SELECT (p->>'booked_price')::DECIMAL, (p->>'status'), (p->>'booked_at')::TIMESTAMPTZ 
    INTO v_booked_price, v_status, v_booked_at
    FROM jsonb_array_elements(v_passengers) p WHERE (p->>'id')::UUID = v_passenger_id;

    IF v_booked_price IS NULL OR v_status IN ('cancelled', 'rejected') THEN RAISE EXCEPTION 'Reserva no encontrada.'; END IF;

    -- Lógica de Reembolso
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_departure_time - NOW())) / 3600;
    
    IF v_status = 'pending' OR v_hours_until_departure > 24 OR (EXTRACT(EPOCH FROM (NOW() - v_booked_at)) / 60 <= 15 AND v_hours_until_departure > 3) THEN
        v_refund_amount := v_booked_price;
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_amount := ROUND(v_booked_price * 0.5, 2);
    ELSE
        v_refund_amount := 0;
    END IF;

    v_penalty_amount := v_booked_price - v_refund_amount;

    -- Devolución al pasajero
    UPDATE public.wallets SET balance = balance + v_refund_amount, held_balance = held_balance - v_booked_price WHERE user_id = v_passenger_id;
    
    -- Distribución de Penalización (80% Conductor, 20% Plataforma)
    IF v_penalty_amount > 0 THEN
        v_driver_comp := ROUND(v_penalty_amount * 0.8, 2);
        v_platform_comp := v_penalty_amount - v_driver_comp;

        UPDATE public.wallets SET balance = balance + v_driver_comp WHERE user_id = v_driver_id;
        UPDATE public.wallets SET balance = balance + v_platform_comp WHERE user_id = v_platform_id;

        INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_driver_id, v_driver_comp, 'cancellation_compensation', 'Compensación por cancelación de pasajero', p_ride_id);
        
        INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, related_ride_id)
        VALUES (v_platform_id, v_platform_id, v_platform_comp, 'platform_fee', 'Gasto de gestión por cancelación', p_ride_id);
    END IF;

    -- Actualizar JSON del Viaje
    SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"') ELSE p END)
    INTO v_new_passengers FROM jsonb_array_elements(v_passengers) p;

    UPDATE public.rides SET passengers = v_new_passengers, participant_ids = array_remove(participant_ids, v_passenger_id),
           seats_available = CASE WHEN v_status = 'confirmed' THEN seats_available + 1 ELSE seats_available END
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'refund', v_refund_amount, 'penalty', v_penalty_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
