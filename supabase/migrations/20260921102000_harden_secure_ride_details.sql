-- ============================================================================
-- Keep get_ride_details_secure as the only authenticated ride-detail surface.
-- The historical implementation remains useful for involved users, but its
-- broad return shape must not be exposed to an unrelated authenticated user.
-- ============================================================================

ALTER FUNCTION public.get_ride_details_secure(UUID)
    RENAME TO get_ride_details_secure_unfiltered;

REVOKE ALL ON FUNCTION public.get_ride_details_secure_unfiltered(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ride_details_secure_unfiltered(UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw JSONB;
    v_data JSONB;
    v_is_participant BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    v_raw := public.get_ride_details_secure_unfiltered(p_ride_id)::JSONB;

    IF COALESCE(v_raw ->> 'success', 'false') <> 'true' THEN
        RETURN v_raw::JSON;
    END IF;

    v_data := v_raw -> 'data';
    v_is_participant := COALESCE((v_data ->> 'is_participant')::BOOLEAN, false)
        OR public.is_current_user_admin();

    -- Drivers, participants, and admins retain the established private detail
    -- contract (including the fields that the protected ride UI needs). A
    -- non-participant receives only a booking-safe public summary.
    IF v_is_participant THEN
        RETURN v_raw::JSON;
    END IF;

    RETURN json_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_data -> 'id',
            'driver_id', v_data -> 'driver_id',
            'status', v_data -> 'status',
            'origin', jsonb_strip_nulls(jsonb_build_object(
                'name', NULLIF(COALESCE(v_data -> 'origin' ->> 'name', v_data -> 'origin' ->> 'label'), ''),
                'address', NULLIF(COALESCE(
                    v_data -> 'origin' ->> 'address',
                    v_data -> 'origin' ->> 'formatted_address',
                    v_data -> 'origin' ->> 'name'
                ), ''),
                'lat', COALESCE(
                    v_data -> 'origin' -> 'lat',
                    v_data -> 'origin' -> 'latitude',
                    v_data -> 'origin' -> 'coordinates' -> 'lat',
                    v_data -> 'origin' -> 'coordinates' -> 'latitude'
                ),
                'lng', COALESCE(
                    v_data -> 'origin' -> 'lng',
                    v_data -> 'origin' -> 'longitude',
                    v_data -> 'origin' -> 'coordinates' -> 'lng',
                    v_data -> 'origin' -> 'coordinates' -> 'longitude'
                )
            )),
            'destination', jsonb_strip_nulls(jsonb_build_object(
                'name', NULLIF(COALESCE(v_data -> 'destination' ->> 'name', v_data -> 'destination' ->> 'label'), ''),
                'address', NULLIF(COALESCE(
                    v_data -> 'destination' ->> 'address',
                    v_data -> 'destination' ->> 'formatted_address',
                    v_data -> 'destination' ->> 'name'
                ), ''),
                'lat', COALESCE(
                    v_data -> 'destination' -> 'lat',
                    v_data -> 'destination' -> 'latitude',
                    v_data -> 'destination' -> 'coordinates' -> 'lat',
                    v_data -> 'destination' -> 'coordinates' -> 'latitude'
                ),
                'lng', COALESCE(
                    v_data -> 'destination' -> 'lng',
                    v_data -> 'destination' -> 'longitude',
                    v_data -> 'destination' -> 'coordinates' -> 'lng',
                    v_data -> 'destination' -> 'coordinates' -> 'longitude'
                )
            )),
            'origin_address', v_data -> 'origin_address',
            'destination_address', v_data -> 'destination_address',
            'departure_time', v_data -> 'departure_time',
            'price', v_data -> 'price',
            'price_per_seat', v_data -> 'price_per_seat',
            'currency', v_data -> 'currency',
            'commission_included', v_data -> 'commission_included',
            'seats_available', v_data -> 'seats_available',
            'available_seats', v_data -> 'available_seats',
            'total_seats', v_data -> 'total_seats',
            'seats_total', v_data -> 'seats_total',
            'distance', v_data -> 'distance',
            'overview_polyline', v_data -> 'overview_polyline',
            'vehicle_model', v_data -> 'vehicle_model',
            'vehicle_plate', NULL,
            'driver', jsonb_build_object(
                'id', v_data -> 'driver' -> 'id',
                'display_name', v_data -> 'driver' -> 'display_name',
                'photo_url', v_data -> 'driver' -> 'photo_url',
                'avatar_url', v_data -> 'driver' -> 'avatar_url',
                'rating', v_data -> 'driver' -> 'rating',
                'verified', v_data -> 'driver' -> 'verified'
            ),
            'passengers', '[]'::JSONB,
            'is_driver', false,
            'is_participant', false
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_details_secure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_details_secure(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_ride_details_secure(UUID) IS
    'Returns private details only to the driver/participants/admins and a redacted booking summary to other authenticated users.';
