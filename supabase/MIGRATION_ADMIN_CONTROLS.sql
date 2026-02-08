-- ========================================================
-- MIGRACIÓN: ADMIN PLATFORM CONTROLS & SMART EXPIRY SETTINGS
-- Objetivo: Proporcionar control sobre parámetros del sistema
-- ========================================================
-- 1. Tabla de Configuración de la Plataforma
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);
-- Insertar valores por defecto para Smart Expiry
INSERT INTO public.platform_settings (key, value, description)
VALUES (
        'scheduled_ride_expiry_hours',
        '2',
        'Horas después de la salida para ocultar viajes no iniciados.'
    ),
    (
        'active_ride_buffer_hours',
        '3',
        'Margen de horas extra sobre el tiempo estimado de viaje para viajes activos.'
    ),
    (
        'ride_request_expiry_hours',
        '1',
        'Horas después de la salida para ocultar solicitudes de pasajeros.'
    ) ON CONFLICT (key) DO NOTHING;
-- 2. Función para obtener estado de salud (Implementación real)
CREATE OR REPLACE FUNCTION public.get_admin_health_dashboard() RETURNS JSON AS $$
DECLARE v_notifications_count INTEGER;
v_suspended_count INTEGER;
v_disputes_count INTEGER;
v_expired_rides_count INTEGER;
v_expired_requests_count INTEGER;
BEGIN -- Verificar si es admin (Simulado con check de metadata o tabla)
-- IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
--     RAISE EXCEPTION 'No autorizado';
-- END IF;
SELECT COUNT(*) INTO v_notifications_count
FROM public.notifications
WHERE created_at < (NOW() - INTERVAL '30 days');
SELECT COUNT(*) INTO v_suspended_count
FROM public.profiles
WHERE (verification->>'status') = 'suspended';
SELECT COUNT(*) INTO v_disputes_count
FROM public.disputes
WHERE status = 'pending';
-- Contar viajes que serían caducados por la lógica actual
SELECT COUNT(*) INTO v_expired_rides_count
FROM public.rides
WHERE status IN ('scheduled', 'active')
    AND departure_time < (NOW() - INTERVAL '24 hours');
-- Estimación simple para el dashboard
RETURN json_build_object(
    'success',
    true,
    'notifications_to_clean',
    v_notifications_count,
    'suspended_users',
    v_suspended_count,
    'disputes_pending',
    v_disputes_count,
    'expired_elements_estimate',
    v_expired_rides_count
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Funciones de Gestión de Configuración
CREATE OR REPLACE FUNCTION public.get_platform_settings() RETURNS JSON AS $$ BEGIN RETURN (
        SELECT json_agg(platform_settings)
        FROM public.platform_settings
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value JSONB) RETURNS JSON AS $$ BEGIN
UPDATE public.platform_settings
SET value = p_value,
    updated_at = NOW(),
    updated_by = auth.uid()
WHERE key = p_key;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Modificar el Motor de Búsqueda para usar estas variables dinámicas
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_eco_tier TEXT,
        driver_verified TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL,
        is_women_only BOOLEAN,
        passengers_count INTEGER,
        match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID;
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
v_exp_hours_scheduled FLOAT;
v_exp_hours_active_buffer FLOAT;
BEGIN v_searcher_id := auth.uid();
-- Cargar preferencias dinámicas
SELECT (value->>0)::FLOAT INTO v_exp_hours_scheduled
FROM public.platform_settings
WHERE key = 'scheduled_ride_expiry_hours';
SELECT (value->>0)::FLOAT INTO v_exp_hours_active_buffer
FROM public.platform_settings
WHERE key = 'active_ride_buffer_hours';
-- Valores por defecto si no existen
v_exp_hours_scheduled := COALESCE(v_exp_hours_scheduled, 2.0);
v_exp_hours_active_buffer := COALESCE(v_exp_hours_active_buffer, 3.0);
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL,
    p.eco_tier,
    (p.verification->>'status')::TEXT,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0),
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active')
    AND (
        (
            r.status = 'scheduled'
            AND r.departure_time > (
                NOW() - (v_exp_hours_scheduled || ' hours')::INTERVAL
            )
        )
        OR (
            r.status = 'active'
            AND r.departure_time > (
                NOW() - (COALESCE(r.distance, 100) / 40.0 || ' hours')::INTERVAL - (v_exp_hours_active_buffer || ' hours')::INTERVAL
            )
        )
    )
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price
    AND (
        ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
        OR ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
    )
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY match_score DESC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.search_ride_requests_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_min INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID,
        requester_id UUID,
        requester_display_name TEXT,
        requester_photo_url TEXT,
        requester_rating DECIMAL,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_needed INTEGER,
        suggested_price NUMERIC,
        details TEXT,
        is_women_only BOOLEAN,
        match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID;
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
v_exp_hours_request FLOAT;
BEGIN v_searcher_id := auth.uid();
SELECT (value->>0)::FLOAT INTO v_exp_hours_request
FROM public.platform_settings
WHERE key = 'ride_request_expiry_hours';
v_exp_hours_request := COALESCE(v_exp_hours_request, 1.0);
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.requester_id,
    r.requester_display_name,
    r.requester_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_needed,
    r.suggested_price,
    r.details,
    r.is_women_only,
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT
FROM public.ride_requests r
    JOIN public.profiles p ON r.requester_id = p.id
WHERE r.status = 'pending'
    AND r.departure_time > (
        NOW() - (v_exp_hours_request || ' hours')::INTERVAL
    )
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_needed >= p_seats_min
    AND r.requester_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
    AND (
        ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
        OR ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
    )
ORDER BY match_score DESC,
    departure_time ASC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;