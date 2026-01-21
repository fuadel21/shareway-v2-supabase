-- ========================================================
-- MIGRACIÓN: ELITE SEARCH ENGINE V2 (Incorporaciones) - REPARADA
-- Objetivo: Permitir que pasajeros encuentren y reserven viajes en curso
-- ========================================================

-- FASE DE LIMPIEZA: Eliminar la función antigua para permitir cambio de esquema de retorno
DROP FUNCTION IF EXISTS public.search_rides_secure(jsonb, jsonb, date, integer, numeric, float);
DROP FUNCTION IF EXISTS public.search_rides_secure(jsonb, jsonb, date, integer, numeric, double precision);

CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID, driver_id UUID, driver_display_name TEXT, driver_photo_url TEXT,
        driver_rating DECIMAL, driver_eco_tier TEXT, driver_verified TEXT,
        origin JSONB, destination JSONB, departure_time TIMESTAMPTZ,
        seats_available INTEGER, price DECIMAL, distance DECIMAL,
        is_women_only BOOLEAN, passengers_count INTEGER, status TEXT, 
        current_location JSONB, match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID; v_searcher_gender TEXT; v_origin_geog GEOGRAPHY;
BEGIN 
    v_searcher_id := auth.uid();
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    -- Coordenadas de búsqueda del pasajero
    v_origin_geog := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;

    RETURN QUERY
    SELECT r.id, r.driver_id, r.driver_display_name, r.driver_photo_url,
        COALESCE(p.rating, 0.0)::DECIMAL, p.eco_tier, (p.verification->>'status')::TEXT,
        r.origin, r.destination, r.departure_time, r.seats_available, r.price, r.distance,
        r.is_women_only, COALESCE(jsonb_array_length(r.passengers), 0), r.status,
        r.current_location,
        -- SCORE DE MATCH: Si el viaje es 'active', medimos la distancia a la UBICACIÓN ACTUAL del coche
        -- Nota: Usamos ST_SetSRID si current_location se guarda como punto, o extraemos de JSONB
        (100.0 - (ST_Distance(
            COALESCE(
                ST_SetSRID(ST_MakePoint((r.current_location->>'lng')::float, (r.current_location->>'lat')::float), 4326)::geography, 
                r.origin_location
            ), 
            v_origin_geog
        ) / 200.0))::FLOAT
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE 
        (r.status = 'scheduled' OR r.status = 'active')
        AND r.seats_available >= p_seats_needed
        AND r.driver_id != COALESCE(v_searcher_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND (
            NOT r.is_women_only
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
        -- Filtro Geográfico dinámico: cerca del origen O cerca del coche en movimiento
        AND ST_Distance(
            COALESCE(
                ST_SetSRID(ST_MakePoint((r.current_location->>'lng')::float, (r.current_location->>'lat')::float), 4326)::geography, 
                r.origin_location
            ), 
            v_origin_geog
        ) < p_max_dist_meters
    ORDER BY CASE WHEN r.status = 'active' THEN 0 ELSE 1 END ASC, r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
