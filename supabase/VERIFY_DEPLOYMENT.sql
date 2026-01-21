-- ==========================================
-- VERIFICATION QUERIES - Post Deployment
-- ==========================================
-- 1. Verificar que search_rides_secure existe con la nueva firma
SELECT routine_name,
    data_type,
    parameter_name,
    ordinal_position
FROM information_schema.parameters
WHERE routine_name = 'search_rides_secure'
    AND routine_schema = 'public'
ORDER BY ordinal_position;
-- 2. Verificar columna waypoints
SELECT column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'rides'
    AND column_name = 'waypoints';
-- 3. Verificar todos los RPCs críticos
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
-- 4. Contar cuántos RPCs tenemos en total
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