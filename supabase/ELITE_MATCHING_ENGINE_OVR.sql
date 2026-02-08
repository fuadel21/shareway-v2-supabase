-- ========================================================
-- ELITE MATCHING ENGINE OVR (Overdrive Edition) v3
-- Objetivo: Sistema de tracking y visibilidad en tiempo real para viajes en curso.
-- ========================================================
DROP FUNCTION IF EXISTS public.search_rides_secure(jsonb, jsonb, date, integer, numeric, float);
DROP FUNCTION IF EXISTS public.get_available_rides_v2();
-- 1. FEED GLOBAL CON TRACKING (get_available_rides_v2) 
CREATE OR REPLACE FUNCTION public.get_available_rides_v2() RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_verified TEXT,
        driver_eco_tier TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        details TEXT,
        is_women_only BOOLEAN,
        distance DECIMAL,
        status TEXT,
        current_location JSONB -- UBICACIÓN GPS EN TIEMPO REAL
    ) AS $$
DECLARE v_user_id UUID := auth.uid();
DECLARE v_gender TEXT;
BEGIN IF v_user_id IS NOT NULL THEN
SELECT gender INTO v_gender
FROM public.profiles
WHERE id = v_user_id;
END IF;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(prof.rating, 0.0)::DECIMAL,
    (prof.verification->>'status')::TEXT,
    prof.eco_tier,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.details,
    r.is_women_only,
    r.distance,
    r.status,
    r.current_location -- Inyectamos la ubicación actual
FROM public.rides r
    JOIN public.profiles prof ON r.driver_id = prof.id
WHERE (
        (
            r.status = 'scheduled'
            AND r.departure_time > NOW() - INTERVAL '30 minutes'
        )
        OR (r.status IN ('active', 'in_progress'))
    )
    AND r.seats_available > 0
    AND r.driver_id != COALESCE(
        v_user_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_gender IS NULL
            OR v_gender = 'female'
        )
    )
ORDER BY CASE
        WHEN r.status IN ('active', 'in_progress') THEN 0
        ELSE 1
    END ASC,
    r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 2. BÚSQUEDA AVANZADA CON PIVOTE GEOGRÁFICO (search_rides_secure)
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
        status TEXT,
        current_location JSONB,
        -- TRACKING PARA EL MAPA
        match_score FLOAT
    ) AS $$
DECLARE v_user_id UUID := auth.uid();
v_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
BEGIN IF v_user_id IS NOT NULL THEN
SELECT gender INTO v_gender
FROM public.profiles
WHERE id = v_user_id;
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
    r.status,
    r.current_location,
    (
        100.0 - (
            ST_Distance(
                CASE
                    WHEN r.status IN ('active', 'in_progress')
                    AND r.current_location IS NOT NULL THEN ST_SetSRID(
                        ST_MakePoint(
                            (r.current_location->>'lng')::FLOAT,
                            (r.current_location->>'lat')::FLOAT
                        ),
                        4326
                    )::GEOGRAPHY
                    ELSE r.origin_location
                END,
                v_origin_geog
            ) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT as match_score
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active', 'in_progress')
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price
    AND r.driver_id != COALESCE(
        v_user_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_gender IS NULL
            OR v_gender = 'female'
        )
    )
    AND (
        ST_Distance(
            CASE
                WHEN r.status IN ('active', 'in_progress')
                AND r.current_location IS NOT NULL THEN ST_SetSRID(
                    ST_MakePoint(
                        (r.current_location->>'lng')::FLOAT,
                        (r.current_location->>'lat')::FLOAT
                    ),
                    4326
                )::GEOGRAPHY
                ELSE r.origin_location
            END,
            v_origin_geog
        ) < p_max_dist_meters
    )
    AND ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
ORDER BY CASE
        WHEN r.status IN ('active', 'in_progress') THEN 0
        ELSE 1
    END ASC,
    match_score DESC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;