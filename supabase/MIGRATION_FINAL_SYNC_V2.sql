-- ========================================================
-- MIGRACIÓN: FINAL SYNC V2 (REPARACIÓN DE VISIBILIDAD)
-- Objetivo: Mantener viajes 'active' visibles en el mapa
-- ========================================================

DROP FUNCTION IF EXISTS public.get_available_rides_v2();

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
        status TEXT -- ✅ AÑADIDO: Para que el mapa sepa el color
    ) AS $$
DECLARE v_searcher_id UUID;
DECLARE v_searcher_gender TEXT;
BEGIN 
    v_searcher_id := auth.uid();
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    RETURN QUERY
    SELECT r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        COALESCE(p.rating, 0.0)::DECIMAL,
        (p.verification->>'status')::TEXT as driver_verified,
        p.eco_tier,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.is_women_only,
        r.distance,
        r.status -- ✅ AÑADIDO
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE 
        -- CAMBIO CRÍTICO: Permitimos viajes futuros programados O viajes actuales en curso
        (
            (r.status = 'scheduled' AND r.departure_time > NOW() - INTERVAL '15 minutes')
            OR 
            (r.status = 'active')
        )
        AND r.seats_available > 0
        AND r.driver_id != COALESCE(v_searcher_id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND (
            NOT r.is_women_only
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
    ORDER BY r.departure_time ASC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;
