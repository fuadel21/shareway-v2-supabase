-- ========================================================
-- MIGRACIÓN: ELITE MATCH ENGINE v3.3 (Full Route Intelligent Search)
-- Objetivo: Soporte Origen -> Waypoint, Waypoint -> Waypoint, Waypoint -> Destino
--           y Trigger de Actualización Automática de Reputación.
-- ========================================================

-- 1. LIMPIEZA DE FUNCIONES ANTERIORES
DROP FUNCTION IF EXISTS public.search_rides_secure(jsonb, jsonb, date, integer, numeric, float);
DROP FUNCTION IF EXISTS public.search_rides_secure(jsonb, jsonb, date, integer, numeric, double precision);

-- 2. EL NUEVO MOTOR DE BÚSQUEDA INTELIGENTE (v3.3 - TRAYECTO TOTAL)
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 10000 
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_eco_tier TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        status TEXT,
        match_score FLOAT 
    ) AS $$
DECLARE v_searcher_id UUID := auth.uid();
DECLARE v_searcher_gender TEXT;
DECLARE v_origin_geog GEOGRAPHY;
DECLARE v_dest_geog GEOGRAPHY;
BEGIN 
    -- 1. Cachear datos del buscador para seguridad
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    -- 2. Normalizar coordenadas de búsqueda
    v_origin_geog := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_dest_geog := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;

    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        COALESCE(p.rating, 0.0)::DECIMAL,
        p.eco_tier,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.status,
        -- CÁLCULO DE MATCH SCORE (0-100)
        (
            -- Proximidad al Origen (35%)
            (1.0 / (1.0 + (LEAST(ST_Distance(r.origin_location, v_origin_geog), COALESCE((SELECT MIN(ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_origin_geog)) FROM jsonb_array_elements(r.waypoints) wp), 999999)) / 1000.0))) * 35 + 
            -- Proximidad al Destino (35%)
            (1.0 / (1.0 + (LEAST(ST_Distance(r.destination_location, v_dest_geog), COALESCE((SELECT MIN(ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_dest_geog)) FROM jsonb_array_elements(r.waypoints) wp), 999999)) / 1000.0))) * 35 + 
            -- Reputación del Conductor (30%)
            (COALESCE(p.rating, 0.0) / 5.0) * 30
        )::FLOAT as match_score
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE 
        r.status IN ('scheduled', 'active')
        AND r.seats_available >= p_seats_needed
        AND r.price <= p_max_price
        
        -- TIEMPO: Mismo día o futuro
        AND (
            (p_date IS NOT NULL AND r.departure_time::DATE = p_date)
            OR
            (p_date IS NULL AND r.departure_time > NOW() - INTERVAL '1 hour')
        )

        -- GEOGRAFÍA: Origen (Cerca del inicio O de cualquier waypoint)
        AND (
            ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(r.waypoints) AS wp
                WHERE ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_origin_geog) < p_max_dist_meters
            )
        )
        
        -- GEOGRAFÍA: Destino (Cerca del final O de cualquier waypoint)
        -- ¡NUEVO v3.3! Permite bajar en paradas intermedias.
        AND (
            ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(r.waypoints) AS wp
                WHERE ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_dest_geog) < p_max_dist_meters
            )
        )

        -- SEGURIDAD
        AND r.driver_id != COALESCE(v_searcher_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND (NOT r.is_women_only OR v_searcher_gender = 'female') 

    ORDER BY match_score DESC, r.departure_time ASC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. TRIGGER DE REPUTACIÓN AUTOMÁTICA
-- Cada vez que se inserta una reseña, recalculamos el promedio del perfil.
CREATE OR REPLACE FUNCTION public.update_user_rating_fn()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET rating = (SELECT COALESCE(AVG(rating), 0.0) FROM public.reviews WHERE target_id = NEW.target_id),
        review_count = (SELECT COUNT(*) FROM public.reviews WHERE target_id = NEW.target_id)
    WHERE id = NEW.target_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_rating ON public.reviews;
CREATE TRIGGER tr_update_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.update_user_rating_fn();
