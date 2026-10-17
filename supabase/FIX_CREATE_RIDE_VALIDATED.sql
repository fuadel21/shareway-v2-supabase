-- ============================================================================
-- SHAREWAY · FIX_CREATE_RIDE_VALIDATED.sql
-- ============================================================================
-- El create_ride de produccion era la version vieja SIN validaciones:
--   · sin banda de precio (cualquier precio aceptado via RPC directo)
--   · sin rango 0.50-300 EUR ni limite de plazas
-- Instala la version blindada de la migracion 20260901 (nunca aplicada):
--   · auth obligatoria · precio en rango · precio <= sugerido+0.05 (tarifa
--     progresiva por km) · plazas 1-8 · idempotencia ante doble clic
-- Requiere sw_progressive_price (ya instalada via FIX_BOOKING_QUOTE_V2).
-- Es IDEMPOTENTE.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_ride(JSONB, JSONB, TIMESTAMPTZ, INTEGER, NUMERIC, TEXT, NUMERIC, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.create_ride(
  p_origin JSONB,
  p_destination JSONB,
  p_departure_time TIMESTAMPTZ,
  p_seats INTEGER,
  p_price NUMERIC,
  p_details TEXT DEFAULT '',
  p_distance NUMERIC DEFAULT NULL,
  p_overview_polyline TEXT DEFAULT '',
  p_waypoints JSONB DEFAULT '[]'::JSONB,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride_id UUID;
  v_profile RECORD;
  v_suggested_price NUMERIC;
  v_origin_lat NUMERIC;
  v_origin_lng NUMERIC;
  v_destination_lat NUMERIC;
  v_destination_lng NUMERIC;
  v_geodesic_distance NUMERIC;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_origin IS NULL OR p_destination IS NULL THEN
    RAISE EXCEPTION 'ROUTE_REQUIRED';
  END IF;

  v_origin_lat := public.sw_json_coordinate(p_origin, 'lat');
  v_origin_lng := public.sw_json_coordinate(p_origin, 'lng');
  v_destination_lat := public.sw_json_coordinate(p_destination, 'lat');
  v_destination_lng := public.sw_json_coordinate(p_destination, 'lng');

  IF v_origin_lat IS NULL OR v_origin_lng IS NULL
     OR v_destination_lat IS NULL OR v_destination_lng IS NULL
     OR v_origin_lat NOT BETWEEN -90 AND 90
     OR v_destination_lat NOT BETWEEN -90 AND 90
     OR v_origin_lng NOT BETWEEN -180 AND 180
     OR v_destination_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'INVALID_ROUTE_COORDINATES';
  END IF;

  v_geodesic_distance := public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_destination_lat,
    v_destination_lng
  );
  IF p_distance IS NULL OR p_distance <= 0 THEN
    RAISE EXCEPTION 'DISTANCE_REQUIRED';
  END IF;
  IF p_distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
     OR p_distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
    RAISE EXCEPTION 'DISTANCE_OUT_OF_ROUTE_BOUNDS';
  END IF;

  IF p_departure_time IS NULL
     OR p_departure_time < NOW() + INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'DEPARTURE_TOO_SOON';
  END IF;

  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8 THEN
    RAISE EXCEPTION 'INVALID_SEAT_COUNT';
  END IF;

  IF p_price IS NULL OR p_price < 0.50 OR p_price > 300 THEN
    RAISE EXCEPTION 'INVALID_RIDE_PRICE';
  END IF;

  v_suggested_price := public.sw_progressive_price(p_distance);
  IF p_price > v_suggested_price + 0.05 THEN
    RAISE EXCEPTION 'PRICE_ABOVE_SUGGESTED: El precio no puede superar % EUR para % km.',
      v_suggested_price,
      round(p_distance, 2);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id
      INTO v_ride_id
    FROM public.rides
    WHERE idempotency_key = p_idempotency_key;

    IF v_ride_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'rideId', v_ride_id,
        'note', 'duplicate_prevented'
      );
    END IF;
  END IF;

  SELECT full_name, display_name, photo_url
    INTO v_profile
  FROM public.profiles
  WHERE id = v_driver_id;

  INSERT INTO public.rides (
    driver_id,
    driver_display_name,
    driver_photo_url,
    origin,
    destination,
    origin_address,
    destination_address,
    departure_time,
    seats_available,
    total_seats,
    price,
    details,
    distance,
    overview_polyline,
    waypoints,
    status,
    participant_ids,
    idempotency_key
  ) VALUES (
    v_driver_id,
    COALESCE(v_profile.display_name, v_profile.full_name),
    v_profile.photo_url,
    p_origin,
    p_destination,
    p_origin ->> 'address',
    p_destination ->> 'address',
    p_departure_time,
    p_seats,
    p_seats,
    round(p_price, 2),
    left(COALESCE(p_details, ''), 1000),
    round(p_distance, 3),
    p_overview_polyline,
    COALESCE(p_waypoints, '[]'::JSONB),
    'scheduled',
    ARRAY[v_driver_id],
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_ride_id;

  IF v_ride_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id
      INTO v_ride_id
    FROM public.rides
    WHERE idempotency_key = p_idempotency_key;
    IF v_ride_id IS NULL THEN
      RAISE EXCEPTION 'RIDE_IDEMPOTENCY_RETRY_REQUIRED';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'rideId', v_ride_id,
      'note', 'duplicate_prevented'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rideId', v_ride_id,
    'price_per_seat', round(p_price, 2),
    'suggested_price', v_suggested_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) TO service_role;

-- Indice unico para la proteccion de idempotencia (ya existe en produccion)
CREATE UNIQUE INDEX IF NOT EXISTS rides_idempotency_key_key
  ON public.rides (idempotency_key);

NOTIFY pgrst, 'reload schema';
