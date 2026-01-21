-- ==========================================
-- VERIFICACIÓN COMPATIBLE CON TODAS LAS VERSIONES DE POSTGRESQL
-- ==========================================
-- 1. Verificar columna waypoints
SELECT column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'rides'
    AND column_name = 'waypoints';
-- 2. Verificar RPCs usando pg_proc (más compatible)
SELECT p.proname as function_name,
    pg_catalog.pg_get_function_result(p.oid) as return_type
FROM pg_catalog.pg_proc p
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
    AND p.proname IN (
        'create_ride',
        'confirm_trip_and_pay',
        'start_ride',
        'verify_passenger',
        'complete_ride',
        'update_ride_location',
        'get_my_ride_pin',
        'cancel_ride',
        'create_payout_request',
        'get_user_rides',
        'cancel_booking_and_refund',
        'search_rides_secure',
        'fulfill_ride_request'
    )
ORDER BY p.proname;
-- 3. Contar RPCs
SELECT COUNT(DISTINCT p.proname) as total_rpcs
FROM pg_catalog.pg_proc p
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
    AND p.proname IN (
        'create_ride',
        'confirm_trip_and_pay',
        'start_ride',
        'verify_passenger',
        'complete_ride',
        'update_ride_location',
        'get_my_ride_pin',
        'cancel_ride',
        'create_payout_request',
        'get_user_rides',
        'cancel_booking_and_refund',
        'search_rides_secure',
        'fulfill_ride_request'
    );
-- 4. Verificar search_rides_secure específicamente
SELECT p.proname as function_name,
    pg_catalog.pg_get_function_arguments(p.oid) as parameters,
    pg_catalog.pg_get_function_result(p.oid) as return_type
FROM pg_catalog.pg_proc p
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
    AND p.proname = 'search_rides_secure';
-- 5. Verificar integridad financiera
SELECT COUNT(*) as total_wallets,
    ROUND(SUM(balance)::numeric, 2) as total_balance,
    ROUND(SUM(held_balance)::numeric, 2) as total_held,
    ROUND(SUM(balance + held_balance)::numeric, 2) as total_system_money
FROM public.wallets;
-- 6. BONUS: Ver últimos errores (si hay)
SELECT function_name,
    error_message,
    created_at
FROM public.rpc_error_logs
ORDER BY created_at DESC
LIMIT 5;