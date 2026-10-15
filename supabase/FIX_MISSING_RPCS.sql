-- ============================================================================
-- SHAREWAY · FIX_MISSING_RPCS.sql
-- ============================================================================
-- Instala los RPC que el cliente llama y no existian en produccion:
--   · search_rides_by_corridor      (busqueda del Dashboard; de migracion 20260418)
--   · accept_passenger / reject_passenger / remove_passenger (gestion conductor)
--   · check_pending_review / get_user_reputation_profile     (valoraciones)
--   · set_driver_radar_route_filter (filtro rutas del radar conductor)
--   · get_my_safety_history         (historial de seguridad personal)
--   · get_live_ride_map             (mapa en vivo del Dashboard)
-- No incluye gamificacion (fuera de alcance por decision de producto).
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) search_rides_by_corridor (extraida de 20260418_CONSOLIDATED_FINAL_FIX)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_rides_by_corridor(
    p_pax_origin_lat NUMERIC,
    p_pax_origin_lng NUMERIC,
    p_pax_dest_lat NUMERIC,
    p_pax_dest_lng NUMERIC,
    p_date TIMESTAMPTZ DEFAULT NULL,
    p_max_detour_meters NUMERIC DEFAULT 5000
) RETURNS TABLE (
    id UUID,
    driver_id UUID,
    origin JSONB,
    destination JSONB,
    price NUMERIC,
    seats_available INTEGER,
    departure_time TIMESTAMPTZ,
    status TEXT,
    is_women_only BOOLEAN,
    driver_name TEXT,
    driver_photo TEXT,
    driver_rating NUMERIC,
    driver_verified BOOLEAN,
    match_score FLOAT8
) AS $$
    SELECT 
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time, r.status, r.is_women_only,
        p.display_name, p.photo_url, p.rating, p.is_verified,
        (ST_Distance(ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326), ST_SetSRID(ST_Point(COALESCE(r.origin->>'lng', r.origin->'coordinates'->>'lng')::numeric, COALESCE(r.origin->>'lat', r.origin->'coordinates'->>'lat')::numeric), 4326)) +
         ST_Distance(ST_SetSRID(ST_Point(p_pax_dest_lng, p_pax_dest_lat), 4326), ST_SetSRID(ST_Point(COALESCE(r.destination->>'lng', r.destination->'coordinates'->>'lng')::numeric, COALESCE(r.destination->>'lat', r.destination->'coordinates'->>'lat')::numeric), 4326)))::FLOAT8 as match_score
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE 
        r.status = 'scheduled'
        AND r.seats_available > 0
        AND (p_date IS NULL OR r.departure_time::date = p_date::date)
        AND r.departure_time >= NOW()
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326)::geography,
            ST_SetSRID(ST_Point(COALESCE(r.origin->>'lng', r.origin->'coordinates'->>'lng')::numeric, COALESCE(r.origin->>'lat', r.origin->'coordinates'->>'lat')::numeric), 4326)::geography,
            p_max_detour_meters
        )
    ORDER BY match_score ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
-- ----------------------------------------------------------------------------
-- 2) Gestion de pasajeros por el conductor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_passenger(p_ride_id UUID, p_passenger_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_new JSONB;
  v_seats INTEGER;
BEGIN
  IF v_driver IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;
  IF v_ride.driver_id IS DISTINCT FROM v_driver THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_THE_DRIVER');
  END IF;
  IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_ACTIVE');
  END IF;

  SELECT p || jsonb_build_object('status', 'confirmed') INTO v_new
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
  WHERE (p->>'id')::UUID = p_passenger_id
    AND lower(COALESCE(p->>'status', '')) = 'pending';

  IF v_new IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PENDING_PASSENGER_NOT_FOUND');
  END IF;

  v_seats := COALESCE(NULLIF(v_new->>'seats', '')::INTEGER, 1);
  IF COALESCE(v_ride.seats_available, 0) < v_seats THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_SEATS_AVAILABLE');
  END IF;

  UPDATE public.rides
  SET passengers = (
        SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = p_passenger_id THEN v_new ELSE p END)
        FROM jsonb_array_elements(COALESCE(passengers, '[]'::JSONB)) p
      ),
      seats_available = GREATEST(COALESCE(seats_available, 0) - v_seats, 0),
      updated_at = NOW()
  WHERE id = p_ride_id;

  BEGIN
    PERFORM public.create_notification(
      p_passenger_id, 'booking_accepted', 'Plaza confirmada',
      'El conductor ha confirmado tu plaza.',
      jsonb_build_object('ride_id', p_ride_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_passenger] notif omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.accept_passenger(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_passenger(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_passenger(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_passenger(p_ride_id UUID, p_passenger_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_target JSONB;
  v_seats INTEGER;
  v_amount NUMERIC;
BEGIN
  IF v_driver IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;
  IF v_ride.driver_id IS DISTINCT FROM v_driver THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_THE_DRIVER');
  END IF;

  SELECT value INTO v_target
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
  WHERE (p->>'id')::UUID = p_passenger_id
    AND lower(COALESCE(p->>'status', '')) IN
        ('pending', 'confirmed', 'accepted', 'pending_boarding');

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_PASSENGER_NOT_FOUND');
  END IF;

  v_seats := COALESCE(NULLIF(v_target->>'seats', '')::INTEGER, 1);

  -- Devolver fondos retenidos (pago con cartera) si aun estaban en hold
  IF lower(COALESCE(v_target->>'payment_status', '')) = 'held' THEN
    v_amount := round(COALESCE(NULLIF(v_target->>'booked_price', '')::NUMERIC, v_ride.price) * v_seats, 2);
    UPDATE public.wallets
    SET held_balance = round(GREATEST(COALESCE(held_balance, 0) - v_amount, 0), 2),
        balance = round(COALESCE(balance, 0) + v_amount, 2),
        updated_at = NOW()
    WHERE user_id = p_passenger_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (p_passenger_id, v_amount, 'refund', 'Reembolso: el conductor rechazó la reserva', p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[reject_passenger] tx omitida: %', SQLERRM;
    END;
  END IF;

  UPDATE public.rides
  SET passengers = (
        SELECT jsonb_agg(
          CASE WHEN (p->>'id')::UUID = p_passenger_id
               THEN p || jsonb_build_object('status', 'rejected', 'payment_status', 'refunded')
               ELSE p END)
        FROM jsonb_array_elements(COALESCE(passengers, '[]'::JSONB)) p
      ),
      seats_available = COALESCE(seats_available, 0) + v_seats,
      updated_at = NOW()
  WHERE id = p_ride_id;

  BEGIN
    PERFORM public.create_notification(
      p_passenger_id, 'booking_rejected', 'Reserva rechazada',
      'El conductor no pudo aceptar tu reserva. Se te ha devuelto el importe.',
      jsonb_build_object('ride_id', p_ride_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[reject_passenger] notif omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'refunded', COALESCE(v_amount, 0));
END;
$fn$;

REVOKE ALL ON FUNCTION public.reject_passenger(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_passenger(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_passenger(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_passenger(p_ride_id UUID, p_passenger_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_target JSONB;
  v_seats INTEGER;
  v_amount NUMERIC;
BEGIN
  IF v_driver IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;
  IF v_ride.driver_id IS DISTINCT FROM v_driver THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_THE_DRIVER');
  END IF;

  SELECT value INTO v_target
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
  WHERE (p->>'id')::UUID = p_passenger_id
    AND lower(COALESCE(p->>'status', '')) IN
        ('pending', 'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board');

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_PASSENGER_NOT_FOUND');
  END IF;

  v_seats := COALESCE(NULLIF(v_target->>'seats', '')::INTEGER, 1);

  IF lower(COALESCE(v_target->>'payment_status', '')) = 'held' THEN
    v_amount := round(COALESCE(NULLIF(v_target->>'booked_price', '')::NUMERIC, v_ride.price) * v_seats, 2);
    UPDATE public.wallets
    SET held_balance = round(GREATEST(COALESCE(held_balance, 0) - v_amount, 0), 2),
        balance = round(COALESCE(balance, 0) + v_amount, 2),
        updated_at = NOW()
    WHERE user_id = p_passenger_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (p_passenger_id, v_amount, 'refund', 'Reembolso: retirado del viaje por el conductor', p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[remove_passenger] tx omitida: %', SQLERRM;
    END;
  END IF;

  UPDATE public.rides
  SET passengers = (
        SELECT jsonb_agg(
          CASE WHEN (p->>'id')::UUID = p_passenger_id
               THEN p || jsonb_build_object('status', 'cancelled', 'payment_status', 'refunded')
               ELSE p END)
        FROM jsonb_array_elements(COALESCE(passengers, '[]'::JSONB)) p
      ),
      seats_available = COALESCE(seats_available, 0) + v_seats,
      updated_at = NOW()
  WHERE id = p_ride_id;

  BEGIN
    PERFORM public.create_notification(
      p_passenger_id, 'booking_removed', 'Retirado del viaje',
      'El conductor te ha retirado del viaje. Se te ha devuelto el importe.',
      jsonb_build_object('ride_id', p_ride_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[remove_passenger] notif omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'refunded', COALESCE(v_amount, 0));
END;
$fn$;

REVOKE ALL ON FUNCTION public.remove_passenger(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_passenger(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_passenger(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Valoraciones
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_pending_review(p_ride_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = p_ride_id
      AND lower(COALESCE(r.status, '')) = 'completed'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) p
        WHERE (p->>'id')::UUID = p_user_id
          AND lower(COALESCE(p->>'status', '')) NOT IN ('cancelled', 'canceled', 'rejected', 'no_show')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE ride_id = p_ride_id AND reviewer_id = p_user_id
  );
$fn$;

REVOKE ALL ON FUNCTION public.check_pending_review(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_pending_review(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_pending_review(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_reputation_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'average_rating', COALESCE((SELECT round(AVG(rating)::numeric, 2) FROM public.reviews WHERE reviewee_id = p_user_id), 0),
    'review_count', (SELECT count(*) FROM public.reviews WHERE reviewee_id = p_user_id),
    'reviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rv.id,
        'rating', rv.rating,
        'comment', rv.comment,
        'created_at', rv.created_at,
        'ride_id', rv.ride_id,
        'reviewer_name', pr.display_name
      ) ORDER BY rv.created_at DESC)
      FROM (
        SELECT * FROM public.reviews WHERE reviewee_id = p_user_id ORDER BY created_at DESC LIMIT 10
      ) rv
      LEFT JOIN public.profiles pr ON pr.id = rv.reviewer_id
    ), '[]'::JSONB)
  );
$fn$;

REVOKE ALL ON FUNCTION public.get_user_reputation_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_reputation_profile(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_reputation_profile(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) Radar conductor: filtro por rutas favoritas (espejo del de pasajero)
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_radar_preferences
  ADD COLUMN IF NOT EXISTS match_favorite_routes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.driver_radar_preferences
  ADD COLUMN IF NOT EXISTS destination_radius_km INTEGER NOT NULL DEFAULT 25;

CREATE OR REPLACE FUNCTION public.set_driver_radar_route_filter(
  p_enabled BOOLEAN,
  p_destination_radius_km INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID := auth.uid();
  v_radius INTEGER := greatest(5, least(COALESCE(p_destination_radius_km, 25), 100));
  v_route_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT count(*) INTO v_route_count FROM public.favorite_routes WHERE user_id = v_user_id;

  IF COALESCE(p_enabled, false) AND v_route_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Añade al menos una ruta favorita antes de activar este filtro'
    );
  END IF;

  INSERT INTO public.driver_radar_preferences (
    user_id, match_favorite_routes, destination_radius_km, updated_at
  ) VALUES (
    v_user_id, COALESCE(p_enabled, false), v_radius, NOW()
  ) ON CONFLICT (user_id) DO UPDATE
  SET match_favorite_routes = excluded.match_favorite_routes,
      destination_radius_km = excluded.destination_radius_km,
      updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'match_favorite_routes', COALESCE(p_enabled, false),
    'destination_radius_km', v_radius,
    'favorite_route_count', v_route_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_driver_radar_route_filter(BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_driver_radar_route_filter(BOOLEAN, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_driver_radar_route_filter(BOOLEAN, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5) Historial de seguridad personal (alertas SOS y grabaciones)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_safety_history()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'evidence_type', COALESCE(a.metadata->>'type', a.metadata->>'evidence_type', 'sos_alert'),
      'status', a.status,
      'severity', a.severity,
      'created_at', a.created_at,
      'ride_id', a.ride_id,
      'origin_name', COALESCE(a.ride_snapshot->'origin'->>'name', a.ride_snapshot->'origin'->>'address'),
      'destination_name', COALESCE(a.ride_snapshot->'destination'->>'name', a.ride_snapshot->'destination'->>'address'),
      'metadata', a.metadata
    ) ORDER BY a.created_at DESC)
    FROM (
      SELECT * FROM public.emergency_alerts
      WHERE user_id = auth.uid()
      ORDER BY created_at DESC
      LIMIT 50
    ) a
  ), '[]'::JSONB);
$fn$;

REVOKE ALL ON FUNCTION public.get_my_safety_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_safety_history() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_safety_history() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6) Mapa en vivo del Dashboard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_live_ride_map()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'type', 'ride',
      'driver_id', r.driver_id,
      'status', r.status,
      'origin', r.origin,
      'destination', r.destination,
      'departure_time', r.departure_time,
      'price', r.price,
      'seats_available', r.seats_available,
      'overview_polyline', r.overview_polyline,
      'current_location', r.current_location
    ) ORDER BY r.departure_time ASC)
    FROM public.rides r
    WHERE auth.uid() IS NOT NULL
      AND (
        r.status IN ('active', 'in_progress')
        OR (r.status = 'scheduled' AND r.departure_time BETWEEN NOW() - INTERVAL '2 hours' AND NOW() + INTERVAL '12 hours')
      )
    LIMIT 100
  ), '[]'::JSONB);
$fn$;

REVOKE ALL ON FUNCTION public.get_live_ride_map() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_ride_map() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_live_ride_map() TO authenticated;

NOTIFY pgrst, 'reload schema';
