DO $$
DECLARE drv UUID;
DECLARE pas UUID;
DECLARE ride_id UUID;
DECLARE req_id UUID;
DECLARE res JSON;
DECLARE search_count INT;
DECLARE v_driver_name TEXT;
DECLARE v_driver_photo TEXT;
DECLARE v_origin_geog GEOGRAPHY;
DECLARE v_dest_geog GEOGRAPHY;
DECLARE has_create15 BOOLEAN;
DECLARE has_create13 BOOLEAN;
BEGIN
  SELECT user_id INTO pas FROM public.wallets LIMIT 1;
  IF pas IS NULL THEN
    RAISE EXCEPTION 'No passenger with wallet found. Create a wallet for any user to run the pilot test.';
  END IF;
  SELECT id INTO drv FROM public.profiles WHERE id != pas LIMIT 1;
  IF drv IS NULL THEN
    RAISE EXCEPTION 'No driver profile found.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', drv::text, true);
  SELECT display_name, photo_url INTO v_driver_name, v_driver_photo
  FROM public.profiles WHERE id = drv;
  v_origin_geog := ST_SetSRID(ST_MakePoint( -3.7038::float, 40.4168::float ), 4326)::geography;
  v_dest_geog   := ST_SetSRID(ST_MakePoint( -3.69::float,   40.45::float   ), 4326)::geography;
  SELECT EXISTS(
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname='create_ride'
      AND oid::regprocedure::text LIKE 'create_ride(jsonb, jsonb, timestamp with time zone, integer, numeric, text, numeric, text, jsonb, boolean, boolean, text[], text, jsonb, jsonb)'
  ) INTO has_create15;
  SELECT EXISTS(
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname='create_ride'
      AND oid::regprocedure::text LIKE 'create_ride(jsonb, jsonb, timestamp with time zone, integer, numeric, text, numeric, text, jsonb, boolean, boolean, text[], text)'
  ) INTO has_create13;

  IF has_create15 THEN
    SELECT public.create_ride(
      '{"lat":40.4168,"lng":-3.7038}'::jsonb,
      '{"lat":40.45,"lng":-3.69}'::jsonb,
      NOW() + INTERVAL '90 minutes',
      3::integer,
      12.00::decimal,
      'Piloto'::text,
      20.0::decimal,
      NULL::text,
      NULL::jsonb,
      FALSE,
      FALSE,
      '{}'::text[],
      'automatic'::text,
      '[]'::jsonb,
      '{}'::jsonb
    ) INTO res;
    IF NOT (res->>'success')::boolean THEN
      RAISE EXCEPTION 'create_ride failed: %', res;
    END IF;
    ride_id := (res->>'rideId')::uuid;
  ELSIF has_create13 THEN
    SELECT public.create_ride(
      '{"lat":40.4168,"lng":-3.7038}'::jsonb,
      '{"lat":40.45,"lng":-3.69}'::jsonb,
      NOW() + INTERVAL '90 minutes',
      3::integer,
      12.00::decimal,
      'Piloto'::text,
      20.0::decimal,
      NULL::text,
      NULL::jsonb,
      FALSE,
      FALSE,
      '{}'::text[],
      'automatic'::text
    ) INTO res;
    IF NOT (res->>'success')::boolean THEN
      RAISE EXCEPTION 'create_ride (13 args) failed: %', res;
    END IF;
    ride_id := (res->>'rideId')::uuid;
  ELSE
    INSERT INTO public.rides(
      driver_id, driver_display_name, driver_photo_url,
      origin, destination, origin_location, destination_location,
      departure_time, seats_total, seats_available, price, details, distance,
      overview_polyline, is_women_only, participant_ids, approval_mode, waypoints, status, passengers
    )
    VALUES (
      drv, v_driver_name, v_driver_photo,
      '{"lat":40.4168,"lng":-3.7038}'::jsonb,
      '{"lat":40.45,"lng":-3.69}'::jsonb,
      v_origin_geog, v_dest_geog,
      NOW() + INTERVAL '90 minutes',
      3, 3, 12.00::decimal, 'Piloto', 20.0::decimal,
      NULL, FALSE, ARRAY[drv], 'automatic', '[]'::jsonb, 'scheduled', '[]'::jsonb
    )
    RETURNING id INTO ride_id;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', pas::text, true);
  SELECT count(*) INTO search_count
  FROM public.search_rides_secure(
    '{"lat":40.4168,"lng":-3.7038}'::jsonb,
    '{"lat":40.45,"lng":-3.69}'::jsonb,
    NULL,
    1,
    999.99,
    20000
  );
  IF search_count = 0 THEN
    RAISE EXCEPTION 'search returned 0 results';
  END IF;
  INSERT INTO public.ride_requests(id, requester_id, status, created_at)
  VALUES (gen_random_uuid(), pas, 'pending', NOW())
  RETURNING id INTO req_id;
  PERFORM set_config('request.jwt.claim.sub', drv::text, true);
  SELECT public.fulfill_ride_request(
    req_id,
    '{"lat":40.4168,"lng":-3.7038}'::jsonb,
    '{"lat":40.45,"lng":-3.69}'::jsonb,
    NOW() + INTERVAL '75 minutes',
    1,
    10.00,
    'Auto-match',
    10.0,
    NULL,
    '[]'::jsonb
  ) INTO res;
  IF NOT (res->>'success')::boolean THEN
    RAISE EXCEPTION 'fulfill_ride_request failed: %', res;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ride_requests
    WHERE id = req_id AND status = 'fulfilled'
  ) THEN
    RAISE EXCEPTION 'ride_request not fulfilled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides
    WHERE id = (res->>'rideId')::uuid AND seats_available < 3
  ) THEN
    RAISE EXCEPTION 'seats not decremented';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wallets
    WHERE user_id = pas AND held_balance >= 10.00
  ) THEN
    RAISE EXCEPTION 'wallet hold missing';
  END IF;
END $$;
