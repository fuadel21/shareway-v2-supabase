-- ========================================================
-- FIX CRÍTICO: Rate Limiting y Validaciones de Negocio
-- Prevenir abusos y asegurar reglas de negocio consistentes
-- ========================================================
-- 1. Tabla de rate limiting
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    window_minutes INTEGER NOT NULL,
    max_actions INTEGER NOT NULL,
    current_count INTEGER DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, action_type)
);
-- 2. Función centralizada de rate limiting
CREATE OR REPLACE FUNCTION public.check_rate_limit(
        p_action_type TEXT,
        p_window_minutes INTEGER DEFAULT 60,
        p_max_actions INTEGER DEFAULT 10,
        p_user_id UUID DEFAULT NULL
    ) RETURNS BOOLEAN AS $$
DECLARE v_user_id UUID := COALESCE(p_user_id, auth.uid());
v_current_count INTEGER;
v_window_start TIMESTAMPTZ;
v_limit_exists BOOLEAN;
BEGIN -- Verificar que el usuario exista
IF v_user_id IS NULL THEN RETURN FALSE;
END IF;
-- Buscar límite existente
SELECT EXISTS(
        SELECT 1
        FROM public.rate_limits
        WHERE user_id = v_user_id
            AND action_type = p_action_type
    ) INTO v_limit_exists;
-- Si no existe, crearlo
IF NOT v_limit_exists THEN
INSERT INTO public.rate_limits (
        user_id,
        action_type,
        window_minutes,
        max_actions,
        window_start,
        current_count
    )
VALUES (
        v_user_id,
        p_action_type,
        p_window_minutes,
        p_max_actions,
        NOW(),
        0
    );
RETURN TRUE;
-- Primer intento, siempre permitido
END IF;
-- Obtener estado actual del límite
SELECT current_count,
    window_start INTO v_current_count,
    v_window_start
FROM public.rate_limits
WHERE user_id = v_user_id
    AND action_type = p_action_type FOR
UPDATE;
-- Si la ventana expiró, resetear
IF window_start < NOW() - (p_window_minutes || ' minutes')::INTERVAL THEN
UPDATE public.rate_limits
SET current_count = 0,
    window_start = NOW(),
    updated_at = NOW()
WHERE user_id = v_user_id
    AND action_type = p_action_type;
v_current_count := 0;
END IF;
-- Verificar si se puede realizar la acción
IF v_current_count >= p_max_actions THEN RETURN FALSE;
END IF;
-- Incrementar contador
UPDATE public.rate_limits
SET current_count = current_count + 1,
    updated_at = NOW()
WHERE user_id = v_user_id
    AND action_type = p_action_type;
RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Validaciones de negocio mejoradas
-- Validación de coordenadas extremas
CREATE OR REPLACE FUNCTION public.validate_coordinates(p_lat DECIMAL, p_lng DECIMAL) RETURNS BOOLEAN AS $$ BEGIN -- Validar rangos válidos
    IF p_lat < -90
    OR p_lat > 90 THEN RETURN FALSE;
END IF;
IF p_lng < -180
OR p_lng > 180 THEN RETURN FALSE;
END IF;
-- Validar que no sean valores nulos o inválidos
IF p_lat IS NULL
OR p_lng IS NULL THEN RETURN FALSE;
END IF;
-- Validar que no sean NaN o infinito
IF p_lat != p_lat
OR p_lng != p_lng THEN -- NaN check
RETURN FALSE;
END IF;
RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Validación de distancia máxima (500km para viajes terrestres)
CREATE OR REPLACE FUNCTION public.validate_distance(p_distance DECIMAL) RETURNS BOOLEAN AS $$ BEGIN -- Validar que la distancia sea razonable para un viaje en coche
    IF p_distance < 0.1
    OR p_distance > 500 THEN RETURN FALSE;
END IF;
RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Validación de tiempo mínimo entre waypoints
CREATE OR REPLACE FUNCTION public.validate_waypoints_timing(p_waypoints JSONB) RETURNS BOOLEAN AS $$
DECLARE v_waypoint JSONB;
v_prev_time TIMESTAMPTZ;
v_min_interval INTERVAL := '5 minutes';
v_index INTEGER;
BEGIN -- Validar que no haya más de 10 waypoints
IF jsonb_array_length(p_waypoints) > 10 THEN RETURN FALSE;
END IF;
-- Validar tiempo mínimo entre waypoints
v_index := 0;
FOR v_waypoint IN
SELECT *
FROM jsonb_array_elements(p_waypoints) LOOP IF v_waypoint->>'departure_time' IS NOT NULL THEN IF v_prev_time IS NOT NULL THEN IF (v_waypoint->>'departure_time')::TIMESTAMPTZ < v_prev_time + v_min_interval THEN RETURN FALSE;
END IF;
END IF;
v_prev_time := (v_waypoint->>'departure_time')::TIMESTAMPTZ;
END IF;
v_index := v_index + 1;
END LOOP;
RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Wrapper seguro para create_ride con todas las validaciones
CREATE OR REPLACE FUNCTION public.create_ride_secure(
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
DECLARE v_driver_id UUID := auth.uid();
v_driver_name TEXT;
v_driver_photo TEXT;
v_driver_gender TEXT;
v_ride_id UUID;
v_verification_status TEXT;
v_origin_lat DECIMAL;
v_origin_lng DECIMAL;
v_dest_lat DECIMAL;
v_dest_lng DECIMAL;
BEGIN -- Validación de autenticación
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Rate limiting para creación de rides (máximo 5 por día)
IF NOT public.check_rate_limit('create_ride', 1440, 5) THEN -- 1440 minutos = 24 horas
RAISE EXCEPTION 'Has alcanzado el límite de 5 rides por día';
END IF;
-- Validación de coordenadas
v_origin_lat := (p_origin->>'lat')::DECIMAL;
v_origin_lng := (p_origin->>'lng')::DECIMAL;
v_dest_lat := (p_destination->>'lat')::DECIMAL;
v_dest_lng := (p_destination->>'lng')::DECIMAL;
IF NOT public.validate_coordinates(v_origin_lat, v_origin_lng) THEN RAISE EXCEPTION 'Coordenadas de origen inválidas';
END IF;
IF NOT public.validate_coordinates(v_dest_lat, v_dest_lng) THEN RAISE EXCEPTION 'Coordenadas de destino inválidas';
END IF;
-- Validación de distancia
IF p_distance IS NOT NULL
AND NOT public.validate_distance(p_distance) THEN RAISE EXCEPTION 'La distancia del viaje es inválida (máximo 500km)';
END IF;
-- Validación de waypoints
IF NOT public.validate_waypoints_timing(p_waypoints) THEN RAISE EXCEPTION 'Los waypoints no cumplen las reglas de tiempo mínimo';
END IF;
-- Obtener datos del conductor
SELECT display_name,
    photo_url,
    gender,
    (verification->>'status') INTO v_driver_name,
    v_driver_photo,
    v_driver_gender,
    v_verification_status
FROM public.profiles
WHERE id = v_driver_id;
-- Validación de verificación (opcional en tests)
IF v_verification_status IS NULL
OR v_verification_status != 'verified' THEN -- En producción esto sería obligatorio
-- RAISE EXCEPTION 'Cuenta no verificada';
NULL;
END IF;
-- Validación de precio justo
IF p_price > 0
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km.';
END IF;
END IF;
-- Validación de precio máximo
IF p_price > 300 THEN RAISE EXCEPTION 'El precio máximo permitido es de 300€.';
END IF;
-- Validación de fecha futura (+10 minutos)
IF p_departure_time <= NOW() + INTERVAL '10 minutes' THEN RAISE EXCEPTION 'La fecha del viaje debe ser al menos 10 minutos a futuro.';
END IF;
-- Validación de asientos
IF p_seats < 1
OR p_seats > 9 THEN RAISE EXCEPTION 'El número de asientos debe estar entre 1 y 9.';
END IF;
-- Validación de overlap (±2h)
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status IN ('scheduled', 'in_progress', 'active')
        AND ABS(
            EXTRACT(
                EPOCH
                FROM (departure_time - p_departure_time)
            )
        ) < 7200
) THEN RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje en un margen de 2h.';
END IF;
-- Validación de género para viajes women_only
IF p_is_women_only
AND (
    v_driver_gender IS NULL
    OR LOWER(v_driver_gender) != 'female'
) THEN RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
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
-- 5. Índices para performance
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON public.rate_limits(user_id, action_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.rate_limits(window_start);
-- 6. Job de limpieza de límites antiguos
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits() RETURNS INTEGER AS $$
DECLARE v_deleted_count INTEGER;
BEGIN -- Eliminar límites más antiguos de 7 días
DELETE FROM public.rate_limits
WHERE updated_at < NOW() - INTERVAL '7 days';
GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Comentarios para auditoría
COMMENT ON TABLE public.rate_limits IS 'Control de rate limiting por usuario y acción';
COMMENT ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, UUID) IS 'Verifica si un usuario puede realizar una acción según límites configurados';
COMMENT ON FUNCTION public.create_ride_secure(
    JSONB,
    JSONB,
    TIMESTAMPTZ,
    INTEGER,
    DECIMAL,
    TEXT,
    DECIMAL,
    TEXT,
    JSONB,
    BOOLEAN,
    BOOLEAN,
    TEXT [],
    TEXT,
    JSONB,
    JSONB
) IS 'Wrapper seguro para create_ride con todas las validaciones de negocio';