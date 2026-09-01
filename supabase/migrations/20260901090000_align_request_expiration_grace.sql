-- Keep server-side request expiration aligned with the client filters.
-- The UI uses a 120-minute grace period after departure; the older automation
-- defaulted to 60 minutes and the cron job called that shorter value directly.

CREATE OR REPLACE FUNCTION public.sw_expire_old_requests()
RETURNS integer
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.sw_expire_past_ride_requests(120, 100);
$$;

GRANT EXECUTE
ON FUNCTION public.sw_expire_old_requests()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.sw_expire_old_requests()
TO anon;

-- Replace the existing schedule when pg_cron is available. This is safe on
-- projects where pg_cron is not installed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'cron'
    ) THEN
        PERFORM cron.unschedule('shareway_expire_past_ride_requests');
        PERFORM cron.schedule(
            'shareway_expire_past_ride_requests',
            '*/15 * * * *',
            'SELECT public.sw_expire_past_ride_requests(120, 100);'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[expire_requests] cron schedule skipped: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
