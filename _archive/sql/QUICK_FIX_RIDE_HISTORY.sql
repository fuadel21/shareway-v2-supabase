-- ==========================================
-- QUICK FIX: Update get_user_ride_history function
-- ==========================================
-- This script only updates the get_user_ride_history function to include user_role field

-- Drop and recreate the function with user_role field
DROP FUNCTION IF EXISTS public.get_user_ride_history(p_user_id UUID, p_limit INTEGER, p_offset INTEGER);

CREATE OR REPLACE FUNCTION public.get_user_ride_history(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_avatar_url TEXT,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    distance DECIMAL,
    status TEXT,
    passengers JSONB,
    participant_ids UUID[],
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    co2_saved DECIMAL,
    item_type TEXT,
    user_role TEXT
) AS $$
BEGIN
    RETURN QUERY
    -- Rides where user is driver or passenger
    SELECT 
        r.id,
        r.driver_id,
        COALESCE(d.display_name, '')::TEXT as driver_display_name,
        COALESCE(d.photo_url, '')::TEXT as driver_photo_url,
        COALESCE(d.avatar_url, '')::TEXT as driver_avatar_url,
        r.origin,
        r.destination,
        r.departure_time,
        NULL::TIMESTAMPTZ as arrival_time,
        r.seats_available,
        r.price,
        r.distance,
        r.status,
        COALESCE(r.passengers, '[]'::jsonb) as passengers,
        COALESCE(r.participant_ids, ARRAY[]::UUID[]) as participant_ids,
        r.created_at,
        r.updated_at,
        r.co2_saved,
        'ride'::TEXT as item_type,
        CASE 
            WHEN r.driver_id = p_user_id THEN 'driver'::TEXT
            WHEN r.participant_ids @> ARRAY[p_user_id] THEN 'passenger'::TEXT
            ELSE 'unknown'::TEXT
        END as user_role
    FROM public.rides r
    LEFT JOIN public.profiles d ON r.driver_id = d.id
    WHERE r.driver_id = p_user_id 
       OR r.participant_ids @> ARRAY[p_user_id]
    
    UNION ALL
    
    -- Requests where user is the requester
    SELECT 
        rq.id,
        rq.driver_id, -- Quien aceptó (si fue aceptada)
        COALESCE(d.display_name, '')::TEXT as driver_display_name,
        COALESCE(d.photo_url, '')::TEXT as driver_photo_url,
        COALESCE(d.avatar_url, '')::TEXT as driver_avatar_url,
        rq.origin,
        rq.destination,
        rq.departure_time,
        NULL::TIMESTAMPTZ as arrival_time,
        rq.seats_needed as seats_available,
        rq.suggested_price as price,
        rq.distance,
        rq.status,
        '[]'::jsonb as passengers,
        ARRAY[rq.requester_id]::UUID[] as participant_ids,
        rq.created_at,
        rq.updated_at,
        NULL::DECIMAL as co2_saved,
        'request'::TEXT as item_type,
        'passenger'::TEXT as user_role -- El solicitante siempre es pasajero
    FROM public.ride_requests rq
    LEFT JOIN public.profiles d ON rq.driver_id = d.id
    WHERE rq.requester_id = p_user_id 
       AND rq.status IN ('cancelled', 'expired', 'fulfilled')
    
    ORDER BY departure_time DESC, created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_ride_history TO authenticated;

-- ==========================================
-- VERIFICATION
-- ==========================================

-- Verify the function was updated correctly
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'UPDATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname = 'get_user_ride_history' 
    AND pronamespace = 'public'::regnamespace;

-- ==========================================
-- DEBUG TEST (Optional)
-- ==========================================

-- Test the function with your user ID
-- Replace 'YOUR_USER_ID' with your actual user ID
-- SELECT * FROM public.get_user_ride_history('YOUR_USER_ID', 10, 0);

-- ==========================================
-- INSTRUCTIONS
-- ==========================================
/*
QUICK FIX FOR MISSING RIDES IN HISTORY:

PROBLEM:
- Rides created by accepting requests don't appear in "Mis Viajes"
- Frontend expects user_role field but function doesn't provide it

SOLUTION:
- Updated get_user_ride_history to include user_role field
- Fixed logic for determining driver vs passenger role
- Ensured participant_ids filtering works correctly

HOW TO USE:
1. Execute this script in Supabase SQL Editor
2. Refresh your browser
3. Check "Mis Viajes" again

EXPECTED RESULT:
- Rides you created as driver should appear
- Rides you joined as passenger should appear
- Requests you cancelled should appear
- Roles should be correctly identified
*/
