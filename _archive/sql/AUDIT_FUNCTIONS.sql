-- Audit script to find all notification and ride-related functions
SELECT n.nspname as schema,
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    p.prosrc as source_code
FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname IN ('create_notification', 'start_ride')
    AND n.nspname = 'public';