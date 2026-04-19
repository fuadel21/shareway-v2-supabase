-- ================================================================
-- MASTER DATABASE ENGINE v6.0 - THE FINAL RESTORATION
-- PROJECT: SHAREWAY V2 | AUTHOR: SENIOR PRODUCT ENGINEER
-- ================================================================

-- 0. LIMPIEZA ATÓMICA (Borra todo lo conflictivo por nombre)
DO $$ 
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN (
            'create_ride', 'confirm_trip_and_pay', 'cancel_ride', 
            'get_ride_details_secure', 'start_ride', 'complete_ride', 
            'verify_passenger_boarding', 'add_funds', 'search_rides_by_corridor',
            'process_ride_impact'
        ) AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION %I.%I(%s) CASCADE', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. TABLAS NÚCLEO (Esquema Profesional v6.0)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    email TEXT UNIQUE,
    photo_url TEXT,
    gender TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    vehicle_info JSONB DEFAULT '{}'::jsonb,
    loyalty_points INTEGER DEFAULT 0,
    total_co2_saved_kg NUMERIC(10,2) DEFAULT 0,
    rating NUMERIC(3,2) DEFAULT 5.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    departure_time TIMESTAMPTZ NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    seats_available INTEGER NOT NULL,
    details TEXT DEFAULT '',
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
    passengers JSONB DEFAULT '[]'::jsonb,
    participant_ids UUID[] DEFAULT '{}',
    distance NUMERIC(10,2) DEFAULT 0,
    overview_polyline TEXT,
    waypoints JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    balance NUMERIC(12,2) DEFAULT 0.00,
    held_balance NUMERIC(12,2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    related_ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MOTOR DE LÓGICA (RPC SIN ERRORES)

-- A. CREAR VIAJE (Sincronizado con 9 parámetros)
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB, p_destination JSONB, p_departure_time TIMESTAMPTZ,
    p_seats INTEGER, p_price DECIMAL, p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0, p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::JSONB
) RETURNS JSON AS $$
DECLARE v_new_id UUID;
BEGIN
    INSERT INTO public.rides (driver_id, origin, destination, departure_time, seats_available, price, details, distance, overview_polyline, waypoints, status, participant_ids)
    VALUES (auth.uid(), p_origin, p_destination, p_departure_time, p_seats, p_price, p_details, p_distance, p_overview_polyline, p_waypoints, 'scheduled', ARRAY[auth.uid()])
    RETURNING id INTO v_new_id;
    RETURN json_build_object('success', true, 'rideId', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. RESERVA PRO (Escrow Atómico)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID, p_request_id UUID DEFAULT NULL, p_pickup_address TEXT DEFAULT NULL, p_pickup_location JSONB DEFAULT NULL, p_price DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE v_me UUID := auth.uid(); v_val_price NUMERIC; v_val_seats INTEGER; v_pin TEXT;
BEGIN 
    SELECT price, seats_available INTO v_val_price, v_val_seats FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;
    IF v_val_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_val_seats <= 0 THEN RAISE EXCEPTION 'SIN_PLAZAS'; END IF;
    
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    UPDATE public.wallets SET balance = balance - v_val_price, held_balance = held_balance + v_val_price WHERE user_id = v_me;
    UPDATE public.rides SET seats_available = seats_available - 1, participant_ids = array_append(participant_ids, v_me), 
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object('id', v_me, 'status', 'confirmed', 'pin', v_pin, 'booked_price', v_val_price, 'pickup_address', p_pickup_address)
    WHERE id = p_ride_id;
    RETURN json_build_object('success', true, 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. DETALLES SEGUROS
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE v_uid UUID := auth.uid(); v_r RECORD;
BEGIN
    SELECT r.*, p.display_name, p.photo_url, p.vehicle_info INTO v_r FROM public.rides r JOIN public.profiles p ON r.driver_id = p.id WHERE r.id = p_ride_id;
    IF v_r.id IS NULL THEN RETURN NULL; END IF;
    RETURN json_build_object(
        'id', v_r.id, 'driver_id', v_r.driver_id, 'driver_name', v_r.display_name, 'driver_photo', v_r.photo_url, 'driver_vehicle', v_r.vehicle_info,
        'origin', v_r.origin, 'destination', v_r.destination, 'departure_time', v_r.departure_time, 'price', v_r.price, 'status', v_r.status, 'seats_available', v_r.seats_available,
        'passengers', (SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = v_uid THEN p ELSE p - 'pin' END) FROM jsonb_array_elements(COALESCE(v_r.passengers, '[]'::JSONB)) p),
        'user_pin', (SELECT p->>'pin' FROM jsonb_array_elements(v_r.passengers) p WHERE (p->>'id')::UUID = v_uid)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- D. RECARGA DE SALDO
CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_method TEXT DEFAULT 'card')
RETURNS JSON AS $$
BEGIN
    UPDATE public.wallets SET balance = balance + p_amount, updated_at = NOW() WHERE user_id = auth.uid();
    INSERT INTO public.transactions (user_id, amount, type, description) VALUES (auth.uid(), p_amount, 'deposit', 'Recarga vía ' || p_method);
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
