-- Keep the activity feed complete for requester history.
--
-- The previous fetch_my_activity_v2 implementation only returned pending
-- requests. That made cancelled, rejected, fulfilled and server-expired
-- requests impossible to reach the My Rides filters even though the rows were
-- still present in ride_requests. The client applies the same effective-status
-- normalization to this payload, so terminal request statuses are preserved
-- instead of being hidden by the RPC.

CREATE OR REPLACE FUNCTION public.fetch_my_activity_v2(p_user_id UUID)
RETURNS SETOF JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    -- 1. Rides created by the user.
    SELECT jsonb_build_object(
        'id', r.id,
        'driver_id', r.driver_id,
        'origin', r.origin,
        'destination', r.destination,
        'departure_time', r.departure_time,
        'status', r.status,
        'price', r.price,
        'seats_available', r.seats_available,
        'passengers', r.passengers,
        'participant_ids', r.participant_ids,
        'is_women_only', r.is_women_only,
        'role', 'driver',
        'created_at', r.created_at
    )
    FROM public.rides r
    WHERE r.driver_id = p_user_id

    UNION ALL

    -- 2. Rides where the user appears as a passenger, including a passenger
    --    cancellation so the activity history does not lose the ride.
    SELECT jsonb_build_object(
        'id', r.id,
        'driver_id', r.driver_id,
        'origin', r.origin,
        'destination', r.destination,
        'departure_time', r.departure_time,
        'status', r.status,
        'price', r.price,
        'seats_available', r.seats_available,
        'passengers', r.passengers,
        'participant_ids', r.participant_ids,
        'is_women_only', r.is_women_only,
        'role', 'passenger',
        'created_at', r.created_at
    )
    FROM public.rides r
    WHERE r.driver_id IS DISTINCT FROM p_user_id
      AND (
        r.participant_ids @> ARRAY[p_user_id]
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS passenger
            WHERE lower(COALESCE(passenger->>'id', passenger->>'user_id', '')) = lower(p_user_id::text)
        )
      )

    UNION ALL

    -- 3. Every request belonging to the user. Keep the request status in a
    --    separate field because the activity card uses status=requested as
    --    its role marker while activityFilters resolves terminal states.
    SELECT jsonb_build_object(
        'id', COALESCE(r.id, rr.ride_id, rr.id),
        'driver_id', r.driver_id,
        'origin', COALESCE(rr.origin, r.origin),
        'destination', COALESCE(rr.destination, r.destination),
        'departure_time', COALESCE(rr.departure_time, r.departure_time),
        'status', 'requested',
        'request_status', rr.status,
        'real_ride_status', r.status,
        'price', COALESCE(rr.suggested_price, r.price),
        'seats_available', r.seats_available,
        'passengers', r.passengers,
        'participant_ids', r.participant_ids,
        'is_women_only', r.is_women_only,
        'role', 'requester',
        'request_id', rr.id,
        'ride_id', rr.ride_id,
        'created_at', COALESCE(rr.created_at, r.created_at)
    )
    FROM public.ride_requests rr
    LEFT JOIN public.rides r ON r.id = rr.ride_id
    WHERE rr.requester_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_activity_v2(UUID) TO authenticated;
