-- ==========================================
-- FINAL MIGRATION: UNIFIED STATE MACHINE & RPC SYNC
-- ==========================================
-- 1. Redefine get_available_rides_v2 to include 'active' rides
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
        distance DECIMAL
    ) AS $$
DECLARE v_searcher_id UUID;
v_searcher_gender TEXT;
BEGIN v_searcher_id := auth.uid();
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE public.profiles.id = v_searcher_id;
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
    r.distance
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active') -- [FIX] Allow active rides to be seen
    AND r.seats_available > 0
    AND r.departure_time > NOW()
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
ORDER BY CASE
        WHEN p.eco_tier = 'Forest' THEN 1
        WHEN p.eco_tier = 'Tree' THEN 2
        WHEN p.eco_tier = 'Sapling' THEN 3
        ELSE 4
    END ASC,
    r.departure_time ASC
LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;
-- 2. Update the Search Rides logic
CREATE OR REPLACE FUNCTION public.search_rides_v2(
        p_origin_lat FLOAT,
        p_origin_lng FLOAT,
        p_dest_lat FLOAT,
        p_dest_lng FLOAT,
        p_date DATE DEFAULT NULL,
        p_max_dist_meters FLOAT DEFAULT 5000
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_verified TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL
    ) AS $$ BEGIN RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL,
    (p.verification->>'status')::TEXT as driver_verified,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active')
    AND r.seats_available > 0
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND ST_Distance(
        r.origin_location,
        ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::geography
    ) < p_max_dist_meters
    AND ST_Distance(
        r.destination_location,
        ST_SetSRID(ST_MakePoint(p_dest_lng, p_dest_lat), 4326)::geography
    ) < p_max_dist_meters
ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE;
-- 3. Update Activate Ride (Background/Manual transition to 'active')
CREATE OR REPLACE FUNCTION public.activate_ride(p_ride_id UUID) RETURNS JSON AS $$ BEGIN
UPDATE public.rides
SET status = 'active'
WHERE id = p_ride_id
    AND status = 'scheduled'
    AND departure_time <= NOW() + INTERVAL '30 minutes';
RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;