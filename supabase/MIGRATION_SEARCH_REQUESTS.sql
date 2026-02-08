-- ==========================================
-- MIGRACIÓN: SEARCH_RIDE_REQUESTS_SECURE
-- Propósito: Permitir a los conductores buscar solicitudes de pasajeros
-- cerca de una ruta o destino.
-- ==========================================
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
-- Cachear género del buscador (conductor)
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
    r.requester_id,
    r.requester_display_name,
    r.requester_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL as requester_rating,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_needed,
    r.suggested_price,
    r.details,
    r.is_women_only,
    -- MATCH SCORE
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT as match_score
FROM public.ride_requests r
    JOIN public.profiles p ON r.requester_id = p.id
WHERE r.status = 'pending'
    AND r.departure_time > NOW() - INTERVAL '2 hours'
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_needed >= p_seats_min -- No mostrar mis propias solicitudes (si el buscador es el mismo usuario)
    AND r.requester_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    ) -- Filtro de género
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    ) -- Proximidad
    AND ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
    AND ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
ORDER BY match_score DESC,
    departure_time ASC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;