-- ========================================================
-- MIGRACIÓN: ADVANCED PROACTIVE MATCHING v3.4 (Enterprise Grade)
-- Objetivo: Matching por afinidad, Lista de espera automática y Seguridad de ruta.
-- ========================================================

-- 1. MEJORA DEL MOTOR DE BÚSQUEDA (Ranking por Afinidad Social)
CREATE OR REPLACE FUNCTION public.search_rides_secure(
    p_origin JSONB, p_destination JSONB, p_date DATE DEFAULT NULL, 
    p_seats_needed INTEGER DEFAULT 1, p_max_price DECIMAL DEFAULT 999.99, p_max_dist_meters FLOAT DEFAULT 10000 
) RETURNS TABLE (
    id UUID, driver_id UUID, driver_display_name TEXT, driver_photo_url TEXT, 
    driver_rating DECIMAL, driver_eco_tier TEXT, origin JSONB, destination JSONB, 
    departure_time TIMESTAMPTZ, seats_available INTEGER, price DECIMAL, 
    status TEXT, match_score FLOAT
) AS $$
DECLARE 
    v_searcher_id UUID := auth.uid(); 
    v_searcher_pref JSONB;
    v_searcher_gender TEXT; 
    v_searcher_email TEXT; 
    v_origin_geog GEOGRAPHY; 
    v_dest_geog GEOGRAPHY;
BEGIN 
    -- Obtener preferencias del buscador para el cálculo de afinidad
    IF v_searcher_id IS NOT NULL THEN 
        SELECT preferences, gender, email INTO v_searcher_pref, v_searcher_gender, v_searcher_email 
        FROM public.profiles WHERE id = v_searcher_id; 
    END IF;

    v_origin_geog := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_dest_geog := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;

    RETURN QUERY SELECT 
        r.id, r.driver_id, r.driver_display_name, r.driver_photo_url, 
        COALESCE(p.rating, 0.0)::DECIMAL, p.eco_tier, r.origin, r.destination, 
        r.departure_time, r.seats_available, r.price, r.status,
        (
            -- Proximidad (60%)
            (1.0 / (1.0 + (ST_Distance(r.origin_location, v_origin_geog) / 1000.0))) * 30 + 
            (1.0 / (1.0 + (ST_Distance(r.destination_location, v_dest_geog) / 1000.0))) * 30 + 
            -- Reputación (20%)
            (COALESCE(p.rating, 0.0) / 5.0) * 20 +
            -- AFINIDAD SOCIAL (20% ¡NUEVO!)
            -- Comparamos si coinciden gustos (mascotas, música, charla)
            (CASE WHEN (p.preferences->>'smoking') = (v_searcher_pref->>'smoking') THEN 5 ELSE 0 END) +
            (CASE WHEN (p.preferences->>'pets') = (v_searcher_pref->>'pets') THEN 5 ELSE 0 END) +
            (CASE WHEN (p.preferences->>'music') = (v_searcher_pref->>'music') THEN 10 ELSE 0 END)
        )::FLOAT as match_score
    FROM public.rides r JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status IN ('scheduled', 'active') 
      AND r.seats_available >= p_seats_needed 
      AND r.price <= p_max_price
      AND (p_date IS NULL OR r.departure_time::DATE = p_date)
      AND r.departure_time > NOW()
      AND (ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.waypoints) wp WHERE ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_origin_geog) < p_max_dist_meters))
      AND (ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.waypoints) wp WHERE ST_Distance(ST_SetSRID(ST_MakePoint((wp->>'lng')::FLOAT, (wp->>'lat')::FLOAT), 4326)::GEOGRAPHY, v_dest_geog) < p_max_dist_meters))
      AND (NOT r.is_women_only OR v_searcher_gender = 'female')
      AND (NOT r.is_exclusive_community OR EXISTS (SELECT 1 FROM public.communities c WHERE c.allowed_domain = split_part(v_searcher_email, '@', 2) AND c.name = ANY(r.allowed_communities)))
    ORDER BY match_score DESC;
END; $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 2. TRIGGER: LISTA DE ESPERA INTELIGENTE
-- Se dispara cuando se libera una plaza (seats_available sube de 0 a >0)
CREATE OR REPLACE FUNCTION public.handle_seat_reopening()
RETURNS TRIGGER AS $$
DECLARE
    v_req RECORD;
BEGIN
    IF OLD.seats_available = 0 AND NEW.seats_available > 0 THEN
        FOR v_req IN 
            SELECT requester_id, destination->>'name' as dest_name 
            FROM public.ride_requests 
            WHERE status = 'pending'
              AND ST_Distance(origin_location, NEW.origin_location) < 5000
              AND ST_Distance(destination_location, NEW.destination_location) < 5000
        LOOP
            PERFORM public.create_notification(
                v_req.requester_id,
                '¡Plaza liberada! ✨',
                'Se ha abierto un hueco en un viaje hacia ' || v_req.dest_name || '. ¡Reserva rápido!',
                'seat_available',
                jsonb_build_object('ride_id', NEW.id)
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_seat_reopening ON public.rides;
CREATE TRIGGER tr_seat_reopening
AFTER UPDATE OF seats_available ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.handle_seat_reopening();
