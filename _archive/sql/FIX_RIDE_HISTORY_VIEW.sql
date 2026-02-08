-- ==========================================
-- FIX: Include cancelled requests in ride history
-- ==========================================
-- We need to modify the database structure and create a view
-- that combines rides and ride_requests for the history

-- 1. Create a unified view for user's ride history
CREATE OR REPLACE VIEW public.user_ride_history AS
SELECT 
    -- Ride data
    r.id,
    r.driver_id,
    r.origin,
    r.destination,
    r.departure_time,
    NULL as arrival_time, -- Placeholder for consistency
    r.seats_available,
    r.price,
    r.distance,
    r.status,
    r.passengers,
    r.participant_ids,
    r.created_at,
    r.updated_at,
    r.co2_saved,
    'ride' as item_type,
    -- Driver info
    d.display_name as driver_display_name,
    d.photo_url as driver_photo_url,
    d.avatar_url as driver_avatar_url
FROM public.rides r
LEFT JOIN public.profiles d ON r.driver_id = d.id

UNION ALL

SELECT 
    -- Request data (convert to ride-like format)
    rq.id,
    rq.requester_id as driver_id, -- Use requester_id as driver_id for consistency
    rq.origin,
    rq.destination,
    rq.departure_time,
    NULL as arrival_time, -- Placeholder for consistency
    rq.seats_needed as seats_available,
    rq.suggested_price as price,
    rq.distance,
    rq.status,
    '[]'::jsonb as passengers,
    ARRAY[rq.requester_id] as participant_ids,
    rq.created_at,
    rq.updated_at,
    NULL as co2_saved,
    'request' as item_type,
    -- Requester info (as driver info for consistency)
    p.display_name as driver_display_name,
    p.photo_url as driver_photo_url,
    p.avatar_url as driver_avatar_url
FROM public.ride_requests rq
LEFT JOIN public.profiles p ON rq.requester_id = p.id
WHERE rq.status IN ('cancelled', 'expired', 'fulfilled');

-- 2. Create a function to get user's complete ride history
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
    item_type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.id,
        h.driver_id,
        h.driver_display_name,
        h.driver_photo_url,
        h.driver_avatar_url,
        h.origin,
        h.destination,
        h.departure_time,
        h.arrival_time,
        h.seats_available,
        h.price,
        h.distance,
        h.status,
        h.passengers,
        h.participant_ids,
        h.created_at,
        h.updated_at,
        h.co2_saved,
        h.item_type
    FROM public.user_ride_history h
    WHERE h.driver_id = p_user_id 
       OR h.participant_ids @> ARRAY[p_user_id]
    ORDER BY h.departure_time DESC, h.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. Grant permissions
GRANT SELECT ON public.user_ride_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_ride_history TO authenticated;

-- 4. Note: Indexes are created on the underlying tables (rides and ride_requests)
-- The view will benefit from these existing indexes for performance

-- ==========================================
-- VERIFICATION
-- ==========================================

-- Test the view (replace with real user ID)
/*
SELECT * FROM public.user_ride_history 
WHERE driver_id = 'your-user-id' 
   OR participant_ids @> ARRAY['your-user-id']
ORDER BY departure_time DESC 
LIMIT 10;
*/

-- Test the function (replace with real user ID)
/*
SELECT * FROM public.get_user_ride_history('your-user-id', 10, 0);
*/

-- ==========================================
-- FRONTEND UPDATE NEEDED
-- ==========================================
/*
In MyRides.jsx, replace the fetchRides function with:

const fetchRides = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
        const { data, error } = await supabase
            .rpc('get_user_ride_history', {
                p_user_id: user.id,
                p_limit: 100,
                p_offset: 0
            });

        if (error) throw error;
        setMyRides(data || []);
    } catch (e) {
        console.error("Fetch rides failed:", e);
        toast.error(t('my_rides.error_sync') || "Error al sincronizar tu historial.");
    } finally {
        setLoading(false);
    }
}, [user?.id, t]);
*/
