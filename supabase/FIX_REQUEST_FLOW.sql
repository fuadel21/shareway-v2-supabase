-- ============================================================================
-- SHAREWAY · FIX_REQUEST_FLOW.sql
-- ============================================================================
-- Arregla el Flujo 3: SOLICITAR plaza (pasajero) y OFRECER/ACEPTAR (conductor).
--
-- Problemas que corrige (detectados en auditoría de código 2026-10):
--   1. RLS: las políticas existentes solo dejaban ver solicitudes propias,
--      de admin o vinculadas a un viaje propio → NINGÚN conductor podía ver
--      las solicitudes 'pending' del mercado abierto → lista vacía.
--   2. FORCE ROW LEVEL SECURITY bloqueaba a las RPC SECURITY DEFINER del
--      owner (postgres) al escribir en ride_requests.
--   3. fulfill_ride_request (migración 20260507) llamaba a create_ride con
--      15 argumentos cuando la firma real en producción tiene 10, no hacía
--      FOR UPDATE (carrera entre conductores), insertaba en transactions
--      columnas que no existen (wallet_id, balance_after) y llamaba a
--      log_platform_audit que no existe en BD.
--   4. Faltaban columnas que create_ride_request espera (is_women_only,
--      overview_polyline, note, details...) si la BD no está sincronizada.
--
-- Es IDEMPOTENTE: puede ejecutarse varias veces sin romper nada.
-- Ejecutar entero en Supabase SQL Editor (usuario con rol postgres/owner).
-- ============================================================================

-- ============================================================================
-- SECCIÓN 0 · ASEGURAR ESQUEMA (todas son no-op si ya existen)
-- ============================================================================
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS requester_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS origin JSONB DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS destination JSONB DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS departure_time TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS seats_needed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS requested_seats INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS suggested_price NUMERIC(12,2) DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS details TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS is_women_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS distance NUMERIC DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS overview_polyline TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS pickup_location JSONB DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS dropoff_location JSONB DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS pickup_address TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS dropoff_address TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS booking_signature TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS payment_intent_id TEXT DEFAULT NULL;
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.ride_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;

-- gender en profiles (necesario para el escudo women-only del flujo)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT NULL;

-- ============================================================================
-- SECCIÓN 1 · RLS: quitar FORCE y abrir el mercado de solicitudes
-- ============================================================================
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
-- Sin FORCE: las funciones SECURITY DEFINER del owner (create_ride_request,
-- cancel_ride_request, fulfill_ride_request, confirm_trip_and_pay...) pueden
-- escribir en la tabla. El acceso cliente sigue controlado por las políticas.
ALTER TABLE public.ride_requests NO FORCE ROW LEVEL SECURITY;

-- Limpiar políticas SELECT antiguas (eran "solo propias/admin" y cegaban el
-- mercado abierto; además podían referenciar funciones inexistentes).
DO $do$
BEGIN
  DROP POLICY IF EXISTS "Secure ride requests access" ON public.ride_requests;
  DROP POLICY IF EXISTS "ride_requests_select_involved_or_admin" ON public.ride_requests;
  DROP POLICY IF EXISTS "Users can view their own requests" ON public.ride_requests;
  DROP POLICY IF EXISTS "ride_requests_involved" ON public.ride_requests;
  DROP POLICY IF EXISTS "ride_requests_select_involved_or_pending" ON public.ride_requests;
  DROP POLICY IF EXISTS "ride_requests_select_open_market" ON public.ride_requests;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_current_user_admin'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "ride_requests_select_open_market" ON public.ride_requests
      FOR SELECT TO authenticated
      USING (
        requester_id = auth.uid()
        OR public.is_current_user_admin()
        OR EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.id = ride_requests.ride_id AND r.driver_id = auth.uid()
        )
        OR (
          lower(COALESCE(status, 'pending')) IN ('pending', 'requested')
          AND COALESCE(departure_time, now()) > now() - interval '2 hours'
          AND (
            COALESCE(is_women_only, false) = false
            OR EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = auth.uid()
                AND lower(COALESCE(pr.gender, '')) = 'female'
            )
          )
        )
      )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY "ride_requests_select_open_market" ON public.ride_requests
      FOR SELECT TO authenticated
      USING (
        requester_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.id = ride_requests.ride_id AND r.driver_id = auth.uid()
        )
        OR (
          lower(COALESCE(status, 'pending')) IN ('pending', 'requested')
          AND COALESCE(departure_time, now()) > now() - interval '2 hours'
          AND (
            COALESCE(is_women_only, false) = false
            OR EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = auth.uid()
                AND lower(COALESCE(pr.gender, '')) = 'female'
            )
          )
        )
      )
    $policy$;
  END IF;
END
$do$;

-- INSERT/UPDATE propio-pendiente (lo usa el flujo de pago con tarjeta vía
-- Edge Function con el JWT del usuario; migración 20260828).
DROP POLICY IF EXISTS "ride_requests_insert_own_pending" ON public.ride_requests;
CREATE POLICY "ride_requests_insert_own_pending"
ON public.ride_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requester_id = auth.uid()
  AND lower(COALESCE(status, 'pending')) IN (
    'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid'
  )
);

DROP POLICY IF EXISTS "ride_requests_update_own_pending" ON public.ride_requests;
CREATE POLICY "ride_requests_update_own_pending"
ON public.ride_requests
FOR UPDATE
TO authenticated
USING (
  requester_id = auth.uid()
  AND lower(COALESCE(status, '')) IN (
    'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid'
  )
)
WITH CHECK (
  requester_id = auth.uid()
  AND lower(COALESCE(status, 'pending')) IN (
    'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid'
  )
);

DROP POLICY IF EXISTS "ride_requests_service_role_all" ON public.ride_requests;
CREATE POLICY "ride_requests_service_role_all"
ON public.ride_requests
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- SECCIÓN 2 · Limpiar variantes antiguas de las funciones (evita overloads
--             ambiguos para PostgREST)
-- ============================================================================
DO $do$
BEGIN
  EXECUTE COALESCE (
    (
      SELECT string_agg(
        format('DROP FUNCTION IF EXISTS public.%I(%s);', p.proname,
               pg_get_function_identity_arguments(p.oid)),
        E'\n'
      )
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('cancel_ride_request', 'fulfill_ride_request')
    ),
    'SELECT 1'
  );
END
$do$;

-- ============================================================================
-- SECCIÓN 3 · cancel_ride_request (el pasajero cancela su solicitud)
--             El cliente espera EXCEPCIONES (muestra error.message).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_ride_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID := auth.uid();
  v_req RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_req
  FROM public.ride_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;

  IF v_req.requester_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'No tienes permiso para cancelar esta solicitud';
  END IF;

  IF lower(COALESCE(v_req.status, '')) IN
     ('cancelled', 'canceled', 'fulfilled', 'confirmed', 'completed', 'expired')
  THEN
    RAISE EXCEPTION 'Esta solicitud no se puede cancelar en su estado actual (%)',
      COALESCE(v_req.status, 'desconocido');
  END IF;

  UPDATE public.ride_requests
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Solicitud cancelada correctamente'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_ride_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_ride_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride_request(UUID) TO service_role;

COMMENT ON FUNCTION public.cancel_ride_request IS 'Cancela una solicitud de viaje por parte del usuario que la creó';

-- ============================================================================
-- SECCIÓN 4 · fulfill_ride_request (el conductor acepta una solicitud,
--             crea el viaje, reserva los fondos del pasajero y lo embarca)
--
-- Firma pública idéntica a la que usa el cliente (10 params con nombre).
-- Reglas:
--   · La fila de la solicitud es la fuente de verdad (bloqueo FOR UPDATE).
--   · Precio por plaza; el total cargado = precio x plazas solicitadas.
--   · Fondos del pasajero pasan de balance a held_balance (Garantía ShareWay).
--   · Escudo women-only verificado en servidor con profiles.gender.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
  p_request_id UUID,
  p_origin JSONB DEFAULT NULL,
  p_destination JSONB DEFAULT NULL,
  p_departure_time TIMESTAMPTZ DEFAULT NULL,
  p_seats INTEGER DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_details TEXT DEFAULT '',
  p_distance NUMERIC DEFAULT NULL,
  p_overview_polyline TEXT DEFAULT NULL,
  p_waypoints JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver_id UUID := auth.uid();
  v_request RECORD;
  v_pin TEXT;
  v_seats_needed INTEGER;
  v_price_per_seat NUMERIC;
  v_total NUMERIC;
  v_wallet_balance NUMERIC;
  v_driver_gender TEXT;
  v_ride_res JSONB;
  v_ride_id UUID;
  v_passenger_obj JSONB;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- 1. Bloquear y validar la solicitud (evita que dos conductores la acepten)
  SELECT * INTO v_request
  FROM public.ride_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
  END IF;

  IF v_request.requester_id IS NULL OR v_request.requester_id = v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_FULFILL_OWN_REQUEST');
  END IF;

  IF lower(COALESCE(v_request.status, '')) <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_AVAILABLE',
      'message', 'Esta solicitud ya fue aceptada por otro conductor.');
  END IF;

  IF v_request.departure_time IS NULL OR v_request.departure_time <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_DEPARTED',
      'message', 'La hora de salida de esta solicitud ya ha pasado.');
  END IF;

  -- 2. Escudo women-only (verificado en servidor)
  IF COALESCE(v_request.is_women_only, false) THEN
    SELECT lower(COALESCE(gender, '')) INTO v_driver_gender
    FROM public.profiles
    WHERE id = v_driver_id;

    IF COALESCE(v_driver_gender, '') <> 'female' THEN
      RETURN jsonb_build_object('success', false, 'error', 'WOMEN_ONLY_REQUEST',
        'message', 'Esta solicitud está reservada para conductoras.');
    END IF;
  END IF;

  -- 3. Cálculo del dinero (fuente de verdad: la solicitud + parámetros)
  v_seats_needed := GREATEST(
    COALESCE(v_request.seats_needed, v_request.requested_seats, 1), 1
  );
  v_price_per_seat := round(COALESCE(p_price, v_request.suggested_price, 0)::numeric, 2);

  IF v_price_per_seat < 0.50 OR v_price_per_seat > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRICE',
      'message', 'El precio por plaza debe estar entre 0,50 y 300 EUR.');
  END IF;

  -- Banda de tarifa: mismo limite que aplicara create_ride (evita llegar
  -- al create y fallar con un error menos claro).
  IF v_price_per_seat > public.sw_progressive_price(COALESCE(v_request.distance, 0)) + 0.05 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRICE',
      'message', 'El precio por plaza supera la tarifa recomendada para esta distancia.');
  END IF;

  v_total := round(v_price_per_seat * v_seats_needed, 2);

  -- 4. Verificar saldo del pasajero (con bloqueo de cartera)
  SELECT balance INTO v_wallet_balance
  FROM public.wallets
  WHERE user_id = v_request.requester_id
  FOR UPDATE;

  IF v_wallet_balance IS NULL OR v_wallet_balance < v_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'PASSENGER_INSUFFICIENT_FUNDS',
      'message', 'El pasajero no tiene saldo suficiente para este viaje.');
  END IF;

  -- 5. Crear el viaje (driver = auth.uid(); create_ride valida precio/fecha)
  v_ride_res := public.create_ride(
    COALESCE(p_origin, v_request.origin),
    COALESCE(p_destination, v_request.destination),
    COALESCE(p_departure_time, v_request.departure_time),
    GREATEST(COALESCE(p_seats, v_seats_needed), v_seats_needed),
    v_price_per_seat,
    COALESCE(NULLIF(trim(p_details), ''), 'Viaje creado al aceptar una solicitud'),
    COALESCE(p_distance, v_request.distance, 0),
    COALESCE(NULLIF(p_overview_polyline, ''), COALESCE(v_request.overview_polyline, '')),
    COALESCE(p_waypoints, '[]'::jsonb),
    NULL::uuid
  );

  IF v_ride_res IS NULL OR NOT COALESCE((v_ride_res->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_CREATION_FAILED',
      'detail', v_ride_res);
  END IF;

  v_ride_id := (v_ride_res->>'rideId')::UUID;

  -- 6. Reservar fondos del pasajero (balance -> held_balance)
  BEGIN
    UPDATE public.wallets
    SET balance = round(balance - v_total, 2),
        held_balance = round(COALESCE(held_balance, 0) + v_total, 2),
        updated_at = now()
    WHERE user_id = v_request.requester_id
      AND balance >= v_total;
  EXCEPTION WHEN undefined_column THEN
    UPDATE public.wallets
    SET balance = round(balance - v_total, 2),
        held_balance = round(COALESCE(held_balance, 0) + v_total, 2)
    WHERE user_id = v_request.requester_id
      AND balance >= v_total;
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSENGER_INSUFFICIENT_FUNDS: no se pudo reservar el importe';
  END IF;

  -- 7. Registrar la transacción (log histórico, best-effort)
  BEGIN
    INSERT INTO public.transactions (user_id, type, amount, description, related_ride_id)
    VALUES (
      v_request.requester_id,
      'hold',
      -v_total,
      'Reserva por aceptación de solicitud (conductor)',
      v_ride_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fulfill_ride_request] transaction log skipped: %', SQLERRM;
  END;

  -- 8. Marcar la solicitud como fulfilled y vincularla al viaje
  UPDATE public.ride_requests
  SET status = 'fulfilled',
      ride_id = v_ride_id,
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_AVAILABLE (cambio de estado inesperado)';
  END IF;

  -- 9. Embarcar al pasajero en el viaje y actualizar asientos
  v_pin := lpad((floor(random() * 10000))::INT::TEXT, 4, '0');
  v_passenger_obj := jsonb_build_object(
    'id', v_request.requester_id,
    'pin', v_pin,
    'booked_price', v_price_per_seat,
    'seats', v_seats_needed,
    'status', 'confirmed',
    'payment_status', 'held',
    'payment_method', 'wallet',
    'joined_at', now()
  );

  UPDATE public.rides
  SET passengers = COALESCE(passengers, '[]'::jsonb) || jsonb_build_array(v_passenger_obj),
      seats_available = GREATEST(COALESCE(seats_available, 0) - v_seats_needed, 0)
  WHERE id = v_ride_id;

  -- 10. Notificar al pasajero (best-effort)
  BEGIN
    INSERT INTO public.notifications (
      user_id, actor_id, type, title, message, action_url,
      entity_type, entity_id, priority, metadata
    ) VALUES (
      v_request.requester_id,
      v_driver_id,
      'ride_request_accepted',
      'Solicitud aceptada',
      '¡Un conductor ha aceptado tu solicitud! Tu plaza queda reservada.',
      '/my-rides',
      'ride_request',
      p_request_id::text,
      'normal',
      jsonb_build_object('requestId', p_request_id, 'rideId', v_ride_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fulfill_ride_request] notification skipped: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'rideId', v_ride_id,
    'requestId', p_request_id,
    'pin', v_pin,
    'message', 'Viaje creado y pasajero vinculado con éxito'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fulfill_ride_request(UUID, JSONB, JSONB, TIMESTAMPTZ, INTEGER, NUMERIC, TEXT, NUMERIC, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_ride_request(UUID, JSONB, JSONB, TIMESTAMPTZ, INTEGER, NUMERIC, TEXT, NUMERIC, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request(UUID, JSONB, JSONB, TIMESTAMPTZ, INTEGER, NUMERIC, TEXT, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request(UUID, JSONB, JSONB, TIMESTAMPTZ, INTEGER, NUMERIC, TEXT, NUMERIC, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.fulfill_ride_request IS 'Conductor acepta una solicitud: crea viaje, reserva fondos del pasajero y lo embarca';

-- ============================================================================
-- SECCIÓN 5 · sw_expire_past_ride_requests (expira solicitudes pasadas;
--             la llama MyRequests al cargar). Copia defensiva de 20260629
--             alineada a 120 min de gracia (20260901-0900).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sw_expire_past_ride_requests(
  p_grace_minutes INTEGER DEFAULT 60,
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_has_status BOOLEAN := false;
  v_has_updated_at BOOLEAN := false;
  v_has_expired_at BOOLEAN := false;
  v_origin_col TEXT;
  v_destination_col TEXT;
  v_sql TEXT;
  v_update_sql TEXT;
  v_request RECORD;
  v_count INTEGER := 0;
  v_message TEXT;
  v_key TEXT;
BEGIN
  IF to_regclass('public.ride_requests') IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ride_requests'
      AND column_name IN ('id', 'requester_id', 'departure_time')
    GROUP BY table_name
    HAVING count(*) = 3
  ) THEN
    RAISE WARNING '[expire_requests] ride_requests needs id, requester_id and departure_time';
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ride_requests' AND column_name = 'status'
  ) INTO v_has_status;

  IF NOT v_has_status THEN
    RAISE WARNING '[expire_requests] ride_requests.status does not exist';
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ride_requests' AND column_name = 'updated_at'
  ) INTO v_has_updated_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ride_requests' AND column_name = 'expired_at'
  ) INTO v_has_expired_at;

  SELECT column_name INTO v_origin_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ride_requests'
    AND column_name IN ('origin_address', 'origin', 'from_address')
  ORDER BY array_position(ARRAY['origin_address', 'origin', 'from_address'], column_name)
  LIMIT 1;

  SELECT column_name INTO v_destination_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ride_requests'
    AND column_name IN ('destination_address', 'destination', 'to_address')
  ORDER BY array_position(ARRAY['destination_address', 'destination', 'to_address'], column_name)
  LIMIT 1;

  p_grace_minutes := greatest(5, least(coalesce(p_grace_minutes, 60), 10080));
  p_limit := greatest(1, least(coalesce(p_limit, 100), 1000));

  v_sql := 'select id::text as request_id, requester_id::uuid as requester_id, departure_time::timestamptz as departure_time, coalesce(status::text, '''') as status_text';

  IF v_origin_col IS NOT NULL THEN
    v_sql := v_sql || format(', coalesce(%I::text, '''') as origin_text', v_origin_col);
  ELSE
    v_sql := v_sql || ', ''''::text as origin_text';
  END IF;

  IF v_destination_col IS NOT NULL THEN
    v_sql := v_sql || format(', coalesce(%I::text, '''') as destination_text', v_destination_col);
  ELSE
    v_sql := v_sql || ', ''''::text as destination_text';
  END IF;

  v_sql := v_sql || '
    from public.ride_requests
    where departure_time is not null
      and departure_time < now() - ($1 * interval ''1 minute'')
      and lower(coalesce(status::text, '''')) not in (
        ''expired'', ''cancelled'', ''canceled'', ''completed'', ''accepted'', ''matched'', ''rejected'', ''archived'', ''fulfilled''
      )
    order by departure_time asc
    limit $2
  ';

  FOR v_request IN EXECUTE v_sql USING p_grace_minutes, p_limit LOOP
    v_update_sql := 'update public.ride_requests set status = $1';

    IF v_has_updated_at THEN
      v_update_sql := v_update_sql || ', updated_at = now()';
    END IF;

    IF v_has_expired_at THEN
      v_update_sql := v_update_sql || ', expired_at = coalesce(expired_at, now())';
    END IF;

    v_update_sql := v_update_sql || ' where id::text = $2';

    EXECUTE v_update_sql USING 'expired', v_request.request_id;

    v_count := v_count + 1;

    IF v_request.requester_id IS NOT NULL THEN
      v_key := 'ride_request:' || v_request.request_id || ':expired';

      BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM public.notifications
        WHERE user_id = v_request.requester_id
          AND type = 'ride_request_expired'
          AND entity_type = 'ride_request'
          AND entity_id = v_request.request_id
          AND metadata->>'automationKey' = v_key
      ) THEN
        v_message := 'Tu solicitud de viaje ha caducado porque la hora ya pasó.';

        IF coalesce(v_request.origin_text, '') <> '' OR coalesce(v_request.destination_text, '') <> '' THEN
          v_message := v_message || ' Ruta:';
          IF coalesce(v_request.origin_text, '') <> '' THEN
            v_message := v_message || ' ' || v_request.origin_text;
          END IF;
          IF coalesce(v_request.destination_text, '') <> '' THEN
            v_message := v_message || ' → ' || v_request.destination_text;
          END IF;
          v_message := v_message || '.';
        END IF;

          INSERT INTO public.notifications (
            user_id, actor_id, type, title, message, action_url,
            entity_type, entity_id, priority, metadata
          ) VALUES (
            v_request.requester_id,
            NULL,
            'ride_request_expired',
            'Solicitud caducada',
            v_message,
            '/request/' || v_request.request_id,
            'ride_request',
            v_request.request_id,
            'normal',
            jsonb_build_object(
              'requestId', v_request.request_id,
              'departureTime', v_request.departure_time,
              'previousStatus', v_request.status_text,
              'newStatus', 'expired',
              'graceMinutes', p_grace_minutes,
              'automationKey', v_key
            )
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[expire_requests] notification skipped: %', SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sw_expire_past_ride_requests(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_expire_past_ride_requests(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.sw_expire_past_ride_requests(INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.sw_expire_old_requests()
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.sw_expire_past_ride_requests(120, 100);
$fn$;

REVOKE ALL ON FUNCTION public.sw_expire_old_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_expire_old_requests() FROM anon;
GRANT EXECUTE ON FUNCTION public.sw_expire_old_requests() TO authenticated;

-- Programación opcional con pg_cron (cada 15 min). Segura si no está instalado.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule('shareway_expire_past_ride_requests');
    PERFORM cron.schedule(
      'shareway_expire_past_ride_requests',
      '*/15 * * * *',
      'SELECT public.sw_expire_past_ride_requests(120, 100);'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[expire_requests] cron schedule skipped: %', SQLERRM;
END
$do$;

-- ============================================================================
-- FIN · Recargar el esquema de PostgREST para que aplique los cambios
-- ============================================================================
NOTIFY pgrst, 'reload schema';
