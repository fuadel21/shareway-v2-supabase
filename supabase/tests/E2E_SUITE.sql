-- ============================================================================
-- SHAREWAY · SUITE E2E COMPLETA (48 escenarios) — 48/48 PASS el 2026-10-17
-- ============================================================================
-- Ejecutar contra una BD de laboratorio con TODOS los FIX_*.sql aplicados
-- (replica de produccion). Requiere PostGIS y el mock de auth.uid() via
-- SET sw.uid = '<uuid>'. Resultado: tabla test_results con PASS/FAIL.
-- NOTA: crea la tabla radar_push_outbox si falta (linea de compatibilidad).
CREATE TEMP TABLE test_results (n SERIAL, bloque TEXT, escenario TEXT, ok BOOLEAN, detalle TEXT);

\set QUIET on
CREATE TABLE IF NOT EXISTS radar_push_outbox (id BIGSERIAL PRIMARY KEY, user_id UUID, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_attempt_at TIMESTAMPTZ, locked_at TIMESTAMPTZ, last_error TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), notification_id BIGINT);

-- LIMPIEZA total
DELETE FROM ride_request_radar_deliveries; DELETE FROM ride_passenger_radar_deliveries;
DELETE FROM radar_push_outbox; DELETE FROM notifications; DELETE FROM transactions;
DELETE FROM reviews; DELETE FROM ride_requests;
DELETE FROM rides WHERE id::text LIKE 'aaa00000-%';

-- Personas
INSERT INTO profiles (id, display_name, full_name, gender) VALUES
 ('22222222-2222-2222-2222-222222222222','Bruno','Bruno','male'),
 ('11111111-1111-1111-1111-111111111111','Ana','Ana','female'),
 ('33333333-3333-3333-3333-333333333333','Carla','Carla','female'),
 ('44444444-4444-4444-4444-444444444444','David','David','male')
ON CONFLICT DO NOTHING;
INSERT INTO wallets (user_id, balance, held_balance) VALUES
 ('22222222-2222-2222-2222-222222222222', 100, 0),
 ('11111111-1111-1111-1111-111111111111', 100, 0),
 ('33333333-3333-3333-3333-333333333333', 100, 0)
ON CONFLICT (user_id) DO UPDATE SET balance = 100, held_balance = 0;
INSERT INTO wallets (user_id, balance, held_balance) VALUES ('44444444-4444-4444-4444-444444444444', 0, 0)
ON CONFLICT (user_id) DO UPDATE SET balance = 0, held_balance = 0;

-- ============================================================================
-- A · PUBLICAR: validaciones servidor
-- ============================================================================
SET sw.uid = '22222222-2222-2222-2222-222222222222';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7,"name":"A"}'::jsonb,'{"lat":41.7,"lng":2.8,"name":"B"}'::jsonb,
    now()+interval '2 hours', 4, 2.64, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A1 publica con precio en banda', (v->>'success')::boolean, 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A1 publica con precio en banda', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 99.00, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A2 precio sobre banda rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A2 precio sobre banda rechazado', SQLERRM LIKE '%PRICE_ABOVE_SUGGESTED%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 0.20, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A3 precio bajo minimo rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A3 precio bajo minimo rechazado', SQLERRM LIKE '%INVALID_RIDE_PRICE%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 350.00, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A4 precio sobre maximo rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A4 precio sobre maximo rechazado', SQLERRM LIKE '%INVALID_RIDE_PRICE%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()-interval '1 hour', 4, 2.64, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A5 fecha pasada rechazada', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A5 fecha pasada rechazada', SQLERRM LIKE '%DEPARTURE_TOO_SOON%', SQLERRM); END $t$;
SET sw.uid = '';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 2.64, '', 10.5, '', '[]'::jsonb, NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A6 sin sesion rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A6 sin sesion rechazado', (SQLERRM ILIKE '%autentic%' OR SQLERRM LIKE '%AUTH_REQUIRED%'), SQLERRM); END $t$;
SET sw.uid = '22222222-2222-2222-2222-222222222222';
DO $t$ DECLARE v1 JSONB; v2 JSONB; id1 UUID; id2 UUID; BEGIN
  v1 := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 2.64, '', 10.5, '', '[]'::jsonb, '11111111-aaaa-4bbb-8ccc-000000000001');
  id1 := (v1->>'rideId')::UUID;
  v2 := public.create_ride('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '2 hours', 4, 2.64, '', 10.5, '', '[]'::jsonb, '11111111-aaaa-4bbb-8ccc-000000000001');
  id2 := (v2->>'rideId')::UUID;
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A7 doble clic idempotente', id1 = id2, '');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('A','A7 doble clic idempotente', false, SQLERRM); END $t$;

-- ============================================================================
-- B · RESERVAR
-- ============================================================================
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222',
 '{"lat":41.6465,"lng":2.7416,"name":"Malgrat"}','{"lat":41.6987,"lng":2.8475,"name":"Lloret"}',
 now()+interval '3 days', 2.64, 4, 10.5, 'scheduled');
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":41.6465,"lng":2.7416}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=2);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B1 reserva 2 plazas con PIN', length(COALESCE(v->>'pin',''))=4, 'pin='||(v->>'pin'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B1 reserva 2 plazas con PIN', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":41.6465,"lng":2.7416}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B2 doble reserva rechazada', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B2 doble reserva rechazada', SQLERRM LIKE '%YA_TIENES_RESERVA%', SQLERRM); END $t$;
SET sw.uid = '22222222-2222-2222-2222-222222222222';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":41.6465,"lng":2.7416}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B3 conductor no reserva su viaje', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B3 conductor no reserva su viaje', SQLERRM LIKE '%DRIVER_CANNOT_BOOK_OWN_RIDE%', SQLERRM); END $t$;
SET sw.uid = '44444444-4444-4444-4444-444444444444';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":41.6465,"lng":2.7416}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B4 sin saldo rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B4 sin saldo rechazado', SQLERRM LIKE '%SALDO_INSUFICIENTE%', SQLERRM); END $t$;
SET sw.uid = '33333333-3333-3333-3333-333333333333';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":41.6465,"lng":2.7416}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=5);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B5 mas plazas que disponibles rechazado', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B5 mas plazas que disponibles rechazado', SQLERRM LIKE '%NO_SEATS_AVAILABLE%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000001',
    p_pickup_location:='{"lat":91,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.6987,"lng":2.8475}'::jsonb, p_num_seats:=1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B6 coordenadas invalidas rechazadas', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('B','B6 coordenadas invalidas rechazadas', SQLERRM LIKE '%INVALID_BOOKING_COORDINATES%', SQLERRM); END $t$;

-- ============================================================================
-- C · QUOTE por km
-- ============================================================================
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000009','22222222-2222-2222-2222-222222222222',
 '{"lat":41.6465,"lng":2.7416,"name":"Malgrat"}','{"lat":41.6987,"lng":2.8475,"name":"Lloret"}',
 now()+interval '3 days', 2.64, 4, 10.5, 'scheduled');
SET sw.uid = '33333333-3333-3333-3333-333333333333';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.quote_ride_booking('aaa00000-0000-4000-8000-000000000009','{"lat":41.6465,"lng":2.7416}'::jsonb,'{"lat":41.6987,"lng":2.8475}'::jsonb,1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C1 quote trayecto completo = precio viaje', (v->>'total')::numeric = 2.64, 'total='||(v->>'total'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C1 quote trayecto completo = precio viaje', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.quote_ride_booking('aaa00000-0000-4000-8000-000000000009','{"lat":41.6465,"lng":2.7416}'::jsonb,'{"lat":41.66,"lng":2.75}'::jsonb,1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C2 quote trayecto corto recalcula', (v->>'total')::numeric < 2.64, 'total='||(v->>'total')||' km='||(v->>'passenger_distance_km'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C2 quote trayecto corto recalcula', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.quote_ride_booking('aaa00000-0000-4000-8000-000000000009','{"lat":42.10,"lng":2.90}'::jsonb,'{"lat":42.12,"lng":2.95}'::jsonb,1);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C3 recogida >3km suplemento 1.50', (v->>'pickup_supplement_per_seat')::numeric = 1.50, 'sup='||(v->>'pickup_supplement_per_seat'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C3 recogida >3km suplemento 1.50', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  v := public.quote_ride_booking('aaa00000-0000-4000-8000-000000000009','{"lat":41.70,"lng":2.85}'::jsonb,'{"lat":41.6987,"lng":2.8475}'::jsonb,3);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C4 quote multiplica por plazas', (v->>'total')::numeric = round((v->>'price_per_seat')::numeric*3,2), 'total='||(v->>'total'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('C','C4 quote multiplica por plazas', false, SQLERRM); END $t$;

-- ============================================================================
-- D · CANCELACION PASAJERO (100/50/0)
-- ============================================================================
UPDATE wallets SET balance=100, held_balance=0 WHERE user_id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '3 days', 2.64, 1, 10.5, 'scheduled');
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000002',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  v := public.cancel_booking_and_refund('aaa00000-0000-4000-8000-000000000002');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D1 cancelar >24h devuelve 100%',
    (v->>'refunded')::numeric = 2.64 AND (SELECT held_balance FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111')=0,
    'refunded='||(v->>'refunded'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D1 cancelar >24h devuelve 100%', false, SQLERRM); END $t$;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000003','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '5 hours', 2.64, 1, 10.5, 'scheduled');
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000003',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  v := public.cancel_booking_and_refund('aaa00000-0000-4000-8000-000000000003');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D2 cancelar 2-24h devuelve 50%',
    (v->>'refunded')::numeric = 1.32 AND (SELECT held_balance FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111')=0,
    'refunded='||(v->>'refunded'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D2 cancelar 2-24h devuelve 50%', false, SQLERRM); END $t$;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000004','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '1 hour', 2.64, 1, 10.5, 'scheduled');
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000004',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  v := public.cancel_booking_and_refund('aaa00000-0000-4000-8000-000000000004');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D3 cancelar <2h devuelve 0%',
    (v->>'refunded')::numeric = 0 AND (SELECT held_balance FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111')=0,
    'refunded='||(v->>'refunded'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D3 cancelar <2h devuelve 0%', false, SQLERRM); END $t$;

DO $t$ DECLARE v JSONB; BEGIN
  v := public.cancel_booking_and_refund('aaa00000-0000-4000-8000-000000000004');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D4 reintento cancelacion idempotente',
    (v->>'already_cancelled')::boolean IS TRUE OR (v->>'success')::boolean IS TRUE, v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('D','D4 reintento cancelacion idempotente', false, SQLERRM); END $t$;

-- ============================================================================
-- E · CANCELACION CONDUCTOR
-- ============================================================================
UPDATE wallets SET balance=100, held_balance=0 WHERE user_id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000005','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '1 hour', 2.64, 1, 10.5, 'scheduled');
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000005',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.cancel_ride('aaa00000-0000-4000-8000-000000000005');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E1 cancela <2h: multa 5 y compensa 2.50',
    (v->>'penalty_applied')::numeric = 5.00 AND (v->>'passenger_compensation')::numeric = 2.50
    AND (v->>'refunded_total')::numeric = 2.64,
    'penalty='||(v->>'penalty_applied')||' comp='||(v->>'passenger_compensation')||' reembolso='||(v->>'refunded_total'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E1 cancela <2h: multa 5 y compensa 2.50', false, SQLERRM); END $t$;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000006','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '5 hours', 2.64, 1, 10.5, 'scheduled');
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  v := public.confirm_trip_and_pay(p_ride_id:='aaa00000-0000-4000-8000-000000000006',
    p_pickup_location:='{"lat":41.65,"lng":2.7}'::jsonb, p_dropoff_location:='{"lat":41.7,"lng":2.8}'::jsonb, p_num_seats:=1);
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.cancel_ride('aaa00000-0000-4000-8000-000000000006');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E2 cancela 2-24h: multa 2', (v->>'penalty_applied')::numeric = 2.00, 'penalty='||(v->>'penalty_applied'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E2 cancela 2-24h: multa 2', false, SQLERRM); END $t$;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000007','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '1 hour', 2.64, 4, 10.5, 'scheduled');
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.cancel_ride('aaa00000-0000-4000-8000-000000000007');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E3 sin pasajeros: sin multa', (v->>'penalty_applied')::numeric = 0, 'penalty='||(v->>'penalty_applied'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E3 sin pasajeros: sin multa', false, SQLERRM); END $t$;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('aaa00000-0000-4000-8000-000000000010','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '1 hour', 2.64, 4, 10.5, 'scheduled');
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '33333333-3333-3333-3333-333333333333';
  v := public.cancel_ride('aaa00000-0000-4000-8000-000000000010');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E4 no-conductor no cancela', (v->>'error') = 'NOT_THE_DRIVER', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('E','E4 no-conductor no cancela', SQLERRM LIKE '%NOT_THE_DRIVER%', SQLERRM); END $t$;

-- ============================================================================
-- F · PIN, ABORDAJE, LIQUIDACION
-- ============================================================================
UPDATE wallets SET balance=100, held_balance=0 WHERE user_id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
UPDATE wallets SET balance=100, held_balance=0 WHERE user_id='33333333-3333-3333-3333-333333333333';
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status, started_at)
VALUES ('aaa00000-0000-4000-8000-000000000008','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '10 minutes', 2.64, 0, 10.5, 'active', now());
UPDATE rides SET passengers = '[
  {"id":"11111111-1111-1111-1111-111111111111","status":"verified","seats":2,"booked_price":2.64,"pin":"1111","payment_status":"held"},
  {"id":"33333333-3333-3333-3333-333333333333","status":"confirmed","seats":1,"booked_price":2.64,"pin":"2222","payment_status":"held"}]'::jsonb
WHERE id='aaa00000-0000-4000-8000-000000000008';
UPDATE wallets SET balance=100, held_balance=5.28 WHERE user_id='11111111-1111-1111-1111-111111111111';
UPDATE wallets SET balance=100, held_balance=2.64 WHERE user_id='33333333-3333-3333-3333-333333333333';

DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.complete_passenger_dropoff('aaa00000-0000-4000-8000-000000000008','11111111-1111-1111-1111-111111111111');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F1 dropoff 2 plazas cobra 90% total',
    (v->>'driver_payout')::numeric = 4.75 AND (SELECT held_balance FROM wallets WHERE user_id='11111111-1111-1111-1111-111111111111')=0,
    'payout='||(v->>'driver_payout'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F1 dropoff 2 plazas cobra 90% total', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.complete_passenger_dropoff('aaa00000-0000-4000-8000-000000000008','11111111-1111-1111-1111-111111111111');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F2 dropoff repetido idempotente', (v->>'already_settled')::boolean IS TRUE, v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F2 dropoff repetido idempotente', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; b NUMERIC; BEGIN
  SELECT balance INTO b FROM wallets WHERE user_id='22222222-2222-2222-2222-222222222222';
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.complete_ride('aaa00000-0000-4000-8000-000000000008');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F3 no verificada reembolsada, sin doble pago',
    (SELECT balance FROM wallets WHERE user_id='22222222-2222-2222-2222-222222222222') = b
    AND (SELECT held_balance FROM wallets WHERE user_id='33333333-3333-3333-3333-333333333333') = 0
    AND (v->>'already_settled_passengers')::int = 1,
    'conductor='||(SELECT balance FROM wallets WHERE user_id='22222222-2222-2222-2222-222222222222'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F3 no verificada reembolsada, sin doble pago', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.complete_ride('aaa00000-0000-4000-8000-000000000008');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F4 finalizar 2 veces rechazado', (v->>'success')::boolean IS NOT TRUE, (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F4 finalizar 2 veces rechazado', SQLERRM ILIKE '%Solo se puede completar%', SQLERRM); END $t$;
INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status, started_at, passengers)
VALUES ('aaa00000-0000-4000-8000-000000000011','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb, now()+interval '10 minutes', 2.64, 3, 10.5, 'active', now(),
 '[{"id":"11111111-1111-1111-1111-111111111111","status":"confirmed","seats":1,"booked_price":2.64,"pin":"3333","payment_status":"held"}]'::jsonb);
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.verify_passenger_boarding('aaa00000-0000-4000-8000-000000000011','9999',NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F5 PIN incorrecto no verifica', (v->>'success')::boolean IS NOT TRUE, (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('F','F5 PIN incorrecto no verifica', false, SQLERRM); END $t$;

-- ============================================================================
-- G · VALORACIONES
-- ============================================================================
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  v := public.submit_review_v2('aaa00000-0000-4000-8000-000000000008','22222222-2222-2222-2222-222222222222',5,'');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G1 valorar tras completado', (v->>'success')::boolean IS TRUE, v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G1 valorar tras completado', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  v := public.submit_review_v2('aaa00000-0000-4000-8000-000000000008','22222222-2222-2222-2222-222222222222',3,'otra');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G2 valoracion duplicada rechazada', (v->>'error') = 'ALREADY_REVIEWED', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G2 valoracion duplicada rechazada', SQLERRM LIKE '%ALREADY_REVIEWED%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.submit_review_v2('aaa00000-0000-4000-8000-000000000008','22222222-2222-2222-2222-222222222222',5,'yo');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G3 auto-valoracion rechazada', (v->>'error') = 'SELF_REVIEW_NOT_ALLOWED', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G3 auto-valoracion rechazada', SQLERRM LIKE '%SELF_REVIEW%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  v := public.submit_review_v2('aaa00000-0000-4000-8000-000000000008','33333333-3333-3333-3333-333333333333',4,'compañera');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G4 valorar a otra pasajera del viaje', (v->>'success')::boolean IS TRUE, v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G4 valorar a otra pasajera del viaje', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  v := public.submit_review_v2('aaa00000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222',5,'viaje abierto');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G5 valorar viaje no completado rechazada', (v->>'error') = 'RIDE_NOT_COMPLETED', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('G','G5 valorar viaje no completado rechazada', SQLERRM LIKE '%RIDE_NOT_COMPLETED%', SQLERRM); END $t$;

-- ============================================================================
-- H · SOLICITAR PLAZA
-- ============================================================================
SET sw.uid = '33333333-3333-3333-3333-333333333333';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride_request('{"lat":41.65,"lng":2.7,"name":"Malgrat"}'::jsonb,'{"lat":41.7,"lng":2.8,"name":"Lloret"}'::jsonb,
    now()+interval '2 days', 2, 2.64, 'TestH', false, 10.5, '');
  UPDATE ride_requests SET id='bbb00000-0000-4000-8000-000000000001' WHERE requester_id='33333333-3333-3333-3333-333333333333' AND status='pending';
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H1 crear solicitud', (v->>'success')::boolean IS TRUE, v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H1 crear solicitud', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '44444444-4444-4444-4444-444444444444';
  v := public.create_ride_request('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb,
    now()+interval '2 days', 1, 2.64, 'SinDinero', false, 10.5, '');
  UPDATE ride_requests SET id='bbb00000-0000-4000-8000-000000000008' WHERE requester_id='44444444-4444-4444-4444-444444444444' AND status='pending' AND note='SinDinero';
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000008',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H2 solicitante sin saldo rechazado', (v->>'error') LIKE '%INSUFFICIENT%', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H2 solicitante sin saldo rechazado', SQLERRM LIKE '%INSUFFICIENT%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '33333333-3333-3333-3333-333333333333';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000001',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H3 propia solicitud rechazada', (v->>'error') = 'CANNOT_FULFILL_OWN_REQUEST', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H3 propia solicitud rechazada', SQLERRM LIKE '%CANNOT_FULFILL_OWN%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000001',NULL,NULL,NULL,4,4.00,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H4 precio fuera de banda rechazado', (v->>'error') = 'INVALID_PRICE', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H4 precio fuera de banda rechazado', SQLERRM LIKE '%INVALID_PRICE%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000001',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000001',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H5 doble aceptacion rechazada', (v->>'error') = 'REQUEST_NOT_AVAILABLE', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H5 doble aceptacion rechazada', SQLERRM LIKE '%REQUEST_NOT_AVAILABLE%', SQLERRM); END $t$;
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride_request('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb,
    now()+interval '2 days', 1, 2.64, 'SoloChicas', true, 10.5, '');
  UPDATE ride_requests SET id='bbb00000-0000-4000-8000-000000000002' WHERE requester_id='11111111-1111-1111-1111-111111111111' AND status='pending' AND is_women_only;
  SET sw.uid = '22222222-2222-2222-2222-222222222222';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000002',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H6 women-only bloquea hombre', (v->>'error') = 'WOMEN_ONLY_REQUEST', (v->>'error'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H6 women-only bloquea hombre', SQLERRM LIKE '%WOMEN_ONLY%', SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '33333333-3333-3333-3333-333333333333';
  v := public.fulfill_ride_request('bbb00000-0000-4000-8000-000000000002',NULL,NULL,NULL,4,2.64,NULL,NULL,NULL,NULL);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H7 conductora acepta women-only', (v->>'success')::boolean IS TRUE, 'pin='||(v->>'pin'));
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H7 conductora acepta women-only', false, SQLERRM); END $t$;
DO $t$ DECLARE n INTEGER; BEGIN
  INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, status)
  VALUES ('bbb00000-0000-4000-8000-000000000003','11111111-1111-1111-1111-111111111111',
    '{"lat":41.65,"lng":2.7}','{"lat":41.7,"lng":2.8}', now()-interval '5 hours', 1, 2.64, 'pending');
  n := public.sw_expire_past_ride_requests(120, 100);
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H8 solicitud caducada expira',
    (SELECT status FROM ride_requests WHERE id='bbb00000-0000-4000-8000-000000000003') = 'expired', 'expiradas='||n);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H8 solicitud caducada expira', false, SQLERRM); END $t$;
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE v JSONB; BEGIN
  v := public.create_ride_request('{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}'::jsonb,
    now()+interval '2 days', 1, 2.64, 'ParaCancelar', false, 10.5, '');
  UPDATE ride_requests SET id='bbb00000-0000-4000-8000-000000000004' WHERE requester_id='11111111-1111-1111-1111-111111111111' AND status='pending' AND note='ParaCancelar';
  v := public.cancel_ride_request('bbb00000-0000-4000-8000-000000000004');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H9 cancelar solicitud propia',
    (v->>'success')::boolean IS TRUE AND (SELECT status FROM ride_requests WHERE id='bbb00000-0000-4000-8000-000000000004')='cancelled', v::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H9 cancelar solicitud propia', false, SQLERRM); END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  SET sw.uid = '44444444-4444-4444-4444-444444444444';
  v := public.cancel_ride_request('bbb00000-0000-4000-8000-000000000004');
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H10 otro no cancela tu solicitud', false, 'NO rechazo');
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('H','H10 otro no cancela tu solicitud', SQLERRM ILIKE '%permiso%', SQLERRM); END $t$;

-- ============================================================================
-- I · RADAR
-- ============================================================================
DO $t$ DECLARE n INTEGER; BEGIN
  INSERT INTO driver_radar_preferences (user_id, enabled, radius_km, latitude, longitude, last_seen_at)
  VALUES ('22222222-2222-2222-2222-222222222222', true, 10, 41.65, 2.74, now())
  ON CONFLICT (user_id) DO UPDATE SET enabled=true, latitude=41.65, longitude=2.74, last_seen_at=now();
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, status)
  VALUES ('bbb00000-0000-4000-8000-000000000005','11111111-1111-1111-1111-111111111111',
    '{"lat":41.651,"lng":2.741,"name":"Malgrat"}','{"lat":41.7,"lng":2.8}', now()+interval '2 days', 1, 2.64, 'pending');
  SELECT count(*) INTO n FROM ride_request_radar_deliveries WHERE request_id='bbb00000-0000-4000-8000-000000000005';
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I1 radar detecta cercana', n = 1, 'entregas='||n);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I1 radar detecta cercana', false, SQLERRM); END $t$;
DO $t$ DECLARE n INTEGER; BEGIN
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, status)
  VALUES ('bbb00000-0000-4000-8000-000000000006','11111111-1111-1111-1111-111111111111',
    '{"lat":41.65,"lng":-0.88,"name":"Zaragoza"}','{"lat":41.7,"lng":2.8}', now()+interval '2 days', 1, 2.64, 'pending');
  SELECT count(*) INTO n FROM ride_request_radar_deliveries WHERE request_id='bbb00000-0000-4000-8000-000000000006';
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I2 radar ignora lejana', n = 0, 'entregas='||n);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I2 radar ignora lejana', false, SQLERRM); END $t$;
DO $t$ DECLARE n INTEGER; BEGIN
  INSERT INTO passenger_radar_preferences (user_id, enabled, radius_km, latitude, longitude, last_seen_at)
  VALUES ('11111111-1111-1111-1111-111111111111', true, 10, 41.65, 2.74, now())
  ON CONFLICT (user_id) DO UPDATE SET enabled=true, last_seen_at=now();
  SET sw.uid = '11111111-1111-1111-1111-111111111111';
  INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, status)
  VALUES ('bbb00000-0000-4000-8000-000000000007','11111111-1111-1111-1111-111111111111',
    '{"lat":41.652,"lng":2.742,"name":"Malgrat"}','{"lat":41.7,"lng":2.8}', now()+interval '2 days', 1, 2.64, 'pending');
  SELECT count(*) INTO n FROM notifications WHERE entity_id='bbb00000-0000-4000-8000-000000000007' AND user_id='11111111-1111-1111-1111-111111111111';
  INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I3 sin auto-notificacion', n = 0, 'notifs='||n);
EXCEPTION WHEN OTHERS THEN INSERT INTO test_results (bloque, escenario, ok, detalle) VALUES ('I','I3 sin auto-notificacion', false, SQLERRM); END $t$;

-- ============================================================================
SELECT bloque, escenario, CASE WHEN ok THEN '✓ PASS' ELSE '✗ FAIL' END AS resultado, detalle
FROM test_results ORDER BY n;
SELECT 'TOTAL: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' PASS' AS resumen,
       string_agg(CASE WHEN NOT ok THEN escenario END, ' | ') AS fallos
FROM test_results;
