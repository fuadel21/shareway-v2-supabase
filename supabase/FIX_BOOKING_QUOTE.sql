-- ============================================================
-- 🛠️ SHAREWAY.ES · FIX DEL SISTEMA DE PRECIOS (quote)
-- Crea las 3 funciones que calculan el precio de reserva.
-- Extraidas de la migracion 20260901120000_reconcile_ride_financial_rules.sql
-- Ejecutar en SQL Editor si la prueba SELECT * FROM quote_ride_booking(...)
-- devuelve "function does not exist"
-- ============================================================

CREATE OR REPLACE FUNCTION public.sw_json_coordinate(
  p_location JSONB,
  p_axis TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value TEXT;
BEGIN
  IF lower(p_axis) = 'lat' THEN
    v_value := COALESCE(
      p_location ->> 'lat',
      p_location ->> 'latitude',
      p_location -> 'coordinates' ->> 'lat',
      p_location -> 'coordinates' ->> 'latitude'
    );
  ELSIF lower(p_axis) = 'lng' THEN
    v_value := COALESCE(
      p_location ->> 'lng',
      p_location ->> 'longitude',
      p_location -> 'coordinates' ->> 'lng',
      p_location -> 'coordinates' ->> 'longitude'
    );
  ELSE
    RETURN NULL;
  END IF;

  IF v_value IS NULL OR trim(v_value) !~ '^[-+]?[0-9]+([.][0-9]+)?$' THEN
    RETURN NULL;
  END IF;

  RETURN trim(v_value)::NUMERIC;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sw_haversine_km(
  p_lat1 NUMERIC,
  p_lng1 NUMERIC,
  p_lat2 NUMERIC,
  p_lng2 NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dlat NUMERIC;

CREATE OR REPLACE FUNCTION public.sw_build_booking_quote(
  p_ride_id UUID,
  p_pickup_location JSONB,
  p_dropoff_location JSONB,
  p_num_seats INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_origin_lat NUMERIC;
  v_origin_lng NUMERIC;
  v_destination_lat NUMERIC;
  v_destination_lng NUMERIC;
  v_pickup_lat NUMERIC;
  v_pickup_lng NUMERIC;
  v_dropoff_lat NUMERIC;
  v_dropoff_lng NUMERIC;
  v_geodesic_distance NUMERIC;
  v_ride_distance NUMERIC;
  v_passenger_distance NUMERIC;
  v_detour_distance NUMERIC;
  v_supplement NUMERIC := 0;
  v_total NUMERIC;
  v_price_per_seat NUMERIC;
  v_suggested_price NUMERIC;
BEGIN
  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF v_ride.status IS DISTINCT FROM 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_SCHEDULED');
  END IF;

  IF v_ride.departure_time IS NULL OR v_ride.departure_time <= NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_ALREADY_DEPARTED');
  END IF;

  IF v_ride.driver_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'DRIVER_CANNOT_BOOK_OWN_RIDE');
  END IF;

  IF p_num_seats IS NULL OR p_num_seats < 1 OR p_num_seats > 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SEAT_COUNT');
  END IF;

  IF COALESCE(v_ride.seats_available, 0) < p_num_seats THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_SEATS_AVAILABLE');
  END IF;

  IF v_ride.price IS NULL OR v_ride.price < 0.50 OR v_ride.price > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RIDE_PRICE');
  END IF;

  v_origin_lat := public.sw_json_coordinate(v_ride.origin, 'lat');
  v_origin_lng := public.sw_json_coordinate(v_ride.origin, 'lng');
  v_destination_lat := public.sw_json_coordinate(v_ride.destination, 'lat');
  v_destination_lng := public.sw_json_coordinate(v_ride.destination, 'lng');

  v_pickup_lat := COALESCE(
    public.sw_json_coordinate(p_pickup_location, 'lat'),
    v_origin_lat
  );
  v_pickup_lng := COALESCE(
    public.sw_json_coordinate(p_pickup_location, 'lng'),
    v_origin_lng
  );
  v_dropoff_lat := COALESCE(
    public.sw_json_coordinate(p_dropoff_location, 'lat'),
    v_destination_lat
  );
  v_dropoff_lng := COALESCE(
    public.sw_json_coordinate(p_dropoff_location, 'lng'),
    v_destination_lng
  );

  IF v_origin_lat IS NULL OR v_origin_lng IS NULL
     OR v_destination_lat IS NULL OR v_destination_lng IS NULL
     OR v_pickup_lat IS NULL OR v_pickup_lng IS NULL
     OR v_dropoff_lat IS NULL OR v_dropoff_lng IS NULL
     OR v_origin_lat NOT BETWEEN -90 AND 90
     OR v_destination_lat NOT BETWEEN -90 AND 90
     OR v_pickup_lat NOT BETWEEN -90 AND 90
     OR v_dropoff_lat NOT BETWEEN -90 AND 90
     OR v_origin_lng NOT BETWEEN -180 AND 180
     OR v_destination_lng NOT BETWEEN -180 AND 180
     OR v_pickup_lng NOT BETWEEN -180 AND 180
     OR v_dropoff_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BOOKING_COORDINATES');
  END IF;

  v_geodesic_distance := public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_destination_lat,
    v_destination_lng
  );

  IF v_ride.distance IS NULL OR v_ride.distance <= 0 THEN
    -- A legacy row without a persisted route distance falls back to the
    -- server-derived geodesic distance; it is still subject to the price band.
    v_ride_distance := greatest(COALESCE(v_geodesic_distance, 0), 1);
  ELSE
    IF v_ride.distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
       OR v_ride.distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
      RETURN jsonb_build_object('success', false, 'error', 'DISTANCE_OUT_OF_ROUTE_BOUNDS');
    END IF;
    v_ride_distance := greatest(v_ride.distance, 1);
  END IF;

  -- Scheduled legacy rides are not repriced silently. They can continue to
  -- exist, but a new booking is rejected if their stored per-seat price is
  -- above the current server-side suggestion plus the agreed 0.05 EUR band.
  v_suggested_price := public.sw_progressive_price(v_ride_distance);
  IF round(v_ride.price, 2) > v_suggested_price + 0.05 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RIDE_PRICE_OUTSIDE_CANONICAL_BAND',
      'suggested_price', v_suggested_price,
      'stored_price', round(v_ride.price, 2)
    );
  END IF;

  v_passenger_distance := greatest(
    COALESCE(public.sw_haversine_km(
      v_pickup_lat,
      v_pickup_lng,
      v_dropoff_lat,
      v_dropoff_lng
    ), 0),
    0.5
  );

  v_detour_distance := COALESCE(public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_pickup_lat,
    v_pickup_lng
  ), 0);

  IF v_detour_distance > 3 THEN
    v_supplement := 1.50;
  END IF;

  v_total := round(greatest(
    0.50 * p_num_seats,
    (
      (v_ride.price / v_ride_distance) * v_passenger_distance
      + v_supplement
    ) * p_num_seats
  ), 2);

  IF v_total < 0.50 OR v_total > 2400 THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_AMOUNT_OUT_OF_RANGE');
  END IF;

  v_price_per_seat := round(v_total / p_num_seats, 6);

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', v_ride.id,
    'ride_price_per_seat', round(v_ride.price, 2),
    'ride_distance_km', round(v_ride_distance, 3),
    'passenger_distance_km', round(v_passenger_distance, 3),
    'detour_distance_km', round(v_detour_distance, 3),
    'pickup_supplement_per_seat', v_supplement,
    'num_seats', p_num_seats,
    'price_per_seat', v_price_per_seat,
    'total', v_total,
    'platform_fee_rate', 0.10,
    'platform_fee', round(v_total * 0.10, 2),
    'driver_payout', round(v_total - round(v_total * 0.10, 2), 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_ride_booking(
  p_ride_id UUID,
  p_pickup_location JSONB DEFAULT NULL,
  p_dropoff_location JSONB DEFAULT NULL,
  p_num_seats INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');

CREATE OR REPLACE FUNCTION public.quote_ride_booking(
  p_ride_id UUID,
  p_pickup_location JSONB DEFAULT NULL,
  p_dropoff_location JSONB DEFAULT NULL,
  p_num_seats INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  RETURN public.sw_build_booking_quote(
    p_ride_id,
    p_pickup_location,
    p_dropoff_location,
    p_num_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM anon;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) TO authenticated;

-- --------------------------------------------------------------------------
-- Durable card-booking reservation.
--
-- Stripe creates an external object, so the database cannot allocate its id in
-- the same transaction. Reserve the ride request and a payment_intents row
-- first, then attach Stripe's id in a second, idempotent RPC. A crashed worker
-- therefore leaves a retryable operation instead of an uncoupled PaymentIntent.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.prepare_booking_payment(
  p_user_id UUID,
  p_ride_id UUID,
  p_amount NUMERIC,
  p_num_seats INTEGER,
  p_pickup_location JSONB,
  p_pickup_address TEXT,
  p_dropoff_location JSONB,
  p_dropoff_address TEXT,
  p_booking_signature TEXT,
  p_previous_payment_intent_id TEXT DEFAULT NULL,
  p_previous_payment_intent_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;

-- Permisos
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) TO authenticated;

-- VERIFICAR (debe devolver success:true con el total):
-- SELECT * FROM quote_ride_booking(
--   'efbb76a8-ba97-4f90-b1be-c8f19cf16a03'::uuid,
--   '{"lat":41.613405,"lng":2.6573645}'::jsonb,
--   '{"lat":42.69941,"lng":2.8946587}'::jsonb,
--   1);
