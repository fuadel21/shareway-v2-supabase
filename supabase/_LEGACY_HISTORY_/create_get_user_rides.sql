CREATE OR REPLACE FUNCTION public.get_user_rides(p_user_id UUID, p_role TEXT DEFAULT 'all')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'origin', r.origin,
            'destination', r.destination,
            'departure_time', r.departure_time,
            'status', r.status,
            'price', r.price,
            'seats', r.seats_available, -- Should ideally be total seats
            'seats_available', r.seats_available,
            'seats_total', 4, -- Default/Hardcoded for now as it's not always in schema
            'passengers_count', COALESCE(array_length(r.participant_ids, 1), 0),
            'driver_id', r.driver_id,
            'driver_display_name', p.display_name,
            'driver_photo_url', COALESCE(p.avatar_url, ''),
            'participant_ids', COALESCE(r.participant_ids, '{}'),
            'passengers', COALESCE(r.passengers, '[]'::jsonb),
            'distance', r.distance,
            'overview_polyline', r.overview_polyline,
            'details', r.details
        )
    ) INTO result
    FROM rides r
    JOIN profiles p ON r.driver_id = p.id
    WHERE
        CASE
            WHEN p_role = 'driver' THEN r.driver_id = p_user_id
            WHEN p_role = 'passenger' THEN r.participant_ids @> ARRAY[p_user_id]
            ELSE (r.driver_id = p_user_id OR r.participant_ids @> ARRAY[p_user_id])
        END;

    -- Return empty array if null
    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
