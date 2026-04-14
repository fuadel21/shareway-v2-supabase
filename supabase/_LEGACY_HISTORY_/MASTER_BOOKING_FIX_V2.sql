-- ==========================================
-- MASTER_BOOKING_FIX_V2.sql
-- ELIMINA FRAGMENTACIÓN EN RPCs DE RESERVAS
-- Versión: 2.1 (Sincronizada con Frontend)
-- ==========================================

-- 1. LIMPIEZA DE FUNCIONES ANTIGUAS
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, jsonb, text, decimal);
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,boolean,boolean,text[],text);
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,boolean,boolean,text[],text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.fulfill_ride_request(uuid,jsonb,jsonb,timestamptz,integer,decimal,decimal,jsonb);

-- 2. FUNCIÓN DEFINITIVA: create_ride (15 Parámetros)
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT NULL,
    p_overview_polyline TEXT DEFAULT NULL,
    p_bounds JSONB DEFAULT NULL,
    p_is_women_only BOOLEAN DEFAULT FALSE,
    p_is_exclusive_community BOOLEAN DEFAULT FALSE,
    p_allowed_communities TEXT[] DEFAULT '{}',
    p_approval_mode TEXT DEFAULT 'automatic',
    p_waypoints JSONB DEFAULT '[]'::jsonb,
    p_preferences JSONB DEFAULT '{}'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_ride_id UUID;
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
BEGIN
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    SELECT display_name, photo_url INTO v_driver_name, v_driver_photo
    FROM public.profiles WHERE id = v_driver_id;

    v_origin_point := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;

    INSERT INTO public.rides (
        driver_id, driver_display_name, driver_photo_url,
        origin, destination, origin_location, destination_location,
        departure_time, seats_total, seats_available, price,
        details, distance, overview_polyline, bounds,
        is_women_only, is_exclusive_community, allowed_communities,
        approval_mode, waypoints, preferences, participant_ids
    ) VALUES (
        v_driver_id, v_driver_name, v_driver_photo,
        p_origin, p_destination, v_origin_point, v_destination_point,
        p_departure_time, p_seats, p_seats, p_price,
        p_details, p_distance, p_overview_polyline, p_bounds,
        p_is_women_only, p_is_exclusive_community, p_allowed_communities,
        p_approval_mode, p_waypoints, p_preferences, ARRAY[v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. FUNCIÓN DEFINITIVA: fulfill_ride_request (Aumentado para coincidir con RPC call)
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
    p_request_id UUID,
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT NULL,
    p_waypoints JSONB DEFAULT '[]'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_ride_result JSON;
    v_ride_id UUID;
    v_request_status TEXT;
    v_requester_is_women_only BOOLEAN;
BEGIN
    SELECT status, is_women_only INTO v_request_status, v_requester_is_women_only 
    FROM public.ride_requests WHERE id = p_request_id;
    
    IF v_request_status IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
    IF v_request_status != 'pending' THEN RAISE EXCEPTION 'La solicitud ya no está pendiente'; END IF;

    v_ride_result := public.create_ride(
        p_origin => p_origin,
        p_destination => p_destination,
        p_departure_time => p_departure_time,
        p_seats => p_seats,
        p_price => p_price,
        p_details => p_details,
        p_distance => p_distance,
        p_overview_polyline => p_overview_polyline,
        p_is_women_only => COALESCE(v_requester_is_women_only, FALSE),
        p_waypoints => p_waypoints
    );

    v_ride_id := (v_ride_result->>'rideId')::UUID;

    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. FUNCIÓN DEFINITIVA: confirm_trip_and_pay
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL,
        p_pickup_location JSONB DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL,
        p_price DECIMAL DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID := auth.uid();
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_seats_to_book INTEGER := 1;
    v_price_per_seat DECIMAL;
    v_total_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID [];
    v_current_balance DECIMAL;
    v_ride_status TEXT;
BEGIN 
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- Bloqueo de Wallet
    SELECT balance INTO v_current_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;

    -- Bloqueo de Viaje
    SELECT price, seats_available, driver_id, participant_ids, status 
    INTO v_price_per_seat, v_seats_available, v_driver_id, v_participant_ids, v_ride_status
    FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_status NOT IN ('scheduled', 'active', 'in_progress') THEN 
        RAISE EXCEPTION 'El viaje ya no acepta plazas (Estado: %)', v_ride_status;
    END IF;

    -- Ajuste de precio dinámico
    IF p_price IS NOT NULL AND p_price > 0 THEN v_price_per_seat := p_price; END IF;

    -- Asientos
    IF p_request_id IS NOT NULL THEN
        SELECT seats_needed INTO v_seats_to_book FROM public.ride_requests WHERE id = p_request_id;
    END IF;
    v_seats_to_book := COALESCE(v_seats_to_book, 1);

    IF v_seats_available < v_seats_to_book THEN RAISE EXCEPTION 'Plazas agotadas'; END IF;
    IF v_passenger_id = v_driver_id THEN RAISE EXCEPTION 'Eres el conductor'; END IF;
    IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes reserva'; END IF;

    v_total_price := v_price_per_seat * v_seats_to_book;
    IF v_current_balance < v_total_price THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;

    -- Perfil
    SELECT display_name, photo_url INTO v_passenger_name, v_passenger_photo FROM public.profiles WHERE id = v_passenger_id;

    -- Transacción
    UPDATE public.wallets SET balance = balance - v_total_price, held_balance = held_balance + v_total_price WHERE user_id = v_passenger_id;

    INSERT INTO public.transactions (user_id, wallet_id, amount, balance_after, type, description, related_ride_id)
    VALUES (v_passenger_id, v_passenger_id, -v_total_price, v_current_balance - v_total_price, 'hold', 'Reserva de plaza', p_ride_id);

    -- Registro
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_new_passenger := jsonb_build_object(
        'id', v_passenger_id, 'displayName', v_passenger_name, 'photoURL', v_passenger_photo,
        'status', 'confirmed', 'pin', v_ride_pin, 'booked_price', v_total_price,
        'seats_booked', v_seats_to_book, 'booked_at', NOW(),
        'pickup_location', p_pickup_location, 'pickup_address', p_pickup_address
    );

    UPDATE public.rides SET 
        passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - v_seats_to_book
    WHERE id = p_ride_id;

    IF p_request_id IS NOT NULL THEN UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id; END IF;

    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
