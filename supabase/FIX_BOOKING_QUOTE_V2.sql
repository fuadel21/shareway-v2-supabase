-- ============================================================================
-- SHAREWAY · FIX_BOOKING_QUOTE_V2.sql
-- ============================================================================
-- RECÁLCULO DEL PRECIO POR KILÓMETRO en la reserva.
--
-- Problema que corrige:
--   La función activa en BD devolvía el PRECIO PLANO del viaje (p. ej.
--   29,48 €) aunque el pasajero eligiera un trayecto A→B más corto. El
--   modal parecía "quedarse pensando" porque el precio nunca cambiaba.
--
-- Nueva lógica (lo que paga el pasajero por plaza):
--   1. distancia del trayecto del pasajero (Haversine pickup→dropoff)
--      × 1,20 de factor de circuidad (carretera vs línea recta) = km facturados
--   2. tarifa progresiva oficial por km:
--        0-15 km → 0,30 €/km · 15-100 km → 0,22 €/km · +100 km → 0,15 €/km
--      (mínimo 0,50 €, máximo 300 €)
--   3. tope de coherencia: si el trayecto del pasajero no supera el del
--      conductor, nunca se cobra más que el precio publicado del viaje.
--   4. + 1,50 €/plaza de suplemento si la recogida está a más de 3 km del
--      origen del conductor.
--   5. comisión de plataforma 10% / conductor 90%.
--
-- AUTOCONTENIDA e IDEMPOTENTE: define todas las funciones que usa.
-- Ejecutar entera en el SQL Editor de Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Lectura segura de coordenadas desde JSONB
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sw_json_coordinate(
  p_location JSONB,
  p_axis TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $fn$
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
$fn$;

-- ----------------------------------------------------------------------------
-- 2) Distancia geodésica (Haversine) en km
-- ----------------------------------------------------------------------------
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
AS $fn$
DECLARE
  v_dlat NUMERIC;
  v_dlng NUMERIC;
  v_lat1 NUMERIC := radians(p_lat1);
  v_lat2 NUMERIC := radians(p_lat2);
  v_a NUMERIC;
BEGIN
  v_dlat := radians(p_lat2 - p_lat1);
  v_dlng := radians(p_lng2 - p_lng1);
  v_a := sin(v_dlat / 2) * sin(v_dlat / 2)
       + cos(v_lat1) * cos(v_lat2) * sin(v_dlng / 2) * sin(v_dlng / 2);
  RETURN round((2 * 6371.0088 * asin(least(sqrt(greatest(v_a, 0)), 1)))::NUMERIC, 6);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3) Tarifa progresiva oficial (€ por plaza según km)
--    0-15 km → 0,30 €/km · 15-100 km → 0,22 €/km · +100 km → 0,15 €/km
--    mínimo 0,50 € · máximo 300 €
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sw_progressive_price(
  p_distance_km NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_km NUMERIC := GREATEST(COALESCE(p_distance_km, 0), 0);
  v_price NUMERIC;
BEGIN
  v_price := LEAST(GREATEST(v_km, 0), 15) * 0.30
           + GREATEST(LEAST(v_km, 100) - 15, 0) * 0.22
           + GREATEST(v_km - 100, 0) * 0.15;

  RETURN round(LEAST(GREATEST(v_price, 0.50), 300), 2);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 4) Cálculo del importe de reserva
-- ----------------------------------------------------------------------------
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
AS $fn$
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
  v_billed_km NUMERIC;
  v_detour_distance NUMERIC;
  v_supplement NUMERIC := 0;
  v_tariff_per_seat NUMERIC;
  v_base_per_seat NUMERIC;
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
    v_ride_distance := greatest(COALESCE(v_geodesic_distance, 0), 1);
  ELSE
    IF v_ride.distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
       OR v_ride.distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
      RETURN jsonb_build_object('success', false, 'error', 'DISTANCE_OUT_OF_ROUTE_BOUNDS');
    END IF;
    v_ride_distance := greatest(v_ride.distance, 1);
  END IF;

  -- El precio publicado del viaje no puede superar la tarifa oficial + 0,05 €
  v_suggested_price := public.sw_progressive_price(v_ride_distance);
  IF round(v_ride.price, 2) > v_suggested_price + 0.05 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RIDE_PRICE_OUTSIDE_CANONICAL_BAND',
      'suggested_price', v_suggested_price,
      'stored_price', round(v_ride.price, 2)
    );
  END IF;

  -- Distancia del trayecto del pasajero (línea recta) y km facturados
  -- (factor 1,20 = circuidad media carretera vs geodésica)
  v_passenger_distance := greatest(
    COALESCE(public.sw_haversine_km(
      v_pickup_lat,
      v_pickup_lng,
      v_dropoff_lat,
      v_dropoff_lng
    ), 0),
    0.5
  );
  v_billed_km := round(v_passenger_distance * 1.20, 3);

  -- Suplemento de recogida si el conductor debe desviarse más de 3 km
  v_detour_distance := COALESCE(public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_pickup_lat,
    v_pickup_lng
  ), 0);

  IF v_detour_distance > 3 THEN
    v_supplement := 1.50;
  END IF;

  -- RECÁLCULO POR KILÓMETRO: tarifa progresiva sobre los km facturados
  v_tariff_per_seat := public.sw_progressive_price(v_billed_km);

  -- Comparacion geodesico vs geodesico (independiente de si el distance
  -- guardado del viaje es carretera o recto): el pasajero "cabe" en el
  -- viaje si su linea recta no supera la del viaje +15%.
  IF v_passenger_distance <= v_geodesic_distance * 1.15 THEN
    -- El trayecto del pasajero cabe dentro del trayecto del conductor:
    -- nunca se cobra más que el precio publicado del viaje.
    v_base_per_seat := LEAST(v_tariff_per_seat, round(v_ride.price, 2));
  ELSE
    -- El pasajero viaja más lejos que el trayecto publicado: paga su tarifa.
    v_base_per_seat := v_tariff_per_seat;
  END IF;

  v_price_per_seat := round(greatest(v_base_per_seat, 0.50) + v_supplement, 2);
  v_total := round(v_price_per_seat * p_num_seats, 2);

  IF v_total < 0.50 OR v_total > 2400 THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_AMOUNT_OUT_OF_RANGE');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', v_ride.id,
    'ride_price_per_seat', round(v_ride.price, 2),
    'ride_distance_km', round(v_ride_distance, 3),
    'passenger_distance_km', v_billed_km,
    'geodesic_distance_km', round(v_passenger_distance, 3),
    'detour_distance_km', round(v_detour_distance, 3),
    'pickup_supplement_per_seat', v_supplement,
    'num_seats', p_num_seats,
    'tariff_price_per_seat', v_tariff_per_seat,
    'suggested_price', v_suggested_price,
    'price_per_seat', v_price_per_seat,
    'total', v_total,
    'platform_fee_rate', 0.10,
    'platform_fee', round(v_total * 0.10, 2),
    'driver_payout', round(v_total - round(v_total * 0.10, 2), 2)
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 5) Punto de entrada (exige sesión; el cliente la llama así)
-- ----------------------------------------------------------------------------
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
AS $fn$
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
$fn$;

-- ----------------------------------------------------------------------------
-- Permisos
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sw_json_coordinate(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_json_coordinate(JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sw_haversine_km(NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_haversine_km(NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.sw_progressive_price(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_progressive_price(NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(UUID, JSONB, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(UUID, JSONB, JSONB, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(UUID, JSONB, JSONB, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.quote_ride_booking(UUID, JSONB, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_ride_booking(UUID, JSONB, JSONB, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.quote_ride_booking(UUID, JSONB, JSONB, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
