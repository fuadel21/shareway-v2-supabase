-- ========================================================
-- MIGRACIÓN: EXPIRE OVERDUE RIDES & REQUESTS v2.0
-- Objetivo: Caducar automáticamente viajes y solicitudes cuya hora 
-- de salida o llegada ya pasó con creces, manteniendo el mapa limpio.
-- ========================================================
-- 1. MEJORA DEL MOTOR DE BÚSQUEDA DE VIAJES (Para Pasajeros)
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
BEGIN v_searcher_id := auth.uid();
-- Cachear género del buscador
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
-- Convertir inputs a GEOGRAPHY
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
WHERE r.status IN ('scheduled', 'active') -- CADUCIDAD DINÁMICA DE VIAJES:
    AND (
        -- Si está programado pero no se inició, desaparece 2h después de la salida
        (
            r.status = 'scheduled'
            AND r.departure_time > (NOW() - INTERVAL '2 hours')
        )
        OR -- Si está activo, calculamos: (Distancia / 50km/h) + 3 horas de margen
        (
            r.status = 'active'
            AND r.departure_time > (
                NOW() - (COALESCE(r.distance, 50) / 50.0 || ' hours')::INTERVAL - INTERVAL '3 hours'
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
-- 2. MEJORA DEL MOTOR DE BÚSQUEDA DE SOLICITUDES (Para Conductores)
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
BEGIN v_searcher_id := auth.uid();
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
WHERE r.status = 'pending' -- CADUCIDAD DINÁMICA DE SOLICITUDES:
    -- Las solicitudes desaparecen del radar 1 hora después de su hora de salida prevista
    AND r.departure_time > (NOW() - INTERVAL '1 hour')
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