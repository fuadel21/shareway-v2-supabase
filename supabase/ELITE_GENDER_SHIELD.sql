-- ========================================================
-- MIGRACIÓN: ELITE GENDER SHIELD v3 (Hardened Edition)
-- Objetivo: Reparar validaciones críticas y blindaje de género
-- ========================================================

-- 1. BLINDAJE EN LA CREACIÓN: create_ride con validaciones completas
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
    v_driver_id UUID;
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_driver_gender TEXT;
    v_is_suspended BOOLEAN;
    v_is_verified TEXT;
    v_ride_id UUID;
BEGIN 
    v_driver_id := auth.uid();
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. Obtener y validar perfil del conductor
    SELECT display_name, photo_url, is_suspended, (verification->>'status'), gender 
    INTO v_driver_name, v_driver_photo, v_is_suspended, v_is_verified, v_driver_gender
    FROM public.profiles WHERE id = v_driver_id;

    IF v_is_suspended THEN RAISE EXCEPTION 'Tu cuenta está suspendida. Contacta con soporte.'; END IF;
    
    -- [OPCIONAL] Descomentar para producción real:
    -- IF v_is_verified != 'verified' THEN RAISE EXCEPTION 'Solo usuarios verificados pueden ofrecer viajes.'; END IF;

    -- 2. ESCUDO DE GÉNERO
    IF p_is_women_only AND (v_driver_gender IS NULL OR LOWER(v_driver_gender) != 'female') THEN
        RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
    END IF;

    -- 3. VALIDACIONES DE NEGOCIO CRÍTICAS
    IF p_seats < 1 OR p_seats > 8 THEN 
        RAISE EXCEPTION 'Número de asientos no permitido (debe ser entre 1 y 8).'; 
    END IF;

    IF p_departure_time <= (NOW() + INTERVAL '5 minutes') THEN 
        RAISE EXCEPTION 'La fecha de salida debe ser al menos con 5 minutos de antelación.'; 
    END IF;

    -- Validar Precio vs Distancia (Evitar bypass de distance: 0)
    IF p_price > 0 THEN
        IF p_distance IS NULL OR p_distance <= 0 THEN
            RAISE EXCEPTION 'Distancia inválida para el precio establecido.';
        END IF;
        IF (p_price / p_distance) > 0.60 THEN 
            RAISE EXCEPTION 'El precio supera el límite legal de 0.60€/km.';
        END IF;
    END IF;

    -- 4. PREVENCIÓN DE SOLAPAMIENTO (CONDUCTOR)
    IF EXISTS (
        SELECT 1 FROM public.rides 
        WHERE driver_id = v_driver_id 
        AND status IN ('scheduled', 'active') 
        AND ABS(EXTRACT(EPOCH FROM (departure_time - p_departure_time))) < 7200 -- Ventana de 2h
    ) THEN 
        RAISE EXCEPTION 'Ya tienes un viaje programado o activo en un horario similar (±2h).'; 
    END IF;

    -- 5. INSERCIÓN ATÓMICA
    INSERT INTO public.rides (
        driver_id, driver_display_name, driver_photo_url, origin, destination,
        departure_time, seats_total, seats_available, price, details,
        distance, overview_polyline, is_women_only, participant_ids, 
        approval_mode, waypoints, preferences, status
    ) VALUES (
        v_driver_id, v_driver_name, v_driver_photo, p_origin, p_destination,
        p_departure_time, p_seats, p_seats, p_price, p_details,
        p_distance, p_overview_polyline, p_is_women_only, ARRAY[v_driver_id],
        p_approval_mode, p_waypoints, p_preferences, 'scheduled'
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- [Nota: Las funciones confirm_trip_and_pay y accept_passenger se mantienen de la v2]
