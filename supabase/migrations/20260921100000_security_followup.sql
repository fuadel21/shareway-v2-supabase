-- ============================================================================
-- ShareWay security follow-up
--
-- This migration closes the gaps left by the historical PIN/SOS/tracking
-- migrations. It is intentionally additive and does not touch pricing,
-- payments, refunds, penalties, settlement, or the financial ledger.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Rides are not a public read model. Explore/search uses dedicated RPCs;
--    direct REST reads are limited to the driver, active participants, and
--    administrators. This prevents an authenticated but unrelated user from
--    selecting passengers, PIN-bearing JSON, wallet-related fields, or other
--    columns that are not part of the public ride card.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rides_select_visible_or_owner_admin" ON public.rides;
DROP POLICY IF EXISTS "rides_select_related_or_admin" ON public.rides;
DROP POLICY IF EXISTS "Public Rides" ON public.rides;
DROP POLICY IF EXISTS "Visible Rides" ON public.rides;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.rides;

CREATE POLICY rides_select_related_or_admin
ON public.rides
FOR SELECT
TO authenticated
USING (
    public.is_current_user_admin()
    OR driver_id = auth.uid()
    OR (
        auth.uid() = ANY(COALESCE(participant_ids, ARRAY[]::UUID[]))
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(rides.passengers, '[]'::JSONB)) AS cancelled_participant(value)
            WHERE lower(COALESCE(
                cancelled_participant.value ->> 'id',
                cancelled_participant.value ->> 'passenger_id',
                cancelled_participant.value ->> 'user_id',
                ''
            )) = lower(auth.uid()::TEXT)
              AND lower(COALESCE(cancelled_participant.value ->> 'status', '')) IN ('cancelled', 'canceled')
        )
    )
    OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(rides.passengers, '[]'::JSONB)) AS passenger(value)
        WHERE lower(COALESCE(
            passenger.value ->> 'id',
            passenger.value ->> 'passenger_id',
            passenger.value ->> 'user_id',
            ''
        )) = lower(auth.uid()::TEXT)
          AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
    )
);

-- Table privileges are kept no broader than the final RLS contract. SECURITY
-- DEFINER RPCs retain their owner privileges for all money-moving mutations.
REVOKE ALL ON TABLE public.rides, public.ride_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rides, public.ride_locations TO authenticated;

REVOKE ALL ON TABLE public.chats, public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chats TO authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;

REVOKE ALL ON TABLE public.emergency_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.emergency_alerts TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tracking: only the driver may write; participants may read; coordinates
--    are validated server-side. Public links read this table only through the
--    redacted SECURITY DEFINER share RPC below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_locations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participantes pueden ver ubicación" ON public.ride_locations;
DROP POLICY IF EXISTS ride_locations_select_related ON public.ride_locations;

CREATE POLICY ride_locations_select_related
ON public.ride_locations
FOR SELECT
TO authenticated
USING (
    public.is_current_user_admin()
    OR EXISTS (
        SELECT 1
        FROM public.rides AS r
        WHERE r.id = ride_locations.ride_id
          AND (
              r.driver_id = auth.uid()
              OR (
                  auth.uid() = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                  AND NOT EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS cancelled_participant(value)
                      WHERE lower(COALESCE(
                          cancelled_participant.value ->> 'id',
                          cancelled_participant.value ->> 'passenger_id',
                          cancelled_participant.value ->> 'user_id',
                          ''
                      )) = lower(auth.uid()::TEXT)
                        AND lower(COALESCE(cancelled_participant.value ->> 'status', '')) IN ('cancelled', 'canceled')
                  )
              )
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
                  WHERE lower(COALESCE(
                      passenger.value ->> 'id',
                      passenger.value ->> 'passenger_id',
                      passenger.value ->> 'user_id',
                      ''
                  )) = lower(auth.uid()::TEXT)
                    AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
              )
          )
      )
);

CREATE OR REPLACE FUNCTION public.update_ride_location(
    p_ride_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_heading DOUBLE PRECISION DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_heading DOUBLE PRECISION := COALESCE(p_heading, 0);
BEGIN
    -- A rejected update is deliberately a no-op so the caller cannot use the
    -- RPC as an oracle for ride existence or membership.
    IF auth.uid() IS NULL
       OR p_ride_id IS NULL
       OR p_lat IS NULL
       OR p_lng IS NULL
       OR p_lat <> p_lat
       OR p_lng <> p_lng
       OR p_lat < -90 OR p_lat > 90
       OR p_lng < -180 OR p_lng > 180
       OR v_heading <> v_heading
       OR v_heading < -360 OR v_heading > 360 THEN
        RETURN;
    END IF;

    SELECT r.status
      INTO v_status
      FROM public.rides AS r
     WHERE r.id = p_ride_id
       AND r.driver_id = auth.uid();

    -- Keep the existing scheduled pre-departure tracking behaviour, while
    -- also supporting the canonical in_progress lifecycle state.
    IF v_status IS NULL OR v_status NOT IN ('scheduled', 'active', 'in_progress') THEN
        RETURN;
    END IF;

    INSERT INTO public.ride_locations (ride_id, latitude, longitude, heading, updated_at)
    VALUES (p_ride_id, p_lat, p_lng, v_heading, NOW())
    ON CONFLICT (ride_id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        heading = EXCLUDED.heading,
        updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.update_ride_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_ride_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
    TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Canonical ride membership helper for share creation/revocation.
--    participant_ids and the historic passengers JSON model are both accepted,
--    but an explicitly cancelled passenger never retains access through stale
--    participant_ids data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sw_share_actor_can_access_ride(
    p_ride_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p_user_id IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.rides AS r
            WHERE r.id = p_ride_id
              AND (
                  r.driver_id = p_user_id
                  OR (
                      p_user_id = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                      AND NOT EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS cancelled_passenger(value)
                          WHERE lower(COALESCE(
                              cancelled_passenger.value ->> 'id',
                              cancelled_passenger.value ->> 'passenger_id',
                              cancelled_passenger.value ->> 'user_id',
                              ''
                          )) = lower(p_user_id::TEXT)
                            AND lower(COALESCE(cancelled_passenger.value ->> 'status', '')) IN ('cancelled', 'canceled')
                      )
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
                      WHERE lower(COALESCE(
                          passenger.value ->> 'id',
                          passenger.value ->> 'passenger_id',
                          passenger.value ->> 'user_id',
                          ''
                      )) = lower(p_user_id::TEXT)
                        AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
                  )
              )
       );
$$;

-- ---------------------------------------------------------------------------
-- 3. Final public-share RPCs. The bearer token is generated once, only its
--    SHA-256 digest is persisted, and verify_share_token returns a fixed
--    allow-list of fields. No public SELECT policy is added to rides.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ride_share_token(
    p_ride_id UUID,
    p_ttl_hours INTEGER DEFAULT 168
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ride public.rides%ROWTYPE;
    v_token TEXT;
    v_token_hash TEXT;
    v_token_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_ttl_hours INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT *
      INTO v_ride
      FROM public.rides
     WHERE id = p_ride_id;

    IF NOT FOUND
       OR lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress')
       OR NOT public.sw_share_actor_can_access_ride(p_ride_id, v_user_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'SHARING_NOT_AVAILABLE');
    END IF;

    v_ttl_hours := LEAST(GREATEST(COALESCE(p_ttl_hours, 168), 1), 168);
    v_expires_at := NOW() + make_interval(hours => v_ttl_hours);
    v_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    INSERT INTO public.ride_share_tokens (
        ride_id,
        created_by,
        token_hash,
        expires_at
    )
    VALUES (
        p_ride_id,
        v_user_id,
        v_token_hash,
        v_expires_at
    )
    RETURNING id INTO v_token_id;

    RETURN jsonb_build_object(
        'success', true,
        'token_id', v_token_id,
        'ride_id', p_ride_id,
        'token', v_token,
        'expires_at', v_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_ride_share_token(p_token_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_token public.ride_share_tokens%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT *
      INTO v_token
      FROM public.ride_share_tokens
     WHERE id = p_token_id;

    IF NOT FOUND
       OR NOT (
           v_token.created_by = v_user_id
           OR public.sw_share_actor_can_access_ride(v_token.ride_id, v_user_id)
       ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'TOKEN_NOT_FOUND');
    END IF;

    UPDATE public.ride_share_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE id = p_token_id;

    RETURN jsonb_build_object('success', true, 'token_id', p_token_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_share_token(
    p_ride_id UUID,
    p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_share public.ride_share_tokens%ROWTYPE;
    v_ride public.rides%ROWTYPE;
    v_location JSONB;
    v_origin JSONB;
    v_destination JSONB;
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_completed_at TIMESTAMPTZ;
BEGIN
    -- Generated tokens are exactly 64 hexadecimal characters. Rejecting all
    -- other input also bounds work for unauthenticated callers.
    IF p_ride_id IS NULL
       OR p_token IS NULL
       OR trim(p_token) !~ '^[0-9a-fA-F]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'LINK_INVALID_OR_EXPIRED');
    END IF;

    v_token_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

    SELECT *
      INTO v_share
      FROM public.ride_share_tokens AS t
     WHERE t.ride_id = p_ride_id
       AND t.token_hash = v_token_hash
       AND t.revoked_at IS NULL;

    IF NOT FOUND OR v_share.expires_at <= NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'LINK_INVALID_OR_EXPIRED');
    END IF;

    SELECT *
      INTO v_ride
      FROM public.rides AS r
     WHERE r.id = p_ride_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'LINK_INVALID_OR_EXPIRED');
    END IF;

    v_completed_at := COALESCE(v_ride.completed_at, v_ride.updated_at, NOW());

    IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress', 'completed')
       OR (
           lower(COALESCE(v_ride.status, '')) = 'completed'
           AND v_completed_at + INTERVAL '2 hours' <= NOW()
       ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'LINK_INVALID_OR_EXPIRED');
    END IF;

    SELECT jsonb_build_object(
        'lat', rl.latitude,
        'lng', rl.longitude,
        'heading', COALESCE(rl.heading, 0),
        'updated_at', rl.updated_at
    )
      INTO v_location
      FROM public.ride_locations AS rl
     WHERE rl.ride_id = p_ride_id;

    v_origin := jsonb_strip_nulls(jsonb_build_object(
        'name', NULLIF(COALESCE(v_ride.origin ->> 'name', v_ride.origin ->> 'label'), ''),
        'address', NULLIF(COALESCE(
            v_ride.origin ->> 'address',
            v_ride.origin ->> 'formatted_address',
            v_ride.origin ->> 'name'
        ), ''),
        'lat', COALESCE(
            v_ride.origin -> 'lat',
            v_ride.origin -> 'latitude',
            v_ride.origin -> 'coordinates' -> 'lat',
            v_ride.origin -> 'coordinates' -> 'latitude'
        ),
        'lng', COALESCE(
            v_ride.origin -> 'lng',
            v_ride.origin -> 'longitude',
            v_ride.origin -> 'coordinates' -> 'lng',
            v_ride.origin -> 'coordinates' -> 'longitude'
        ),
        'coordinates', jsonb_strip_nulls(jsonb_build_object(
            'lat', COALESCE(
                v_ride.origin -> 'lat',
                v_ride.origin -> 'latitude',
                v_ride.origin -> 'coordinates' -> 'lat',
                v_ride.origin -> 'coordinates' -> 'latitude'
            ),
            'lng', COALESCE(
                v_ride.origin -> 'lng',
                v_ride.origin -> 'longitude',
                v_ride.origin -> 'coordinates' -> 'lng',
                v_ride.origin -> 'coordinates' -> 'longitude'
            )
        ))
    ));

    v_destination := jsonb_strip_nulls(jsonb_build_object(
        'name', NULLIF(COALESCE(v_ride.destination ->> 'name', v_ride.destination ->> 'label'), ''),
        'address', NULLIF(COALESCE(
            v_ride.destination ->> 'address',
            v_ride.destination ->> 'formatted_address',
            v_ride.destination ->> 'name'
        ), ''),
        'lat', COALESCE(
            v_ride.destination -> 'lat',
            v_ride.destination -> 'latitude',
            v_ride.destination -> 'coordinates' -> 'lat',
            v_ride.destination -> 'coordinates' -> 'latitude'
        ),
        'lng', COALESCE(
            v_ride.destination -> 'lng',
            v_ride.destination -> 'longitude',
            v_ride.destination -> 'coordinates' -> 'lng',
            v_ride.destination -> 'coordinates' -> 'longitude'
        ),
        'coordinates', jsonb_strip_nulls(jsonb_build_object(
            'lat', COALESCE(
                v_ride.destination -> 'lat',
                v_ride.destination -> 'latitude',
                v_ride.destination -> 'coordinates' -> 'lat',
                v_ride.destination -> 'coordinates' -> 'latitude'
            ),
            'lng', COALESCE(
                v_ride.destination -> 'lng',
                v_ride.destination -> 'longitude',
                v_ride.destination -> 'coordinates' -> 'lng',
                v_ride.destination -> 'coordinates' -> 'longitude'
            )
        ))
    ));

    SELECT
        COALESCE(
            NULLIF(v_ride.driver_display_name, ''),
            NULLIF(to_jsonb(p) ->> 'display_name', ''),
            NULLIF(to_jsonb(p) ->> 'full_name', ''),
            'Conductor ShareWay'
        ),
        NULLIF(to_jsonb(p) ->> 'photo_url', '')
      INTO v_driver_name, v_driver_photo
      FROM public.profiles AS p
     WHERE p.id = v_ride.driver_id;

    UPDATE public.ride_share_tokens
       SET last_used_at = NOW()
     WHERE id = v_share.id
       AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes');

    RETURN jsonb_build_object(
        'success', true,
        'ride', jsonb_build_object(
            'id', v_ride.id,
            'status', v_ride.status,
            'origin', v_origin,
            'destination', v_destination,
            'origin_address', COALESCE(v_ride.origin_address, v_origin ->> 'address'),
            'destination_address', COALESCE(v_ride.destination_address, v_destination ->> 'address'),
            'departure_time', v_ride.departure_time,
            'overview_polyline', v_ride.overview_polyline,
            'driver', jsonb_build_object(
                'display_name', COALESCE(v_driver_name, 'Conductor ShareWay'),
                'photo_url', v_driver_photo
            ),
            'location', v_location
        ),
        'expires_at', v_share.expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sw_share_actor_can_access_ride(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_ride_share_token(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_ride_share_token(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_share_token(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride_share_token(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_ride_share_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_share_token(UUID, TEXT) TO anon, authenticated;

-- Invalidate links immediately on cancellation and cap completed links at the
-- two-hour grace window without revoking them immediately.
CREATE OR REPLACE FUNCTION public.sw_reconcile_ride_share_token_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_completed_at TIMESTAMPTZ;
BEGIN
    IF lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled') THEN
        UPDATE public.ride_share_tokens
           SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE ride_id = NEW.id
           AND revoked_at IS NULL;
    ELSIF lower(COALESCE(NEW.status, '')) = 'completed' THEN
        v_completed_at := COALESCE(NEW.completed_at, NEW.updated_at, NOW());
        UPDATE public.ride_share_tokens
           SET expires_at = LEAST(expires_at, v_completed_at + INTERVAL '2 hours')
         WHERE ride_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_ride_share_token_lifecycle ON public.rides;
CREATE TRIGGER trg_reconcile_ride_share_token_lifecycle
AFTER UPDATE OF status, completed_at ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.sw_reconcile_ride_share_token_lifecycle();

-- ---------------------------------------------------------------------------
-- 4. PIN/SOS compatibility overloads. Historical overloads remain callable
--    unless explicitly revoked; all of them now delegate to the hardened
--    implementations instead of retaining their old SECURITY DEFINER bodies.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.verify_passenger_boarding_v2(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding_v2(
    p_ride_id UUID,
    p_passenger_id UUID,
    p_pin TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.verify_passenger_boarding(p_ride_id, p_pin, p_passenger_id)::JSON;
END;
$$;

DROP FUNCTION IF EXISTS public.verify_passenger(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.verify_passenger(
    p_ride_id UUID,
    p_passenger_id UUID,
    p_pin TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.verify_passenger_boarding(p_ride_id, p_pin, p_passenger_id)::JSON;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pin TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT passenger.value ->> 'pin'
      INTO v_pin
      FROM public.rides AS r,
           jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
     WHERE r.id = p_ride_id
       AND lower(COALESCE(passenger.value ->> 'id', passenger.value ->> 'user_id', '')) = lower(auth.uid()::TEXT)
       AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
     LIMIT 1;

    IF v_pin IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_NOT_AVAILABLE');
    END IF;

    RETURN jsonb_build_object('success', true, 'pin', v_pin);
END;
$$;

-- The old two-argument overload was the historical unvalidated SOS entrypoint.
DROP FUNCTION IF EXISTS public.trigger_emergency_alert_v2(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert_v2(
    p_ride_id UUID,
    p_current_location JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.trigger_emergency_alert_v2(p_ride_id, p_current_location, '{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(
    p_ride_id UUID,
    p_location JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.trigger_emergency_alert_v2(
        p_ride_id,
        p_location,
        jsonb_build_object('source', 'legacy_trigger_emergency_alert')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_passenger_boarding_v2(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_passenger(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_ride_pin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_emergency_alert(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_passenger_boarding_v2(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_passenger(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_ride_pin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_emergency_alert(UUID, JSONB) TO authenticated;

-- Do not let clients bypass the SOS RPC and forge severity/status/chat fields.
DROP POLICY IF EXISTS emergency_alerts_insert_own_related ON public.emergency_alerts;
DROP POLICY IF EXISTS emergency_alerts_no_client_insert ON public.emergency_alerts;
CREATE POLICY emergency_alerts_no_client_insert
ON public.emergency_alerts
FOR INSERT
TO authenticated
WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 5. Final SOS RPC: driver/participant_ids/passengers are all recognised, the
--    lifecycle state is checked, and the emergency chat contains every ride
--    participant plus the activating user. The notification trigger performs
--    the admin fan-out independently of this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert_v2(
    p_ride_id UUID,
    p_current_location JSONB DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ride public.rides%ROWTYPE;
    v_is_admin BOOLEAN := FALSE;
    v_is_member BOOLEAN := FALSE;
    v_alert_id UUID;
    v_chat_id UUID;
    v_chat_participants UUID[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Debes iniciar sesión para activar SOS.' USING ERRCODE = 'P0001';
    END IF;

    SELECT *
      INTO v_ride
      FROM public.rides
     WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RIDE_NOT_FOUND: Viaje no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF lower(COALESCE(v_ride.status, '')) NOT IN ('active', 'in_progress') THEN
        RAISE EXCEPTION 'SOS_NOT_AVAILABLE: El SOS solo está disponible durante un viaje activo.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.is_current_user_admin()
      INTO v_is_admin;

    v_is_member := v_ride.driver_id = v_user_id
        OR (
            v_user_id = ANY(COALESCE(v_ride.participant_ids, ARRAY[]::UUID[]))
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS cancelled_participant(value)
                WHERE lower(COALESCE(
                    cancelled_participant.value ->> 'id',
                    cancelled_participant.value ->> 'passenger_id',
                    cancelled_participant.value ->> 'user_id',
                    ''
                )) = lower(v_user_id::TEXT)
                  AND lower(COALESCE(cancelled_participant.value ->> 'status', '')) IN ('cancelled', 'canceled')
            )
        )
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger(value)
            WHERE lower(COALESCE(
                passenger.value ->> 'id',
                passenger.value ->> 'passenger_id',
                passenger.value ->> 'user_id',
                ''
            )) = lower(v_user_id::TEXT)
              AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
        );

    IF NOT (COALESCE(v_is_admin, FALSE) OR v_is_member) THEN
        RAISE EXCEPTION 'SOS_NOT_ALLOWED: Solo participantes del viaje pueden activar SOS.' USING ERRCODE = 'P0001';
    END IF;

    SELECT array_agg(DISTINCT member_id)
      INTO v_chat_participants
      FROM (
          SELECT v_user_id AS member_id
          UNION ALL
          SELECT v_ride.driver_id
          UNION ALL
          SELECT unnest(COALESCE(v_ride.participant_ids, ARRAY[]::UUID[]))
          UNION ALL
          SELECT CASE
              WHEN candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  THEN candidate::UUID
              ELSE NULL::UUID
          END
          FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger(value)
          CROSS JOIN LATERAL (
              SELECT COALESCE(
                  passenger.value ->> 'id',
                  passenger.value ->> 'passenger_id',
                  passenger.value ->> 'user_id'
              ) AS candidate
          ) AS passenger_id
      ) AS members
     WHERE member_id IS NOT NULL;

    SELECT c.id
      INTO v_chat_id
      FROM public.chats AS c
     WHERE c.ride_id = p_ride_id
       AND c.type = 'emergency'
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT 1;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (ride_id, type, participants, updated_at)
        VALUES (
            p_ride_id,
            'emergency',
            COALESCE(v_chat_participants, ARRAY[v_user_id]),
            NOW()
        )
        RETURNING id INTO v_chat_id;
    ELSE
        UPDATE public.chats AS c
           SET participants = (
               SELECT array_agg(DISTINCT member_id)
                 FROM unnest(COALESCE(c.participants, ARRAY[]::UUID[]) || COALESCE(v_chat_participants, ARRAY[]::UUID[])) AS merged(member_id)
           ),
               updated_at = NOW()
         WHERE c.id = v_chat_id;
    END IF;

    INSERT INTO public.emergency_alerts (
        ride_id,
        user_id,
        chat_id,
        status,
        severity,
        location,
        current_location,
        metadata
    )
    VALUES (
        p_ride_id,
        v_user_id,
        v_chat_id,
        'active',
        'high',
        p_current_location,
        p_current_location,
        jsonb_build_object(
            'source', 'trigger_emergency_alert_v2',
            'created_by_rpc', TRUE
        ) || COALESCE(p_metadata, '{}'::JSONB)
    )
    RETURNING id INTO v_alert_id;

    INSERT INTO public.messages (chat_id, sender_id, content)
    VALUES (
        v_chat_id,
        v_user_id,
        '🚨 SOS activado. Mantén este canal abierto y llama al 112 si hay peligro inmediato.'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'alert_id', v_alert_id,
        'alertId', v_alert_id,
        'chat_id', v_chat_id,
        'chatId', v_chat_id,
        'status', 'active'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.trigger_emergency_alert_v2(UUID, JSONB, JSONB) IS
    'Creates a participant-authorized SOS alert, emergency chat, and initial message; admin notification is handled by the insert trigger.';
