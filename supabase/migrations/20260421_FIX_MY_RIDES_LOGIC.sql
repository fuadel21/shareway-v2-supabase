-- CORRECCIÓN CRÍTICA: get_user_rides para visibilidad total
-- Asegura que el conductor vea sus viajes publicados y el pasajero sus reservas.

DROP FUNCTION IF EXISTS public.get_user_rides(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.get_user_rides(
    p_user_id UUID DEFAULT NULL,
    p_role TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID := COALESCE(p_user_id, auth.uid());
    result JSONB;
BEGIN
    SELECT jsonb_agg(rides_data)
    FROM (
        SELECT
            r.id,
            r.origin,
            r.destination,
            r.departure_time,
            r.status,
            r.price,
            r.seats_available,
            COALESCE(array_length(r.participant_ids, 1) - 1, 0) as passengers_count, -- -1 porque el conductor suele estar en la lista
            r.driver_id,
            p.display_name as driver_display_name,
            p.photo_url as driver_photo_url,
            r.participant_ids,
            r.passengers,
            r.distance,
            r.overview_polyline,
            r.details,
            CASE
                WHEN r.driver_id = v_user_id THEN 'driver'
                ELSE 'passenger'
            END as my_role
        FROM public.rides r
        JOIN public.profiles p ON r.driver_id = p.id
        WHERE
            (
                (p_role = 'driver' AND r.driver_id = v_user_id) OR
                (p_role = 'passenger' AND v_user_id = ANY(r.participant_ids) AND r.driver_id != v_user_id) OR
                (p_role = 'all' AND (r.driver_id = v_user_id OR v_user_id = ANY(r.participant_ids)))
            )
        ORDER BY r.departure_time DESC
    ) rides_data INTO result;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
