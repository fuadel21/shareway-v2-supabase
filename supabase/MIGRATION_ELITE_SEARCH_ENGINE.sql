-- ==========================================
-- MIGRATION: ELITE_SEARCH_ENGINE_V3 (FAIL-SAFE)
-- Advanced spatial search with smart ranking and multi-criteria filtering.
-- Updated with fail-safe spatial filters for when GPS is unavailable.
-- ==========================================
-- 1. Force drop to sync signature
DROP FUNCTION IF EXISTS public.search_rides_secure(JSONB, JSONB, DATE);
DROP FUNCTION IF EXISTS public.search_rides_secure(JSONB, JSONB, DATE, INTEGER, DECIMAL, FLOAT);
-- 2. New Elite Search Function
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000 -- 15km default
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
        passengers_count INTEGER
    ) AS $$
DECLARE v_searcher_id UUID;
v_searcher_gender TEXT;
BEGIN v_searcher_id := auth.uid();
-- Get searcher gender for Women Only filter
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL as driver_rating,
    p.eco_tier as driver_eco_tier,
    (p.verification->>'status')::TEXT as driver_verified,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0)
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active')
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price -- SPATIAL PRECISION: Fail-safe logic for missing coordinates
    AND (
        (
            p_origin->>'lat' IS NULL
            OR p_origin->>'lng' IS NULL
        )
        OR ST_Distance(
            r.origin_location,
            ST_SetSRID(
                ST_MakePoint(
                    (p_origin->>'lng')::FLOAT,
                    (p_origin->>'lat')::FLOAT
                ),
                4326
            )::geography
        ) < p_max_dist_meters
    )
    AND (
        (
            p_destination->>'lat' IS NULL
            OR p_destination->>'lng' IS NULL
        )
        OR ST_Distance(
            r.destination_location,
            ST_SetSRID(
                ST_MakePoint(
                    (p_destination->>'lng')::FLOAT,
                    (p_destination->>'lat')::FLOAT
                ),
                4326
            )::geography
        ) < p_max_dist_meters
    ) -- SECURITY: Don't show your own rides
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    ) -- SAFETY: Women Only filter
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY -- SMART RANKING: 
    -- 1. Reputation (Eco-Tier)
    CASE
        WHEN p.eco_tier = 'Forest' THEN 1
        WHEN p.eco_tier = 'Tree' THEN 2
        WHEN p.eco_tier = 'Sapling' THEN 3
        ELSE 4
    END ASC,
    -- 2. Rating
    p.rating DESC,
    -- 3. Proximity in time
    r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;