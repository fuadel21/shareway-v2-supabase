-- ===============================================================
-- REPAIR SCRIPT: Fix 'ride_requests' -> 'profiles' relationship
-- ===============================================================

-- 1. Ensure the foreign key constraint exists or recreate it
DO $$
BEGIN
    -- Try to drop it first if it exists with a wrong name or definition
    BEGIN
        ALTER TABLE public.ride_requests DROP CONSTRAINT IF EXISTS ride_requests_requester_id_fkey;
    EXCEPTION WHEN OTHERS THEN
        -- Ignore if it doesn't exist
    END;

    -- Re-add the constraint explicitly
    ALTER TABLE public.ride_requests
    ADD CONSTRAINT ride_requests_requester_id_fkey
    FOREIGN KEY (requester_id)
    REFERENCES public.profiles(id)
    ON DELETE CASCADE;

    RAISE NOTICE 'Constraint ride_requests_requester_id_fkey has been (re)created.';
END $$;

-- 2. Notify PostgREST to reload the schema cache (standard method)
NOTIFY pgrst, 'reload config';

-- 3. Verify the relationship involves the correct columns
COMMENT ON CONSTRAINT ride_requests_requester_id_fkey ON public.ride_requests IS 'Links requests to the user profile';
