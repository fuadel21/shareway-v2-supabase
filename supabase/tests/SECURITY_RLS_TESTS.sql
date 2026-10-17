-- ============================================================================
-- SHAREWAY · TESTS DE SEGURIDAD RLS (aislamiento entre usuarios)
-- ============================================================================
-- Verifica a nivel de POLITICAS que un usuario autenticado no puede:
--   S1. Ver solicitudes ajenas cerradas (canceladas/fulfilled) fuera del mercado
--   S2. Tocar carteras de otros (update/delete)
--   S3. Leer payment_intents de otros
--   S4. Ver reseñas... (publicas por diseno, solo lectura)
--   S5. Las funciones financieras rechazan rol authenticated (solo service_role)
-- NOTA: se ejecuta con SET ROLE authenticated para evaluar las politicas
-- reales (no security definer).
-- ============================================================================

CREATE TEMP TABLE sec_results (n SERIAL, escenario TEXT, ok BOOLEAN, detalle TEXT);
\set QUIET on

-- GRANTs como Supabase production (authenticated tiene acceso a tablas public)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT ALL ON sec_results TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pg_temp TO authenticated;
-- Excepcion de seguridad: settle solo service_role (como en prod)
REVOKE EXECUTE ON FUNCTION public.settle_wallet_deposit(TEXT, NUMERIC, TEXT) FROM authenticated;

-- Limpieza y personas
DELETE FROM payment_intents WHERE external_id LIKE 'pi_sec_%';
DELETE FROM transactions WHERE description LIKE '%SEC%';
DELETE FROM ride_requests WHERE note LIKE 'SEC%';
DELETE FROM rides WHERE id::text LIKE 'ddd%';
INSERT INTO profiles (id, display_name, gender) VALUES
 ('22222222-2222-2222-2222-222222222222','Bruno','male'),
 ('11111111-1111-1111-1111-111111111111','Ana','female')
ON CONFLICT DO NOTHING;
INSERT INTO wallets (user_id, balance, held_balance) VALUES
 ('22222222-2222-2222-2222-222222222222', 50, 0),
 ('11111111-1111-1111-1111-111111111111', 50, 0)
ON CONFLICT (user_id) DO UPDATE SET balance = 50, held_balance = 0;

INSERT INTO rides (id, driver_id, origin, destination, departure_time, price, seats_available, distance, status)
VALUES ('ddd00000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}', now()+interval '3 days', 2.64, 4, 10.5, 'scheduled');
INSERT INTO ride_requests (id, requester_id, origin, destination, departure_time, seats_needed, suggested_price, note, status)
VALUES ('ddd00000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222',
 '{"lat":41.65,"lng":2.7}'::jsonb,'{"lat":41.7,"lng":2.8}', now()+interval '2 days', 1, 2.64, 'SEC-cancelada-ajena', 'cancelled');
INSERT INTO payment_intents (user_id, amount, currency, status, provider, external_id)
VALUES ('22222222-2222-2222-2222-222222222222', 10, 'EUR', 'pending', 'stripe', 'pi_sec_bruno');

-- ============================================================================
-- S1: Ana no ve la solicitud CANCELADA de Bruno (mercado abierto = solo pendientes)
-- ============================================================================
SET ROLE authenticated;
SET sw.uid = '11111111-1111-1111-1111-111111111111';
DO $t$ DECLARE n INTEGER; BEGIN
  SELECT count(*) INTO n FROM ride_requests WHERE id='ddd00000-0000-4000-8000-000000000002';
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S1 no ve solicitudes cerradas ajenas', n = 0, 'vistas='||n);
END $t$;

-- S2: Ana no puede modificar la cartera de Bruno
DO $t$ DECLARE n INTEGER; BEGIN
  UPDATE wallets SET balance = 999999 WHERE user_id='22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S2 no modifica cartera ajena', n = 0, 'filas='||n);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S2 no modifica cartera ajena', true, 'bloqueado: '||SQLERRM);
END $t$;

-- S3: Ana no ve los payment_intents de Bruno
DO $t$ DECLARE n INTEGER; BEGIN
  SELECT count(*) INTO n FROM payment_intents WHERE external_id='pi_sec_bruno';
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S3 no lee intents ajenos', n = 0, 'vistos='||n);
END $t$;

-- S4: Ana no puede borrar el viaje de Bruno (sin politica de DELETE)
DO $t$ DECLARE n INTEGER; BEGIN
  DELETE FROM rides WHERE id='ddd00000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S4 no borra viajes ajenos', n = 0, 'borrados='||n);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S4 no borra viajes ajenos', true, 'bloqueado');
END $t$;

-- S5: funciones financieras rechazan rol authenticated
DO $t$ DECLARE v JSONB; BEGIN
  BEGIN
    v := public.settle_wallet_deposit('pi_sec_bruno', 10.00, NULL);
    INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S5 settle rechaza authenticated',
      (v->>'error') = 'SERVICE_ROLE_REQUIRED', (v->>'error'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S5 settle rechaza authenticated', true, 'denegado: '||SQLERRM);
  END;
END $t$;
DO $t$ DECLARE v JSONB; BEGIN
  BEGIN
    v := public.transition_financial_status('pi_sec_bruno', 'captured', '{}'::jsonb);
    INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S5b transition rechaza authenticated',
      (v->>'error') = 'SERVICE_ROLE_REQUIRED', (v->>'error'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S5b transition rechaza authenticated', true, 'denegado: '||SQLERRM);
  END;
END $t$;

-- S6: Ana SI ve el viaje publicado de Bruno (mercado abierto de rides)
DO $t$ DECLARE n INTEGER; BEGIN
  SELECT count(*) INTO n FROM rides WHERE id='ddd00000-0000-4000-8000-000000000001';
  INSERT INTO sec_results (escenario, ok, detalle) VALUES ('S6 si ve viajes publicados', n = 1, 'vistos='||n);
END $t$;

RESET ROLE;

SELECT escenario, CASE WHEN ok THEN '✓ PASS' ELSE '✗ FAIL' END AS resultado, detalle
FROM sec_results ORDER BY n;
