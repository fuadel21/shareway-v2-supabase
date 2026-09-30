-- ============================================================================
-- ShareWay: secure public ride-sharing links
--
-- Public links use opaque, one-time-generated bearer tokens. Only a SHA-256
-- digest is stored, and the public RPC returns a deliberately small tracking
-- snapshot instead of exposing the rides table or passenger data to anon.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ride_share_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ride_share_tokens_ride_active
    ON public.ride_share_tokens (ride_id, expires_at)
    WHERE revoked_at IS NULL;

ALTER TABLE public.ride_share_tokens ENABLE ROW LEVEL SECURITY;

-- Token rows are only accessed through the SECURITY DEFINER functions below.
-- In particular, anon must never be able to enumerate token hashes or ride IDs.
DROP POLICY IF EXISTS "Share token owners can view their tokens" ON public.ride_share_tokens;
DROP POLICY IF EXISTS "Share token owners can revoke their tokens" ON public.ride_share_tokens;

CREATE OR REPLACE FUNCTION public.sw_share_actor_can_access_ride(p_ride_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.rides AS r
        WHERE r.id = p_ride_id
          AND (
              r.driver_id = p_user_id
              OR p_user_id = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
                  WHERE lower(COALESCE(
                      passenger.value ->> 'id',
                      passenger.value ->> 'passenger_id',
                      passenger.value ->> 'user_id',
                      ''
                  )) = lower(p_user_id::TEXT)
                    AND lower(COALESCE(passenger.value ->> 'status', '')) <> 'cancelled'
              )
          )
    );
$$;

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
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_completed_at TIMESTAMPTZ;
BEGIN
    -- Do not distinguish a missing ride, bad token, revoked token, or expired
    -- token in the public response. That prevents token/ride enumeration.
    IF p_ride_id IS NULL OR p_token IS NULL OR length(trim(p_token)) < 32 THEN
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

    SELECT
        COALESCE(v_ride.driver_display_name, p.display_name, p.full_name, 'Conductor'),
        COALESCE(v_ride.driver_photo_url, p.photo_url)
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
            'origin', v_ride.origin,
            'destination', v_ride.destination,
            'origin_address', COALESCE(v_ride.origin_address, v_ride.origin ->> 'address'),
            'destination_address', COALESCE(v_ride.destination_address, v_ride.destination ->> 'address'),
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

REVOKE ALL ON FUNCTION public.sw_share_actor_can_access_ride(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_share_actor_can_access_ride(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.sw_share_actor_can_access_ride(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_ride_share_token(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ride_share_token(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_ride_share_token(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_ride_share_token(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verify_share_token(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ride_share_token(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_ride_share_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_share_token(UUID, TEXT) TO anon, authenticated;

COMMENT ON TABLE public.ride_share_tokens IS
    'Hashed bearer tokens for time-limited public ride tracking links.';
COMMENT ON FUNCTION public.verify_share_token(UUID, TEXT) IS
    'Validates a public ride tracking token and returns only the redacted live snapshot.';

REVOKE ALL ON TABLE public.ride_share_tokens FROM PUBLIC, anon, authenticated;
