
-- 7. ACTUALIZAR FEED GLOBAL
-- Redefinimos get_available_rides_v2 para incluir eco_tier
-- Corregido: Ambivalencia de columna "id" y calificación de "rating"
CREATE OR REPLACE FUNCTION public.get_available_rides_v2()
RETURNS TABLE (
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
    distance DECIMAL
) AS $$
DECLARE
    v_searcher_id UUID;
    v_searcher_gender TEXT;
BEGIN
    v_searcher_id := auth.uid();
    
    IF v_searcher_id IS NOT NULL THEN
        -- Corregido: Especificar tabla para evitar ambigüedad con el parámetro de salida 'id'
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE public.profiles.id = v_searcher_id;
    END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        COALESCE(p.rating, 0.0)::DECIMAL, -- Manejo de nulos y cast
        (p.verification->>'status')::TEXT as driver_verified,
        p.eco_tier,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.is_women_only,
        r.distance
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time > NOW()
        AND r.driver_id != v_searcher_id
        AND (
            NOT r.is_women_only 
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
    ORDER BY 
        CASE 
            WHEN p.eco_tier = 'Forest' THEN 1 
            WHEN p.eco_tier = 'Tree' THEN 2 
            WHEN p.eco_tier = 'Sapling' THEN 3 
            ELSE 4 
        END ASC,
        r.departure_time ASC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;
