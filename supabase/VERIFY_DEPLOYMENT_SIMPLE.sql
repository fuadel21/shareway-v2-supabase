-- ==========================================
-- ESSENTIAL VERIFICATION QUERIES ONLY
-- ==========================================
-- 1. Verificar columna waypoints
SELECT column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'rides'
    AND column_name = 'waypoints';
-- 2. Verificar todos los RPCs críticos (debe retornar 13 filas)
SELECT routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND routine_name IN (
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
ORDER BY routine_name;
-- 3. Contar RPCs (debe retornar 13)
SELECT COUNT(*) as total_rpcs
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND routine_name IN (
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
-- 4. Verificar parámetros de search_rides_secure (debe retornar 6 parámetros)
SELECT parameter_name,
    data_type,
    ordinal_position
FROM information_schema.parameters
WHERE routine_name = 'search_rides_secure'
    AND routine_schema = 'public'
ORDER BY ordinal_position;
-- 5. Verificar integridad financiera actual
SELECT COUNT(*) as total_wallets,
    SUM(balance) as total_balance,
    SUM(held_balance) as total_held,
    SUM(balance + held_balance) as total_system_money
FROM public.wallets;