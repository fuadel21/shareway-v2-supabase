-- ========================================================
-- MIGRACIÓN: FIX RIDE REQUESTS SCHEMA
-- Objetivo: Añadir columnas faltantes para el Match Engine
-- ========================================================

DO $$ 
BEGIN 
    -- 1. Añadir columna distance si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='distance') THEN
        ALTER TABLE public.ride_requests ADD COLUMN distance NUMERIC DEFAULT 0;
    END IF;

    -- 2. Añadir columna overview_polyline si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='overview_polyline') THEN
        ALTER TABLE public.ride_requests ADD COLUMN overview_polyline TEXT DEFAULT '';
    END IF;
END $$;

-- 3. Re-compilar la función create_ride_request para asegurar que reconoce las nuevas columnas
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE,
        p_distance DECIMAL DEFAULT 0,
        p_overview_polyline TEXT DEFAULT ''
    ) RETURNS JSON AS $$
DECLARE 
    v_requester_id UUID;
    v_requester_gender TEXT;
    v_request_id UUID;
    v_active_requests_count INTEGER;
BEGIN 
    v_requester_id := auth.uid();
    IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    SELECT gender INTO v_requester_gender FROM public.profiles WHERE id = v_requester_id;

    SELECT count(*) INTO v_active_requests_count 
    FROM public.ride_requests 
    WHERE requester_id = v_requester_id AND status = 'pending';

    IF v_active_requests_count >= 5 THEN
        RAISE EXCEPTION 'Has alcanzado el límite de 5 solicitudes activas.';
    END IF;

    IF p_is_women_only AND (v_requester_gender IS NULL OR LOWER(v_requester_gender) != 'female') THEN
        RAISE EXCEPTION 'Solo las usuarias pueden crear solicitudes exclusivas para mujeres.';
    END IF;

    IF p_departure_time <= (NOW() + INTERVAL '5 minutes') THEN 
        RAISE EXCEPTION 'La hora del viaje debe ser al menos 5 minutos a futuro.'; 
    END IF;

    -- Inserción con las nuevas columnas ya existentes
    INSERT INTO public.ride_requests (
        requester_id, origin, destination, departure_time, 
        seats_needed, suggested_price, note, is_women_only, 
        distance, overview_polyline, status
    )
    VALUES (
        v_requester_id, p_origin, p_destination, p_departure_time, 
        p_seats_needed, p_suggested_price, p_details, p_is_women_only, 
        p_distance, p_overview_polyline, 'pending'
    )
    RETURNING id INTO v_request_id;

    RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
