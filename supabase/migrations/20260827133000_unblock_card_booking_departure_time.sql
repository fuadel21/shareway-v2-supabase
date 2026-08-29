-- Card booking still failed after fill-on-insert because another BEFORE trigger
-- (alphabetically earlier) raised "La solicitud necesita fecha y hora de salida"
-- while departure_time was still null. Fill first, then drop those raisers.

CREATE OR REPLACE FUNCTION public.fill_ride_request_departure_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ride_id uuid;
    v_from_ride timestamptz;
BEGIN
    v_ride_id := COALESCE(NEW.ride_id, NULLIF(NEW.matched_ride_id, NULL));

    BEGIN
        v_ride_id := COALESCE(v_ride_id, NULLIF(to_jsonb(NEW)->>'ride_id', '')::uuid);
    EXCEPTION WHEN others THEN
        NULL;
    END;

    IF NEW.departure_time IS NULL AND v_ride_id IS NOT NULL THEN
        SELECT COALESCE(r.departure_time, r.date_time)
          INTO v_from_ride
        FROM public.rides r
        WHERE r.id = v_ride_id;

        IF v_from_ride IS NOT NULL THEN
            NEW.departure_time := v_from_ride;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_fill_ride_request_departure_time ON public.ride_requests;
DROP TRIGGER IF EXISTS "000_fill_ride_request_departure_time" ON public.ride_requests;

CREATE TRIGGER "000_fill_ride_request_departure_time"
BEFORE INSERT OR UPDATE ON public.ride_requests
FOR EACH ROW
EXECUTE FUNCTION public.fill_ride_request_departure_time();

DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'ride_requests'
          AND NOT t.tgisinternal
          AND t.tgname IS DISTINCT FROM '000_fill_ride_request_departure_time'
          AND (
            p.prosrc ILIKE '%necesita fecha y hora de salida%'
            OR p.prosrc ILIKE '%solicitud necesita fecha%'
          )
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.ride_requests', rec.tgname);
        RAISE NOTICE 'Dropped blocking trigger %', rec.tgname;
    END LOOP;
END $$;

UPDATE public.ride_requests rr
SET departure_time = COALESCE(r.departure_time, rr.departure_time)
FROM public.rides r
WHERE rr.ride_id = r.id
  AND rr.departure_time IS NULL
  AND r.departure_time IS NOT NULL;
