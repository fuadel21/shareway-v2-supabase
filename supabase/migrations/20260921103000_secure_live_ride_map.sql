-- ============================================================================
-- Authenticated live ride map read model
--
-- LiveDashboardMap must not select the rides table directly. This allow-list
-- preserves the route/map use case while keeping financial, passenger, PIN,
-- vehicle-plate, wallet, and ledger columns out of the client response.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_live_ride_map()
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_name TEXT,
    driver_photo TEXT,
    driver_rating NUMERIC,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    status TEXT,
    seats_available INTEGER,
    seats_total INTEGER,
    distance NUMERIC,
    overview_polyline TEXT,
    current_location JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        r.id,
        r.driver_id,
        COALESCE(
            NULLIF(r.driver_display_name, ''),
            NULLIF(p.display_name, ''),
            NULLIF(p.full_name, ''),
            'Conductor ShareWay'
        ) AS driver_name,
        COALESCE(r.driver_photo_url, p.photo_url) AS driver_photo,
        p.rating AS driver_rating,
        r.origin,
        r.destination,
        r.departure_time,
        r.status,
        r.seats_available,
        COALESCE(r.total_seats, r.seats_total, r.seats_available) AS seats_total,
        r.distance,
        r.overview_polyline,
        CASE
            WHEN rl.ride_id IS NULL THEN NULL::JSONB
            ELSE jsonb_build_object(
                'latitude', rl.latitude,
                'longitude', rl.longitude,
                'heading', COALESCE(rl.heading, 0),
                'updated_at', rl.updated_at
            )
        END AS current_location
    FROM public.rides AS r
    LEFT JOIN public.profiles AS p ON p.id = r.driver_id
    LEFT JOIN public.ride_locations AS rl ON rl.ride_id = r.id
    WHERE (
        r.status = 'scheduled'
        AND r.departure_time > NOW()
    )
       OR r.status IN ('active', 'in_progress');
$$;

REVOKE ALL ON FUNCTION public.get_live_ride_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_ride_map() TO authenticated, service_role;

-- Existing authenticated browsing RPCs are curated read models too; they must
-- not be callable by an anonymous client with the default PUBLIC EXECUTE grant.
REVOKE ALL ON FUNCTION public.get_available_rides_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_rides_v2() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_live_ride_map() IS
    'Returns the allow-listed route and live-location snapshot used by the authenticated map; never exposes the rides table directly.';
