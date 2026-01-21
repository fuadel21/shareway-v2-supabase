-- ==========================================
-- ELITE_ALGORITHM_OVERHAUL.sql
-- Implementación Integral de Políticas de Calidad y Matching
-- ==========================================
-- 1. Actualización de create_ride con Política de Precio Justo (UE Standard)
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
DECLARE v_driver_id UUID;
v_verification_status TEXT;
v_ride_id UUID;
v_price_per_km DECIMAL;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- [REGLA DE ORO: PRECIO JUSTO]
-- Máximo 0.60€/km para evitar lucro comercial y cumplir normativa carpooling
IF p_distance > 0 THEN v_price_per_km := p_price / p_distance;
IF v_price_per_km > 0.60 THEN RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km permitidos para viajes compartidos.';
END IF;
END IF;
-- [EXISTING VALIDATIONS...]
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'La fecha de salida debe ser en el futuro.';
END IF;
IF p_price < 0.5 THEN RAISE EXCEPTION 'Monto mínimo: 0.50€';
END IF;
-- INSERT...
INSERT INTO public.rides (
        driver_id,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        is_women_only,
        approval_mode,
        origin_location,
        destination_location
    )
VALUES (
        v_driver_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_is_women_only,
        p_approval_mode,
        ST_SetSRID(
            ST_MakePoint(
                (p_origin->>'lng')::FLOAT,
                (p_origin->>'lat')::FLOAT
            ),
            4326
        )::GEOGRAPHY,
        ST_SetSRID(
            ST_MakePoint(
                (p_destination->>'lng')::FLOAT,
                (p_destination->>'lat')::FLOAT
            ),
            4326
        )::GEOGRAPHY
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. Motor de Matching con "Flexible detours" y "Time Window"
-- Esta función sustituye a search_rides_v2 para búsquedas desde el App
CREATE OR REPLACE FUNCTION public.search_rides_elite(
        p_origin_lat FLOAT,
        p_origin_lng FLOAT,
        p_destination_lat FLOAT,
        p_destination_lng FLOAT,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999,
        p_time_window_hours INTEGER DEFAULT 4 -- Horarios flexibles por defecto
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        is_women_only BOOLEAN,
        match_quality FLOAT -- De 0 a 100
    ) AS $$
DECLARE v_passenger_origin GEOGRAPHY;
v_passenger_destination GEOGRAPHY;
v_searcher_id UUID;
v_searcher_gender TEXT;
BEGIN v_searcher_id := auth.uid();
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_passenger_origin := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::GEOGRAPHY;
v_passenger_destination := ST_SetSRID(
    ST_MakePoint(p_destination_lng, p_destination_lat),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    p.rating,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.is_women_only,
    -- Cálculo de Calidad de Match (Heurística Elite)
    (
        100.0 - (
            ST_Distance(r.origin_location, v_passenger_origin) / 100.0
        ) - -- -1pto por cada 100m de desvío
        (
            ST_Distance(r.destination_location, v_passenger_destination) / 100.0
        ) - (
            ABS(
                EXTRACT(
                    EPOCH
                    FROM (r.departure_time - p_departure_time)
                )
            ) / 3600.0
        ) * 5.0 -- -5ptos por cada hora de diferencia
    ) AS match_quality
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status = 'scheduled'
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price -- Filtro Geográfico de Desvío Máximo (e.g., 5km)
    AND ST_Distance(r.origin_location, v_passenger_origin) <= 5000
    AND ST_Distance(r.destination_location, v_passenger_destination) <= 5000 -- Filtro de Ventana Temporal
    AND r.departure_time BETWEEN (
        p_departure_time - (p_time_window_hours || ' hours')::INTERVAL
    )
    AND (
        p_departure_time + (p_time_window_hours || ' hours')::INTERVAL
    ) -- Filtro Women Only
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY match_quality DESC,
    r.departure_time ASC
LIMIT 30;
END;
$$ LANGUAGE plpgsql STABLE;