-- ========================================================
-- FUNCIÓN CREATE_RIDE - Función RPC faltante
-- ========================================================

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
    p_allowed_communities TEXT [] DEFAULT '{}',
    p_approval_mode TEXT DEFAULT 'automatic',
    p_waypoints JSONB DEFAULT '[]'::jsonb,
    p_preferences JSONB DEFAULT '{}'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_driver_gender TEXT;
    v_ride_id UUID;
    v_verification_status TEXT;
    v_origin_lat DECIMAL;
    v_origin_lng DECIMAL;
    v_dest_lat DECIMAL;
    v_dest_lng DECIMAL;
BEGIN
    -- Validación de autenticación
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Validación de coordenadas
    v_origin_lat := (p_origin->>'lat')::DECIMAL;
    v_origin_lng := (p_origin->>'lng')::DECIMAL;
    v_dest_lat := (p_destination->>'lat')::DECIMAL;
    v_dest_lng := (p_destination->>'lng')::DECIMAL;

    IF NOT public.validate_coordinates(v_origin_lat, v_origin_lng) THEN
        RAISE EXCEPTION 'Coordenadas de origen inválidas';
    END IF;

    IF NOT public.validate_coordinates(v_dest_lat, v_dest_lng) THEN
        RAISE EXCEPTION 'Coordenadas de destino inválidas';
    END IF;

    -- Validación de distancia
    IF p_distance IS NOT NULL AND NOT public.validate_distance(p_distance) THEN
        RAISE EXCEPTION 'La distancia del viaje es inválida (máximo 500km)';
    END IF;

    -- Obtener datos del conductor
    SELECT display_name, photo_url, gender, (verification->>'status')
    INTO v_driver_name, v_driver_photo, v_driver_gender, v_verification_status
    FROM public.profiles
    WHERE id = v_driver_id;

    -- Validación de verificación (opcional en desarrollo)
    IF v_verification_status IS NULL OR v_verification_status != 'verified' THEN
        -- En producción esto sería obligatorio
        NULL;
    END IF;

    -- Validación de precio justo
    IF p_price > 0 AND p_distance > 0 THEN
        IF (p_price / p_distance) > 0.60 THEN
            RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km.';
        END IF;
    END IF;

    -- Validación de precio máximo
    IF p_price > 300 THEN
        RAISE EXCEPTION 'El precio máximo permitido es de 300€.';
    END IF;

    -- Validación de fecha futura (+10 minutos)
    IF p_departure_time <= NOW() + INTERVAL '10 minutes' THEN
        RAISE EXCEPTION 'La fecha del viaje debe ser al menos 10 minutos a futuro.';
    END IF;

    -- Validación de asientos
    IF p_seats < 1 OR p_seats > 9 THEN
        RAISE EXCEPTION 'El número de asientos debe estar entre 1 y 9.';
    END IF;

    -- Validación de overlap (±2h)
    IF EXISTS (
        SELECT 1
        FROM public.rides
        WHERE driver_id = v_driver_id
            AND status IN ('scheduled', 'in_progress', 'active')
            AND ABS(
                EXTRACT(EPOCH FROM (departure_time - p_departure_time))
            ) < 7200
    ) THEN
        RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje en un margen de 2h.';
    END IF;

    -- Validación de género para viajes women_only
    IF p_is_women_only AND (v_driver_gender IS NULL OR LOWER(v_driver_gender) != 'female') THEN
        RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
    END IF;

    -- Insertar ride
    INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_total,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        bounds,
        status,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        approval_mode,
        waypoints,
        preferences,
        participant_ids,
        created_at
    )
    VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        ST_SetSRID(ST_MakePoint(v_origin_lng, v_origin_lat), 4326)::GEOGRAPHY,
        ST_SetSRID(ST_MakePoint(v_dest_lng, v_dest_lat), 4326)::GEOGRAPHY,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        'scheduled',
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        p_approval_mode,
        p_waypoints,
        p_preferences,
        ARRAY [v_driver_id],
        NOW()
    )
    RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Añadir permisos
GRANT EXECUTE ON FUNCTION public.create_ride TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ride TO service_role;
