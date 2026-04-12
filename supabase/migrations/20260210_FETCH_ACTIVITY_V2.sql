-- FUNCTION: fetch_my_activity_v2
-- Returns unified list of rides for a user:
-- 1. Rides they drive
-- 2. Rides they are a confirmed passenger in
-- 3. Rides they have requested (pending)
-- Uses a custom 'status' field for requested rides to simplify frontend logic.
DROP FUNCTION IF EXISTS public.fetch_my_activity_v2(UUID);
CREATE OR REPLACE FUNCTION public.fetch_my_activity_v2(p_user_id UUID) RETURNS SETOF JSONB AS $$ BEGIN RETURN QUERY -- 1. DRIVER: Rides created by user
SELECT jsonb_build_object(
        'id',
        r.id,
        'driver_id',
        r.driver_id,
        'origin',
        r.origin,
        'destination',
        r.destination,
        'departure_time',
        r.departure_time,
        'status',
        r.status,
        -- 'scheduled', 'active', 'completed', 'cancelled'
        'price',
        r.price,
        'seats_total',
        r.seats_total,
        'seats_available',
        r.seats_available,
        'passengers',
        r.passengers,
        'is_women_only',
        r.is_women_only,
        'role',
        'driver',
        'created_at',
        r.created_at
    )
FROM public.rides r
WHERE r.driver_id = p_user_id
UNION ALL
-- 2. PASSENGER: Rides where user is confirmed
SELECT jsonb_build_object(
        'id',
        r.id,
        'driver_id',
        r.driver_id,
        'origin',
        r.origin,
        'destination',
        r.destination,
        'departure_time',
        r.departure_time,
        'status',
        r.status,
        'price',
        r.price,
        'seats_total',
        r.seats_total,
        'seats_available',
        r.seats_available,
        'passengers',
        r.passengers,
        'is_women_only',
        r.is_women_only,
        'role',
        'passenger',
        'created_at',
        r.created_at
    )
FROM public.rides r
WHERE r.driver_id != p_user_id
    AND (
        (r.participant_ids @> ARRAY [p_user_id]) -- Efficient check if array column exists
        OR EXISTS (
            -- Fallback to JSONB check
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) p
            WHERE (p->>'id')::UUID = p_user_id
                AND (p->>'status') IN ('confirmed', 'verified', 'on_board')
        )
    )
UNION ALL
-- 3. REQUESTER: Rides with pending request
SELECT jsonb_build_object(
        'id',
        r.id,
        'driver_id',
        r.driver_id,
        'origin',
        r.origin,
        'destination',
        r.destination,
        'departure_time',
        r.departure_time,
        'status',
        'requested',
        -- Override status for filtering
        'real_ride_status',
        r.status,
        'price',
        r.price,
        'seats_total',
        r.seats_total,
        'seats_available',
        r.seats_available,
        'passengers',
        r.passengers,
        'is_women_only',
        r.is_women_only,
        'role',
        'requester',
        'request_id',
        rr.id,
        'created_at',
        r.created_at
    )
FROM public.ride_requests rr
    JOIN public.rides r ON r.id = rr.ride_id
WHERE rr.passenger_id = p_user_id
    AND rr.status = 'pending' -- Exclude if already in participant_ids (race condition safety)
    -- AND NOT (r.participant_ids @> ARRAY[p_user_id]) 
;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.fetch_my_activity_v2(UUID) TO authenticated;