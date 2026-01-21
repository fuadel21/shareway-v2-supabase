-- ==============================================================================
-- MONITOR DE SALUD Y OPERACIONES - SHAREWAY V2
-- ==============================================================================
-- Ejecuta este script en Supabase SQL Editor para crear vistas de monitoreo.
-- Luego podrás consultar estas vistas desde tu panel de admin o SQL Editor.
-- ==============================================================================
-- 1. DASHBOARD GENERAL DE SALUD
-- Muestra contadores clave de actividad y errores en tiempo real.
CREATE OR REPLACE VIEW internal_health_dashboard AS
SELECT NOW() as check_time,
    (
        SELECT count(*)
        FROM public.rpc_error_logs
        WHERE created_at > now() - interval '1 hour'
    ) as errors_last_hour,
    (
        SELECT count(*)
        FROM public.rpc_error_logs
        WHERE created_at > now() - interval '24 hours'
    ) as errors_last_24h,
    (
        SELECT count(*)
        FROM public.rides
        WHERE status = 'active'
    ) as active_rides_now,
    (
        SELECT count(*)
        FROM public.transactions
        WHERE created_at > now() - interval '24 hours'
    ) as tx_last_24h,
    (
        SELECT coalesce(sum(amount), 0)
        FROM public.transactions
        WHERE type = 'payout'
            AND created_at > now() - interval '24 hours'
    ) as payout_vol_24h;
-- 2. ERRORES CRÍTICOS (Últimos 50)
-- Para diagnóstico rápido de problemas.
CREATE OR REPLACE VIEW internal_error_monitor AS
SELECT created_at,
    function_name,
    left(error_message, 100) as short_error,
    -- Truncado para facilitar lectura
    user_id
FROM public.rpc_error_logs
ORDER BY created_at DESC
LIMIT 50;
-- 3. INTEGRIDAD FINANCIERA
-- Detecta wallets corruptas (saldos negativos) - ¡DEBERÍA ESTAR VACÍO!
CREATE OR REPLACE VIEW internal_financial_alerts AS
SELECT user_id,
    balance,
    held_balance,
    updated_at
FROM public.wallets
WHERE balance < -0.01
    OR held_balance < -0.01;
-- Pequeña tolerancia por punto flotante si hubiese, aunque es numeric
-- 4. VIAJES "ZOMBIES" (Stuck Rides)
-- Viajes que llevan activos más de 24h y probablemente se olvidó cerrar.
CREATE OR REPLACE VIEW internal_stuck_rides AS
SELECT id,
    driver_id,
    started_at,
    now() - started_at as duration
FROM public.rides
WHERE status = 'active'
    AND started_at < now() - interval '24 hours';
-- 5. USUARIOS SOSPECHOSOS (Posible fraude)
-- Usuarios que han creado muchos requests de viaje en poco tiempo.
CREATE OR REPLACE VIEW internal_sus_activity AS
SELECT requester_id as passenger_id,
    -- Alias para claridad
    count(*) as requests_last_hour
FROM public.ride_requests
WHERE created_at > now() - interval '1 hour'
GROUP BY requester_id
HAVING count(*) > 10;
-- Umbral de alerta
-- Comentarios para documentación
COMMENT ON VIEW internal_health_dashboard IS 'Resumen ejecutivo de la salud del sistema';
COMMENT ON VIEW internal_error_monitor IS 'Log de errores recientes para debugging';
COMMENT ON VIEW internal_financial_alerts IS 'ALERTA ROJA: Wallets con saldo negativo';
COMMENT ON VIEW internal_stuck_rides IS 'Viajes que deben ser cerrados administrativamente';