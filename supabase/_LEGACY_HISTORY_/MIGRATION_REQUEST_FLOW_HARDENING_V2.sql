-- ========================================================
-- MIGRACIÓN: REQUEST FLOW HARDENING V2
-- Objetivo: Blindar la creación de solicitudes de pasajeros
-- ========================================================

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

    -- 1. Obtener datos del perfil
    SELECT gender INTO v_requester_gender FROM public.profiles WHERE id = v_requester_id;

    -- 2. Validaciones de Seguridad y Spam
    SELECT count(*) INTO v_active_requests_count 
    FROM public.ride_requests 
    WHERE requester_id = v_requester_id AND status = 'pending';

    IF v_active_requests_count >= 5 THEN
        RAISE EXCEPTION 'Has alcanzado el límite de 5 solicitudes activas. Cancela alguna para crear una nueva.';
    END IF;

    -- 3. Escudo de Género
    IF p_is_women_only AND (v_requester_gender IS NULL OR LOWER(v_requester_gender) != 'female') THEN
        RAISE EXCEPTION 'Solo las usuarias pueden crear solicitudes exclusivas para mujeres.';
    END IF;

    -- 4. Validaciones de Negocio
    IF p_departure_time <= (NOW() + INTERVAL '5 minutes') THEN 
        RAISE EXCEPTION 'La hora del viaje debe ser al menos 5 minutos a futuro.'; 
    END IF;

    IF p_seats_needed < 1 OR p_seats_needed > 4 THEN
        RAISE EXCEPTION 'Puedes pedir entre 1 y 4 plazas.';
    END IF;

    -- Validar Precio vs Distancia
    IF p_suggested_price > 0 AND p_distance > 0 THEN
        IF (p_suggested_price / p_distance) > 0.60 THEN 
            RAISE EXCEPTION 'El precio sugerido supera el límite permitido de 0.60€/km.';
        END IF;
    END IF;

    -- 5. Prevención de Solapamiento (Pasajero)
    IF EXISTS (
        SELECT 1 FROM public.ride_requests 
        WHERE requester_id = v_requester_id 
        AND status = 'pending' 
        AND ABS(EXTRACT(EPOCH FROM (departure_time - p_departure_time))) < 3600 -- Ventana de 1h
    ) THEN 
        RAISE EXCEPTION 'Ya tienes otra solicitud activa para un horario similar.'; 
    END IF;

    -- 6. Inserción
    INSERT INTO public.ride_requests (
        requester_id,
        origin,
        destination,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only,
        distance,
        overview_polyline,
        status
    )
    VALUES (
        v_requester_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only,
        p_distance,
        p_overview_polyline,
        'pending'
    )
    RETURNING id INTO v_request_id;

    RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
