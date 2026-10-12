-- ============================================================================
-- SHAREWAY · FIX_BOOKING_CONFIRM_V2.sql
-- ============================================================================
-- Hace que confirm_trip_and_pay (pago con cartera) cobre el importe
-- RECALCULADO POR KILÓMETRO (sw_build_booking_quote) en lugar del precio
-- plano del viaje, y que verifique el saldo ANTES de descontar.
--
-- Mantiene la firma pública exacta que usa el cliente:
--   confirm_trip_and_pay(p_ride_id, p_request_id, p_pickup_address,
--                        p_pickup_location, p_price, p_num_seats,
--                        p_dropoff_address, p_dropoff_location)
-- p_price se IGNORA (se mantiene por compatibilidad): el importe real
-- siempre lo calcula el servidor con la misma fórmula del quote.
--
-- Requiere que FIX_BOOKING_QUOTE_V2.sql esté aplicado (sw_build_booking_quote).
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- Limpiar la firma antigua (dropoff ANTES de price) si existe: dos firmas
-- con los mismos nombres de parametro en distinto orden hacen ambigua la
-- llamada para PostgREST (PGRST203).
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, text, jsonb, text, jsonb, numeric, integer);

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
  p_ride_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_location JSONB DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_num_seats INTEGER DEFAULT 1,
  p_dropoff_address TEXT DEFAULT NULL,
  p_dropoff_location JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user UUID := auth.uid();
  v_quote JSONB;
  v_amount NUMERIC;
  v_pin TEXT;
  v_ride RECORD;
  v_balance NUMERIC;
  v_passenger JSONB;
  v_existing JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- 1. El servidor calcula el importe con la misma fórmula del quote
  --    (valida: viaje scheduled, futuro, plazas, no conductor, precio por km).
  v_quote := public.sw_build_booking_quote(
    p_ride_id,
    p_pickup_location,
    p_dropoff_location,
    GREATEST(COALESCE(p_num_seats, 1), 1)
  );

  IF v_quote IS NULL OR NOT COALESCE((v_quote->>'success')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(v_quote->>'error', 'QUOTE_FAILED');
  END IF;

  v_amount := round((v_quote->>'total')::NUMERIC, 2);
  v_pin := lpad((floor(random() * 10000))::INT::TEXT, 4, '0');

  -- 2. Bloquear el viaje y re-verificar estado y plazas
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF v_ride.id IS NULL OR v_ride.status IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE';
  END IF;

  IF COALESCE(v_ride.seats_available, 0) < GREATEST(COALESCE(p_num_seats, 1), 1) THEN
    RAISE EXCEPTION 'NO_HAY_PLAZAS';
  END IF;

  -- 3. Evitar doble reserva del mismo usuario en el mismo viaje
  FOR v_existing IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    IF (v_existing->>'id')::UUID = v_user
       AND lower(COALESCE(v_existing->>'status', 'confirmed')) NOT IN
           ('cancelled', 'canceled', 'rejected', 'no_show') THEN
      RAISE EXCEPTION 'YA_TIENES_RESERVA_EN_ESTE_VIAJE';
    END IF;
  END LOOP;

  -- 4. Cartera: bloquear, verificar saldo y mover a retenido
  SELECT balance INTO v_balance
  FROM public.wallets
  WHERE user_id = v_user
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < v_amount THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE';
  END IF;

  UPDATE public.wallets
  SET balance = round(balance - v_amount, 2),
      held_balance = round(COALESCE(held_balance, 0) + v_amount, 2),
      updated_at = NOW()
  WHERE user_id = v_user
    AND balance >= v_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE';
  END IF;

  -- 5. Log de transacción (best-effort)
  BEGIN
    INSERT INTO public.transactions (user_id, type, amount, description, related_ride_id)
    VALUES (v_user, 'hold', -v_amount, 'Reserva de plaza (cartera)', p_ride_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[confirm_trip_and_pay] transaction log skipped: %', SQLERRM;
  END;

  -- 6. Embarcar al pasajero y descontar plazas
  v_passenger := jsonb_build_object(
    'id', v_user,
    'status', 'confirmed',
    'pin', v_pin,
    'booked_price', v_amount,
    'payment_method', 'wallet',
    'seats', GREATEST(COALESCE(p_num_seats, 1), 1),
    'pickup_address', COALESCE(p_pickup_address, ''),
    'dropoff_address', COALESCE(p_dropoff_address, ''),
    'joined_at', NOW()
  );

  UPDATE public.rides
  SET passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_array(v_passenger),
      seats_available = GREATEST(COALESCE(seats_available, 0) - GREATEST(COALESCE(p_num_seats, 1), 1), 0)
  WHERE id = p_ride_id;

  -- 7. Vincular la solicitud si venía de una
  IF p_request_id IS NOT NULL THEN
    UPDATE public.ride_requests
    SET status = 'confirmed'
    WHERE id = p_request_id
      AND requester_id = v_user;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'pin', v_pin,
    'amount', v_amount,
    'message', 'Reserva confirmada con cartera'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_trip_and_pay(UUID, UUID, TEXT, JSONB, NUMERIC, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_trip_and_pay(UUID, UUID, TEXT, JSONB, NUMERIC, INTEGER, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay(UUID, UUID, TEXT, JSONB, NUMERIC, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay(UUID, UUID, TEXT, JSONB, NUMERIC, INTEGER, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
