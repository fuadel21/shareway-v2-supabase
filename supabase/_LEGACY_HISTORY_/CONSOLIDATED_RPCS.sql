-- ==========================================
-- SHAREWAY V2: CONSOLIDATED RPC ENGINE
-- ==========================================
-- Este archivo contiene las versiones DEFINITIVAS de todas las funciones RPC.

-- ==========================================
-- 0. LIMPIEZA DE FUNCIONES (RPCs FRONTEND)
-- ==========================================

DROP FUNCTION IF EXISTS public.log_error(TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.delete_user_account() CASCADE;
DROP FUNCTION IF EXISTS public.add_funds(DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.request_payout(DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS public.create_ride(JSONB, JSONB, TIMESTAMPTZ, INTEGER, DECIMAL, TEXT, DECIMAL, TEXT, JSONB, BOOLEAN, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.start_ride(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.complete_ride(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fetch_my_activity_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fetch_my_activity_v1(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fetch_my_activity(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_ride_pin(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.verify_passenger(UUID, UUID, TEXT) CASCADE;

-- ==========================================
-- 1. UTILIDADES Y TRIGGERS DE SISTEMA
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_updated_at() RETURNS TRIGGER AS $$ 
BEGIN 
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.log_error(
    p_message TEXT,
    p_context JSONB DEFAULT '{}'::jsonb
) RETURNS VOID AS $$ 
BEGIN
    INSERT INTO public.error_logs (message, context, created_at)
    VALUES (p_message, p_context, NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 2. PERFILES E IDENTIDAD
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ 
BEGIN
    INSERT INTO public.profiles (id, email, display_name, photo_url, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'photo_url', ''),
        'user'
    );
    
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = NEW.id) THEN
        INSERT INTO public.wallets (user_id, balance, currency)
        VALUES (NEW.id, 0.00, 'EUR');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_user_account() RETURNS JSON AS $$
DECLARE 
    v_user_id UUID := auth.uid();
BEGIN 
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
    
    IF EXISTS (
        SELECT 1 FROM public.rides 
        WHERE driver_id = v_user_id AND status IN ('scheduled', 'active')
    ) THEN 
        RAISE EXCEPTION 'No puedes eliminar tu cuenta con viajes activos. Cancélalos primero.';
    END IF;
    
    DELETE FROM public.profiles WHERE id = v_user_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 3. MOTOR FINANCIERO (WALLET & ESCROW)
-- ==========================================

CREATE OR REPLACE FUNCTION public.add_funds(p_amount DECIMAL) RETURNS JSON AS $$
DECLARE 
    v_user_id UUID := auth.uid();
    v_wallet_id UUID;
BEGIN 
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;

    UPDATE public.wallets 
    SET balance = balance + p_amount, updated_at = NOW()
    WHERE user_id = v_user_id
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.transactions (wallet_id, user_id, amount, type, description)
    VALUES (v_wallet_id, v_user_id, p_amount, 'deposit', 'Recarga de saldo');

    RETURN json_build_object('success', true, 'new_balance', (SELECT balance FROM public.wallets WHERE id = v_wallet_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_approval_mode TEXT;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID [];
    v_booking_status TEXT;
    v_departure_time TIMESTAMPTZ;
BEGIN 
    v_passenger_id := auth.uid();
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
    
    SELECT display_name, photo_url, gender INTO v_passenger_name, v_passenger_photo, v_passenger_gender
    FROM public.profiles WHERE id = v_passenger_id;

    SELECT price, seats_available, driver_id, participant_ids, is_women_only, approval_mode, departure_time
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_is_women_only, v_approval_mode, v_departure_time
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'El viaje no está disponible.'; END IF;
    IF v_departure_time <= NOW() THEN RAISE EXCEPTION 'El viaje ya ha salido.'; END IF;
    IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan asientos disponibles.'; END IF;
    IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje.'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.rides
        WHERE participant_ids @> ARRAY [v_passenger_id]
            AND status IN ('scheduled', 'active')
            AND ABS(EXTRACT(EPOCH FROM (departure_time - v_departure_time))) < 3600
            AND id != p_ride_id
    ) THEN RAISE EXCEPTION 'Ya tienes otro viaje en un horario similar.';
    END IF;

    IF v_is_women_only AND (v_passenger_gender IS NULL OR v_passenger_gender != 'female') THEN 
        RAISE EXCEPTION 'Exclusivo para mujeres.';
    END IF;

    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.'; END IF;

    v_booking_status := CASE WHEN v_approval_mode = 'manual' THEN 'pending' ELSE 'confirmed' END;
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'display_name', v_passenger_name,
        'photo_url', v_passenger_photo,
        'status', v_booking_status,
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    )::JSONB;

    UPDATE public.wallets SET balance = balance - v_ride_price, held_balance = held_balance + v_ride_price WHERE user_id = v_passenger_id;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', - v_ride_price, balance, 'Pago en garantía para el viaje', p_ride_id
    FROM public.wallets WHERE user_id = v_passenger_id;

    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = CASE WHEN v_booking_status = 'confirmed' THEN seats_available - 1 ELSE seats_available END
    WHERE id = p_ride_id;

    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id AND requester_id = v_passenger_id;
    END IF;

    RETURN json_build_object('success', true, 'status', v_booking_status, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.request_payout(p_amount DECIMAL) RETURNS JSON AS $$
DECLARE 
    v_user_id UUID := auth.uid();
    v_balance DECIMAL;
BEGIN
    SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;

    IF v_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente.'; END IF;
    IF p_amount < 10 THEN RAISE EXCEPTION 'Monto mínimo: 10€'; END IF;

    UPDATE public.wallets SET balance = balance - p_amount WHERE user_id = v_user_id;
    
    INSERT INTO public.payout_requests (user_id, amount, status)
    VALUES (v_user_id, p_amount, 'pending');

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 4. CICLO DE VIDA DEL VIAJE (RIDES)
-- ==========================================

CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT NULL,
    p_overview_polyline TEXT DEFAULT NULL,
    p_waypoints JSONB DEFAULT '[]'::jsonb,
    p_is_women_only BOOLEAN DEFAULT FALSE,
    p_approval_mode TEXT DEFAULT 'automatic'
) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
BEGIN 
    IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'Fecha de salida en el pasado.'; END IF;

    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time, seats_total, seats_available, price,
        details, distance, overview_polyline, waypoints, is_women_only, approval_mode, participant_ids
    ) VALUES (
        v_driver_id, p_origin, p_destination, p_departure_time, p_seats, p_seats, p_price,
        p_details, p_distance, p_overview_polyline, p_waypoints, p_is_women_only, p_approval_mode, ARRAY [v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'ride_id', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$ 
BEGIN
    UPDATE public.rides SET status = 'active'
    WHERE id = p_ride_id AND driver_id = auth.uid() AND status = 'scheduled';
    
    IF NOT FOUND THEN RAISE EXCEPTION 'No se puede iniciar el viaje.'; END IF;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_passengers JSONB;
    v_total_payout DECIMAL := 0;
BEGIN
    SELECT passengers INTO v_passengers FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'active' FOR UPDATE;

    IF v_passengers IS NULL THEN RAISE EXCEPTION 'Viaje no activo o no autorizado.'; END IF;

    FOR v_passenger IN
        SELECT (p->>'id')::UUID as pid, (p->>'booked_price')::DECIMAL as price
        FROM jsonb_array_elements(v_passengers) p
        WHERE (p->>'status') IN ('confirmed', 'verified', 'no_show') 
    LOOP
        UPDATE public.wallets SET held_balance = held_balance - v_passenger.price WHERE user_id = v_passenger.pid;
        v_total_payout := v_total_payout + v_passenger.price;
    END LOOP;

    UPDATE public.wallets SET balance = balance + v_total_payout WHERE user_id = v_driver_id;
    UPDATE public.rides SET status = 'completed' WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. ACTIVIDAD Y BÚSQUEDA
-- ==========================================

CREATE OR REPLACE FUNCTION public.fetch_my_activity_v2(p_user_id UUID) RETURNS TABLE (
        id UUID, status TEXT, departure_time TIMESTAMPTZ, origin JSONB, destination JSONB,
        price DECIMAL, seats_available INTEGER, role TEXT, passengers JSONB,
        is_women_only BOOLEAN, driver_id UUID, driver_display_name TEXT, driver_photo_url TEXT
    ) AS $$ 
BEGIN 
    RETURN QUERY
    SELECT r.id, r.status, r.departure_time, r.origin, r.destination, r.price, r.seats_available,
        CASE WHEN r.driver_id = p_user_id THEN 'driver'::TEXT ELSE 'passenger'::TEXT END as role,
        COALESCE(r.passengers, '[]'::JSONB), r.is_women_only, r.driver_id, r.driver_display_name, r.driver_photo_url
    FROM public.rides r WHERE p_user_id = ANY(r.participant_ids)
    UNION ALL
    SELECT rr.id, rr.status, rr.departure_time, rr.origin, rr.destination, rr.suggested_price as price, rr.seats_needed as seats_available,
        'requester'::TEXT as role, '[]'::JSONB as passengers, rr.is_women_only, rr.requester_id as driver_id, p.display_name, p.photo_url
    FROM public.ride_requests rr JOIN public.profiles p ON rr.requester_id = p.id WHERE rr.requester_id = p_user_id
    ORDER BY departure_time DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Aliases para fetch_my_activity
CREATE OR REPLACE FUNCTION public.fetch_my_activity_v1(p_user_id UUID)
RETURNS TABLE (id UUID, status TEXT, departure_time TIMESTAMPTZ, origin JSONB, destination JSONB, price DECIMAL, seats_available INTEGER, role TEXT, passengers JSONB, is_women_only BOOLEAN, driver_id UUID, driver_display_name TEXT, driver_photo_url TEXT) 
AS $$ BEGIN RETURN QUERY SELECT * FROM public.fetch_my_activity_v2(p_user_id); END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fetch_my_activity(p_user_id UUID)
RETURNS TABLE (id UUID, status TEXT, departure_time TIMESTAMPTZ, origin JSONB, destination JSONB, price DECIMAL, seats_available INTEGER, role TEXT, passengers JSONB, is_women_only BOOLEAN, driver_id UUID, driver_display_name TEXT, driver_photo_url TEXT) 
AS $$ BEGIN RETURN QUERY SELECT * FROM public.fetch_my_activity_v2(p_user_id); END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==========================================
-- 6. SEGURIDAD Y PINS
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID) RETURNS JSON AS $$
DECLARE 
    v_pin TEXT;
BEGIN
    SELECT p->>'pin' INTO v_pin
    FROM public.rides, jsonb_array_elements(passengers) p
    WHERE id = p_ride_id AND (p->>'id')::UUID = auth.uid() AND p->>'status' IN ('confirmed', 'verified');

    IF v_pin IS NULL THEN RETURN json_build_object('success', false, 'error', 'PIN no disponible'); END IF;
    RETURN json_build_object('success', true, 'data', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE 
    v_passengers JSONB;
    v_found BOOLEAN := false;
BEGIN
    SELECT passengers INTO v_passengers FROM public.rides 
    WHERE id = p_ride_id AND driver_id = auth.uid() FOR UPDATE;
    
    -- Verificar si existe el pasajero con ese PIN
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_passengers) p 
        WHERE (p->>'id')::UUID = p_passenger_id AND p->>'pin' = p_pin
    ) THEN
        v_found := true;
    END IF;

    IF NOT v_found THEN RAISE EXCEPTION 'PIN incorrecto.'; END IF;
    
    -- Actualizar el estado a 'verified'
    UPDATE public.rides 
    SET passengers = (
        SELECT jsonb_agg(
            CASE WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"verified"') 
            ELSE p END
        ) FROM jsonb_array_elements(v_passengers) p
    )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;