-- ==========================================
-- MAP LOGIC VERIFICATION: Request to Ride Conversion
-- ==========================================
-- This script ensures that when a request is accepted:
-- 1. Request status changes to 'fulfilled' (disappears from map)
-- 2. New ride is created (appears on map as available seat)
-- 3. Map filtering works correctly

-- ==========================================
-- 1. VERIFY CURRENT REQUEST STATES
-- ==========================================

-- Check all recent requests and their status
SELECT 
    rq.id,
    rq.requester_id,
    rq.status,
    rq.matched_ride_id,
    rq.driver_id,
    rq.fulfilled_at,
    rq.departure_time,
    rq.created_at,
    CASE 
        WHEN rq.status = 'pending' THEN 'VISIBLE ON MAP'
        WHEN rq.status = 'fulfilled' THEN 'HIDDEN FROM MAP'
        ELSE 'OTHER STATUS'
    END as map_visibility
FROM public.ride_requests rq
WHERE rq.created_at > NOW() - INTERVAL '2 hours'
ORDER BY rq.created_at DESC;

-- ==========================================
-- 2. VERIFY CORRESPONDING RIDES
-- ==========================================

-- Check rides created from accepted requests
SELECT 
    r.id,
    r.driver_id,
    r.status,
    r.seats_available,
    r.seats_total,
    r.passengers,
    r.participant_ids,
    r.created_at,
    'VISIBLE ON MAP' as map_visibility,
    'AVAILABLE FOR OTHER USERS' as availability
FROM public.rides r
WHERE r.created_at > NOW() - INTERVAL '2 hours'
    AND r.status NOT IN ('cancelled', 'completed')
ORDER BY r.created_at DESC;

-- ==========================================
-- 3. TEST THE MAP FILTERING LOGIC
-- ==========================================

-- This simulates what Dashboard.jsx does for requests
SELECT 
    COUNT(*) as pending_requests_count,
    'These should appear on map' as description
FROM public.ride_requests 
WHERE status = 'pending' 
    AND departure_time >= NOW() - INTERVAL '2 hours'

UNION ALL

SELECT 
    COUNT(*) as fulfilled_requests_count,
    'These should NOT appear on map' as description
FROM public.ride_requests 
WHERE status = 'fulfilled';

-- ==========================================
-- 4. VERIFY FULFILLMENT PROCESS
-- ==========================================

-- Check if requests are being properly fulfilled
SELECT 
    rq.id as request_id,
    rq.status as request_status,
    r.id as ride_id,
    r.status as ride_status,
    r.driver_id as ride_driver,
    rq.driver_id as request_driver,
    CASE 
        WHEN rq.status = 'fulfilled' AND r.id IS NOT NULL THEN '✅ CORRECT'
        WHEN rq.status = 'pending' AND r.id IS NULL THEN '✅ CORRECT (still pending)'
        ELSE '❌ INCORRECT'
    END as status_check
FROM public.ride_requests rq
LEFT JOIN public.rides r ON rq.matched_ride_id = r.id
WHERE rq.created_at > NOW() - INTERVAL '2 hours'
ORDER BY rq.created_at DESC;

-- ==========================================
-- 5. MANUAL FIX (if needed)
-- ==========================================

-- If you find requests that should be fulfilled but aren't, you can manually fix them:
-- UPDATE public.ride_requests 
-- SET status = 'fulfilled', 
--     driver_id = 'DRIVER_UUID_HERE',
--     matched_ride_id = 'RIDE_UUID_HERE',
--     fulfilled_at = NOW()
-- WHERE id = 'REQUEST_UUID_HERE' AND status = 'pending';

-- ==========================================
-- 6. REAL-TIME VERIFICATION
-- ==========================================

-- Create a function to test the complete flow
CREATE OR REPLACE FUNCTION public.verify_request_flow(p_request_id UUID) RETURNS JSON AS $$
DECLARE
    v_request_status TEXT;
    v_ride_id UUID;
    v_ride_status TEXT;
    v_result JSON;
BEGIN
    -- Get request status
    SELECT status, matched_ride_id INTO v_request_status, v_ride_id
    FROM public.ride_requests
    WHERE id = p_request_id;
    
    -- Get ride status if exists
    SELECT status INTO v_ride_status
    FROM public.rides
    WHERE id = v_ride_id;
    
    -- Build result
    v_result := json_build_object(
        'request_id', p_request_id,
        'request_status', v_request_status,
        'matched_ride_id', v_ride_id,
        'ride_status', v_ride_status,
        'map_visibility', CASE 
            WHEN v_request_status = 'pending' THEN 'VISIBLE'
            WHEN v_request_status = 'fulfilled' THEN 'HIDDEN'
            ELSE 'UNKNOWN'
        END,
        'flow_status', CASE 
            WHEN v_request_status = 'fulfilled' AND v_ride_id IS NOT NULL THEN '✅ COMPLETE'
            WHEN v_request_status = 'pending' AND v_ride_id IS NULL THEN '⏳ WAITING'
            ELSE '❌ BROKEN'
        END
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_request_flow TO authenticated;

-- ==========================================
-- INSTRUCTIONS
-- ==========================================
/*
HOW TO VERIFY THE MAP LOGIC:

1. CHECK CURRENT STATE:
   Run queries 1 and 2 to see recent requests and rides

2. VERIFY FILTERING:
   Run query 3 to see what the map should show vs hide

3. CHECK FULFILLMENT:
   Run query 4 to verify the request-to-ride conversion

4. TEST SPECIFIC REQUEST:
   Run: SELECT public.verify_request_flow('REQUEST_UUID_HERE');

EXPECTED BEHAVIOR:
✅ Pending requests appear on map
✅ Fulfilled requests disappear from map  
✅ New rides appear as available seats
✅ Map filtering works correctly

IF ISSUES FOUND:
- Check fulfill_ride_request function
- Verify request status updates
- Check frontend refresh logic
- Consider manual fix with query 5
*/
