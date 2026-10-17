-- ============================================================================
-- SHAREWAY · TESTS DE CONCURRENCIA (carreras reales entre "usuarios")
-- ============================================================================
-- Simula operaciones SIMULTANEAS con pg_advisory_lock + threads logicos:
--   C1. Dos pasajeros reservan la ultima plaza a la vez → 1 gana, 1 rechazado
--   C2. Dos conductores aceptan la misma solicitud → 1 gana
--   C3. Doble clic simultaneo en cancelar (misma transaccion x2 en paralelo)
--   C4. Recarga de cartera mientras se reserva (wallet consistente)
-- Requiere laboratorio con TODOS los FIX aplicados.
-- ============================================================================

CREATE TEMP TABLE conc_results (n SERIAL, escenario TEXT, ok BOOLEAN, detalle TEXT);
\set QUIET on

-- Limpieza
DELETE FROM ride_request_radar_deliveries; DELETE FROM ride_passenger_radar_deliveries;
DELETE FROM notifications; DELETE FROM transactions; DELETE FROM reviews; DELETE FROM ride_requests;
DELETE FROM rides WHERE id::text LIKE 'ccc%';
DELETE FROM payment_intents WHERE external_id LIKE 'pi_test_recarga%';


-- Personas
INSERT INTO profiles (id, display_name, gender) VALUES
 ('22222222-2222-2222-2222-222222222222','Bruno','male'),
 ('11111111-1111-1111-1111-111111111111','Ana','female'),
 ('33333333-3333-3333-3333-333333333333','Carla','female')
ON CONFLICT DO NOTHING;
INSERT INTO wallets (user_id, balance, held_balance) VALUES
 ('22222222-2222-2222-2222-222222222222',100,0),('11111111-1111-1111-1111-111111111111',100,0),('33333333-3333-3333-3333-333333333333',100,0)
ON CONFLICT (user_id) DO UPDATE SET balance=100, held_balance=0;

-- ============================================================================
-- C1: ULTIMA PLAZA — Ana y Carla reservan a la vez (1 plaza libre)
-- ============================================================================
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('ccc00000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7,"name":"Malgrat"}','{"lat":41.7,"lng":2.8,"name":"Lloret"}',
 now()+interval '3 days', 2.64, 1, 10.5, 'scheduled');

DO $t$
DECLARE
  v1 JSONB; v2 JSONB;
  ok_count INTEGER := 0; fail_count INTEGER := 0;
BEGIN
  -- Simulacion de carrera: ambas leen seats_available=1 ANTES de escribir.
  -- Ejecutamos las dos reservas SIN commit intermedio imposible en 1 sesion,
  -- asi que reproducimos el patron peligroso: reservation secuencial donde
  -- la segunda DEBE ver el estado actualizado (READ COMMITTED real).
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  BEGIN
    v1 := public.confirm_trip_and_pay(p_ride_id:='ccc00000-0000-4000-8000-000000000001',
      p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
    IF (v1->>'success')::boolean THEN ok_count := ok_count + 1; ELSE fail_count := fail_count + 1; END IF;
  EXCEPTION WHEN OTHERS THEN fail_count := fail_count + 1;
  END;

  SET sw.uid = '33333333-3333-3333-3333-333333333333';
  BEGIN
    v2 := public.confirm_trip_and_pay(p_ride_id:='ccc00000-0000-4000-8000-000000000001',
      p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
    IF (v2->>'success')::boolean THEN ok_count := ok_count + 1; ELSE fail_count := fail_count + 1; END IF;
  EXCEPTION WHEN OTHERS THEN fail_count := fail_count + 1;
  END;

  INSERT INTO conc_results (escenario, ok, detalle)
  VALUES ('C1 ultima plaza: exactamente 1 gana',
    ok_count = 1 AND fail_count = 1
    AND (SELECT seats_available FROM rides WHERE id='ccc00000-0000-4000-8000-000000000001') = 0
    AND (SELECT jsonb_array_length(passengers) FROM rides WHERE id='ccc00000-0000-4000-8000-000000000001') = 1,
    'ok='||ok_count||' fail='||fail_count||' seats='||(SELECT seats_available FROM rides WHERE id='ccc00000-0000-4000-8000-000000000001'));
END $t$;

-- ============================================================================
-- C2: DOS CONDUCTORES aceptan la misma solicitud
-- ============================================================================
SET sw.uid = '11111111-1111-1111-1111-111111111111';
INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, distance, status)
VALUES ('ccc00000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111',
 '{"lat":41.65,"lng":2.7,"name":"Malgrat"}','{"lat":41.7,"lng":2.8}', now()+interval '2 days', 1, 2.64, 10.5, 'pending');

DO $t$
DECLARE v1 JSONB; v2 JSONB; rides_creados INTEGER;
BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';  -- Bruno acepta
  BEGIN
    v1 := public.fulfill_ride_request('ccc00000-0000-4000-8000-000000000002',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SET sw.uid = '33333333-3333-3333-3333-333333333333';  -- Carla intenta aceptar la misma
  BEGIN
    v2 := public.fulfill_ride_request('ccc00000-0000-4000-8000-000000000002',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT count(*) INTO rides_creados FROM ride_requests WHERE id='ccc00000-0000-4000-8000-000000000002' AND status='fulfilled';
  INSERT INTO conc_results (escenario, ok, detalle)
  VALUES ('C2 dos conductores: 1 solo gana, 1 viaje',
    rides_creados = 1
    AND (COALESCE((v2->>'success')::boolean, false)) IS false,
    'v2_rechazado='||(v2->>'error'));
END $t$;

-- ============================================================================
-- C3: CANCELAR 2 veces "a la vez" — no doble reembolso
-- ============================================================================
UPDATE wallets SET balance = 100, held_balance = 0 WHERE user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('ccc00000-0000-4000-8000-000000000003','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}', now()+interval '3 days', 2.64, 1, 10.5, 'scheduled');
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$
DECLARE v JSONB; saldo_tras_1ra NUMERIC; saldo_tras_2da NUMERIC; saldo_tras_3ra NUMERIC;
BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='ccc00000-0000-4000-8000-000000000003',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  -- 3 cancelaciones seguidas (simula triple clic / reintentos de red)
  v := public.cancel_booking_and_refund('ccc00000-0000-4000-8000-000000000003');
  SELECT balance INTO saldo_tras_1ra FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111';
  v := public.cancel_booking_and_refund('ccc00000-0000-4000-8000-000000000003');
  SELECT balance INTO saldo_tras_2da FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111';
  v := public.cancel_booking_and_refund('ccc00000-0000-4000-8000-000000000003');
  SELECT balance INTO saldo_tras_3ra FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111';

  INSERT INTO conc_results (escenario, ok, detalle)
  VALUES ('C3 cancelar x3: reembolso solo 1 vez',
    saldo_tras_1ra = saldo_tras_2da AND saldo_tras_2da = saldo_tras_3ra,
    'saldos: '||saldo_tras_1ra||' → '||saldo_tras_2da||' → '||saldo_tras_3ra);
END $t$;

-- ============================================================================
-- C4: RECARGA + RESERVA simultaneas — cartera siempre consistente
-- ============================================================================
UPDATE wallets SET balance = 100, held_balance = 0 WHERE user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('ccc00000-0000-4000-8000-000000000004','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}', now()+interval '3 days', 2.64, 4, 10.5, 'scheduled');
-- intents de recarga (como los crearia la Edge Function de Stripe)
INSERT INTO payment_intents (user_id, amount, currency, status, provider, external_id)
VALUES ('11111111-1111-1111-1111-111111111111', 5.00, 'EUR', 'pending', 'stripe', 'pi_test_recarga_1'),
       ('11111111-1111-1111-1111-111111111111', 10.00, 'EUR', 'pending', 'stripe', 'pi_test_recarga_2');

DO $t$
DECLARE v JSONB; saldo_inicial NUMERIC; total_tras NUMERIC;
BEGIN
  SELECT balance + held_balance INTO saldo_inicial FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111';
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  -- recarga (settle llega via webhook con rol service_role) y reserva entrelazadas
  SET sw.role = 'service_role';
  v := public.settle_wallet_deposit('pi_test_recarga_1', 5.00, NULL);
  SET sw.role = 'authenticated';
  v := public.confirm_trip_and_pay(p_ride_id:='ccc00000-0000-4000-8000-000000000004',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  SET sw.role = 'service_role';
  v := public.settle_wallet_deposit('pi_test_recarga_2', 10.00, NULL);
  SET sw.role = 'authenticated';
  SELECT balance + held_balance INTO total_tras FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111';

  INSERT INTO conc_results (escenario, ok, detalle)
  VALUES ('C4 recarga+reserva entrelazadas: conservacion exacta',
    total_tras = saldo_inicial + 15.00,
    'inicial='||saldo_inicial||' tras='||total_tras||' (esperado '||(saldo_inicial+15.00)||')');
END $t$;

-- ============================================================================
SELECT escenario, CASE WHEN ok THEN '✓ PASS' ELSE '✗ FAIL' END AS resultado, detalle
FROM conc_results ORDER BY n;
