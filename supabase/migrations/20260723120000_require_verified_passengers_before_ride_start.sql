-- Block every scheduled -> active/in_progress transition while a booked passenger
-- is still waiting for PIN verification. This is enforced at table level so the
-- rule cannot be bypassed from another client or an older RPC implementation.

CREATE OR REPLACE FUNCTION public.enforce_verified_passengers_before_ride_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unresolved_count integer := 0;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'scheduled' AND NEW.status IN ('active', 'in_progress') THEN
    SELECT count(*)
      INTO v_unresolved_count
    FROM jsonb_array_elements(COALESCE(OLD.passengers, '[]'::jsonb)) AS passenger
    WHERE lower(COALESCE(passenger->>'status', '')) IN (
      'confirmed',
      'accepted',
      'pending_boarding'
    );

    IF v_unresolved_count > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PIN_VERIFICATION_REQUIRED',
        DETAIL = format(
          'Hay %s pasajero(s) confirmado(s) sin verificar. Verifica el PIN o resuelve el no-show antes de iniciar.',
          v_unresolved_count
        ),
        HINT = 'Todos los pasajeros confirmados deben estar verified, completed, no_show o cancelled antes de iniciar.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_verified_passengers_before_start ON public.rides;

CREATE TRIGGER trg_require_verified_passengers_before_start
BEFORE UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verified_passengers_before_ride_start();

-- Read-only preflight used by the app to explain why the start action is blocked.
CREATE OR REPLACE FUNCTION public.get_ride_start_readiness(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_unresolved jsonb := '[]'::jsonb;
  v_verified_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RIDE_NOT_FOUND';
  END IF;

  IF v_ride.driver_id <> v_user_id THEN
    RAISE EXCEPTION 'DRIVER_ONLY';
  END IF;

  SELECT COALESCE(jsonb_agg(passenger), '[]'::jsonb)
    INTO v_unresolved
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
  WHERE lower(COALESCE(passenger->>'status', '')) IN (
    'confirmed',
    'accepted',
    'pending_boarding'
  );

  SELECT count(*)
    INTO v_verified_count
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
  WHERE lower(COALESCE(passenger->>'status', '')) IN ('verified', 'completed');

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_unresolved) = 0,
    'ride_id', v_ride.id,
    'ride_status', v_ride.status,
    'unresolved_count', jsonb_array_length(v_unresolved),
    'verified_count', v_verified_count,
    'unresolved_passengers', v_unresolved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_start_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ride_start_readiness(uuid) TO authenticated;

COMMENT ON FUNCTION public.enforce_verified_passengers_before_ride_start() IS
  'Prevents a ride from starting while any booked passenger is still awaiting PIN verification.';

COMMENT ON FUNCTION public.get_ride_start_readiness(uuid) IS
  'Returns driver-only PIN verification readiness before starting a ride.';
