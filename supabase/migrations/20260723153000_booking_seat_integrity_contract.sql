-- Central booking/seat integrity contract.
-- Protects wallet, card, acceptance, rejection and cancellation flows at table level.

CREATE OR REPLACE FUNCTION public.enforce_ride_booking_seat_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_passengers jsonb := COALESCE(NEW.passengers, '[]'::jsonb);
  v_passenger jsonb;
  v_passenger_id text;
  v_status text;
  v_seats_text text;
  v_seats integer;
  v_occupied integer := 0;
  v_total integer;
  v_seen jsonb := '{}'::jsonb;
  v_active boolean;
BEGIN
  IF jsonb_typeof(v_passengers) <> 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_PASSENGERS_PAYLOAD',
      DETAIL = 'rides.passengers debe ser un array JSON.';
  END IF;

  v_total := COALESCE(NEW.total_seats, 0);
  IF v_total < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_TOTAL_SEATS';
  END IF;

  FOR v_passenger IN
    SELECT value FROM jsonb_array_elements(v_passengers)
  LOOP
    v_passenger_id := lower(trim(COALESCE(
      v_passenger->>'id',
      v_passenger->>'passenger_id',
      v_passenger->>'user_id',
      ''
    )));

    v_status := lower(trim(COALESCE(v_passenger->>'status', 'confirmed')));
    v_active := v_status IN (
      'confirmed',
      'accepted',
      'pending_boarding',
      'verified',
      'completed'
    );

    IF v_active AND v_passenger_id = '' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PASSENGER_ID_REQUIRED';
    END IF;

    IF v_active AND NEW.driver_id IS NOT NULL
       AND v_passenger_id = lower(NEW.driver_id::text) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DRIVER_CANNOT_BOOK_OWN_RIDE';
    END IF;

    IF v_active THEN
      IF v_seen ? v_passenger_id THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'DUPLICATE_ACTIVE_PASSENGER',
          DETAIL = format('El pasajero %s aparece más de una vez en el viaje.', v_passenger_id);
      END IF;

      v_seen := v_seen || jsonb_build_object(v_passenger_id, true);

      v_seats_text := COALESCE(
        v_passenger->>'num_seats',
        v_passenger->>'seats',
        v_passenger->>'seat_count',
        '1'
      );

      IF v_seats_text ~ '^[0-9]+$' THEN
        v_seats := GREATEST(v_seats_text::integer, 1);
      ELSE
        v_seats := 1;
      END IF;

      v_occupied := v_occupied + v_seats;
    END IF;
  END LOOP;

  -- Legacy rows may not have total_seats populated. Infer it once from the
  -- previous available count plus currently occupied seats instead of breaking them.
  IF v_total = 0 THEN
    v_total := GREATEST(
      COALESCE(OLD.total_seats, 0),
      COALESCE(OLD.seats_available, 0) + v_occupied,
      COALESCE(NEW.seats_available, 0) + v_occupied
    );
    NEW.total_seats := v_total;
  END IF;

  IF v_occupied > v_total THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RIDE_OVERBOOKED',
      DETAIL = format(
        'Se intentan ocupar %s plaza(s), pero el viaje solo tiene %s.',
        v_occupied,
        v_total
      );
  END IF;

  -- Single source of truth: available seats always derive from active passengers.
  NEW.seats_available := GREATEST(v_total - v_occupied, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ride_booking_seat_integrity ON public.rides;

CREATE TRIGGER trg_enforce_ride_booking_seat_integrity
BEFORE INSERT OR UPDATE OF passengers, seats_available, total_seats, driver_id
ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ride_booking_seat_integrity();

-- Read-only contract state for UI preflight and support diagnostics.
CREATE OR REPLACE FUNCTION public.get_booking_contract_state(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_existing jsonb;
  v_existing_status text;
  v_can_book boolean;
  v_reason text := null;
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

  SELECT passenger
    INTO v_existing
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) passenger
  WHERE lower(COALESCE(
    passenger->>'id',
    passenger->>'passenger_id',
    passenger->>'user_id',
    ''
  )) = lower(v_user_id::text)
  ORDER BY CASE
    WHEN lower(COALESCE(passenger->>'status', '')) IN ('confirmed','accepted','pending_boarding','verified','completed') THEN 0
    ELSE 1
  END
  LIMIT 1;

  v_existing_status := lower(COALESCE(v_existing->>'status', ''));

  v_can_book := true;

  IF v_ride.driver_id = v_user_id THEN
    v_can_book := false;
    v_reason := 'DRIVER_CANNOT_BOOK_OWN_RIDE';
  ELSIF v_ride.status <> 'scheduled' THEN
    v_can_book := false;
    v_reason := 'RIDE_NOT_SCHEDULED';
  ELSIF v_ride.departure_time <= now() THEN
    v_can_book := false;
    v_reason := 'RIDE_ALREADY_DEPARTED';
  ELSIF COALESCE(v_ride.seats_available, 0) <= 0 THEN
    v_can_book := false;
    v_reason := 'NO_SEATS_AVAILABLE';
  ELSIF v_existing_status IN ('confirmed','accepted','pending_boarding','verified','completed') THEN
    v_can_book := false;
    v_reason := 'ALREADY_BOOKED';
  END IF;

  RETURN jsonb_build_object(
    'ride_id', v_ride.id,
    'ride_status', v_ride.status,
    'departure_time', v_ride.departure_time,
    'total_seats', v_ride.total_seats,
    'seats_available', v_ride.seats_available,
    'can_book', v_can_book,
    'reason', v_reason,
    'existing_passenger_status', NULLIF(v_existing_status, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_booking_contract_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_contract_state(uuid) TO authenticated;

COMMENT ON FUNCTION public.enforce_ride_booking_seat_integrity() IS
  'Prevents duplicate passengers, self-booking and overbooking, and recalculates seats_available from active passengers.';

COMMENT ON FUNCTION public.get_booking_contract_state(uuid) IS
  'Returns authenticated booking eligibility and current seat state for one ride.';
