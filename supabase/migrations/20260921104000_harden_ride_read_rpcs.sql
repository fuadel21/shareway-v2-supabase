-- ============================================================================
-- Harden historical ride read RPCs
--
-- These functions are curated read models, not public table access. Restrict
-- execution to authenticated callers and make get_user_rides derive identity
-- from auth.uid() instead of trusting a caller-supplied user id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_rides(
    p_user_id UUID DEFAULT NULL,
    p_role TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_user_id UUID := auth.uid();
    v_role TEXT := lower(COALESCE(p_role, 'all'));
    v_result JSONB;
BEGIN
    IF v_auth_user_id IS NULL
       OR (p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_auth_user_id)
       OR v_role NOT IN ('driver', 'passenger', 'all') THEN
        RETURN '[]'::JSONB;
    END IF;

    SELECT jsonb_agg(ride_rows.rides_data ORDER BY (ride_rows.rides_data ->> 'departure_time')::TIMESTAMPTZ DESC)
      INTO v_result
      FROM (
          SELECT jsonb_build_object(
              'id', r.id,
              'origin', r.origin,
              'destination', r.destination,
              'departure_time', r.departure_time,
              'status', r.status,
              'price', r.price,
              'seats_available', r.seats_available,
              'passengers_count', GREATEST(COALESCE(array_length(r.participant_ids, 1) - 1, 0), 0),
              'driver_id', r.driver_id,
              'driver_display_name', p.display_name,
              'driver_photo_url', p.photo_url,
              'participant_ids', r.participant_ids,
              'passengers', r.passengers,
              'distance', r.distance,
              'overview_polyline', r.overview_polyline,
              'details', r.details,
              'my_role', CASE
                  WHEN r.driver_id = v_auth_user_id THEN 'driver'
                  ELSE 'passenger'
              END
          ) AS rides_data
          FROM public.rides AS r
          JOIN public.profiles AS p ON p.id = r.driver_id
          WHERE (
              (v_role = 'driver' AND r.driver_id = v_auth_user_id)
              OR (
                  v_role = 'passenger'
                  AND v_auth_user_id = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                  AND r.driver_id IS DISTINCT FROM v_auth_user_id
              )
              OR (
                  v_role = 'all'
                  AND (
                      r.driver_id = v_auth_user_id
                      OR v_auth_user_id = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                  )
              )
          )
      ) AS ride_rows;

    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_rides(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rides(UUID, TEXT) TO authenticated, service_role;

-- Both search RPCs are curated read models for the protected application. No
-- anonymous caller should be able to enumerate rides by invoking them.
REVOKE ALL ON FUNCTION public.search_rides_by_corridor(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_rides_by_corridor(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_rides(UUID, TEXT) IS
    'Returns only the authenticated user''s own driver/passenger rides; caller-supplied identities cannot enumerate other users.';
