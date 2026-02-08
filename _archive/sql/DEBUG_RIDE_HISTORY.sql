-- ==========================================
-- DEBUG: Check User Ride History
-- ==========================================
-- This script helps debug why rides don't appear in user history

-- 1. Check if there are any rides created recently
SELECT 
    id,
    driver_id,
    status,
    departure_time,
    created_at,
    passengers,
    participant_ids
FROM public.rides 
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- 2. Check if there are any requests fulfilled recently
SELECT 
    id,
    requester_id,
    driver_id,
    status,
    matched_ride_id,
    fulfilled_at
FROM public.ride_requests 
WHERE status = 'fulfilled' 
    AND fulfilled_at > NOW() - INTERVAL '1 hour'
ORDER BY fulfilled_at DESC;

-- 3. Test get_user_ride_history for a specific user
-- Replace 'YOUR_USER_ID' with an actual user ID from the queries above
-- SELECT * FROM public.get_user_ride_history('YOUR_USER_ID', 100, 0);

-- 4. Check the logic of get_user_ride_history manually
-- This simulates what the function does for a driver
SELECT 
    r.id,
    r.driver_id,
    r.status,
    r.participant_ids,
    'ride' as item_type,
    'driver' as user_role
FROM public.rides r
WHERE r.driver_id = 'YOUR_USER_ID' -- Replace with actual driver ID

UNION ALL

-- This simulates what the function does for a passenger
SELECT 
    rq.id,
    rq.requester_id as driver_id,
    rq.status,
    ARRAY[rq.requester_id] as participant_ids,
    'request' as item_type,
    'passenger' as user_role
FROM public.ride_requests rq
WHERE rq.requester_id = 'YOUR_USER_ID' -- Replace with actual passenger ID
    AND rq.status IN ('cancelled', 'expired', 'fulfilled');

-- 5. Check if the user_role logic is working correctly
SELECT 
    r.id,
    r.driver_id,
    r.participant_ids,
    CASE 
        WHEN r.driver_id = 'YOUR_USER_ID' THEN 'driver'
        WHEN r.participant_ids @> ARRAY['YOUR_USER_ID'] THEN 'passenger'
        ELSE 'unknown'
    END as user_role
FROM public.rides r
WHERE r.driver_id = 'YOUR_USER_ID' 
   OR r.participant_ids @> ARRAY['YOUR_USER_ID'];

-- ==========================================
-- INSTRUCTIONS
-- ==========================================
/*
HOW TO DEBUG:

1. Run queries 1 and 2 to see recent rides and requests
2. Copy a user ID from the results
3. Replace 'YOUR_USER_ID' in queries 3, 4, and 5
4. Run those queries to see what the user should see
5. Compare with what the frontend shows

COMMON ISSUES:
- User ID mismatch (different user logged in)
- participant_ids not updated correctly
- Status filtering issues
- Time zone issues with departure_time

FIXES:
- Ensure participant_ids includes both driver and passenger
- Check that status is correct (should be 'scheduled' or similar)
- Verify user authentication
- Check time zone handling
*/
