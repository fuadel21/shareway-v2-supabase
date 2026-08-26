-- Card booking upserts ride_requests without departure_time on the live
-- Edge Function. A table trigger copies it from the parent ride so Stripe
-- prepare no longer fails with "La solicitud necesita fecha y hora de salida".

CREATE OR REPLACE FUNCTION public.fill_ride_request_departure_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_from_ride timestamptz;
BEGIN
    IF NEW.departure_time IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.ride_id IS NOT NULL THEN
        SELECT r.departure_time
          INTO v_from_ride
        FROM public.rides r
        WHERE r.id = NEW.ride_id;

        IF v_from_ride IS NOT NULL THEN
            NEW.departure_time := v_from_ride;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_fill_ride_request_departure_time ON public.ride_requests;

CREATE TRIGGER aa_fill_ride_request_departure_time
BEFORE INSERT OR UPDATE ON public.ride_requests
FOR EACH ROW
EXECUTE FUNCTION public.fill_ride_request_departure_time();

UPDATE public.ride_requests rr
SET departure_time = r.departure_time
FROM public.rides r
WHERE rr.ride_id = r.id
  AND rr.departure_time IS NULL
  AND r.departure_time IS NOT NULL;

COMMENT ON FUNCTION public.fill_ride_request_departure_time() IS
    'Copies rides.departure_time onto ride_requests when a booking row is inserted without a schedule.';
