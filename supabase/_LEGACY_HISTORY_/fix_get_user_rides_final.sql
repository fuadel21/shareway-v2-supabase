-- FIX CRÍTICO: Asegurar visibilidad de viajes incluso con perfiles incompletos
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
            'seats_available', r.seats_available,
            'passengers_count', COALESCE(array_length(r.participant_ids, 1), 0),
            'driver_id', r.driver_id,
            'driver_display_name', COALESCE(p.display_name, 'Conductor'),
            'driver_photo_url', COALESCE(p.avatar_url, ''),
            'is_women_only', r.is_women_only,
            'details', r.details
        )
    ) INTO result
    FROM rides r
    LEFT JOIN profiles p ON r.driver_id = p.id -- CAMBIADO A LEFT JOIN
    WHERE
        (p_role = 'driver' AND r.driver_id = p_user_id) OR
        (p_role = 'passenger' AND r.participant_ids @> ARRAY[p_user_id]) OR
        (p_role = 'all' AND (r.driver_id = p_user_id OR r.participant_ids @> ARRAY[p_user_id]));

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
