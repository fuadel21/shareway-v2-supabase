-- Elimina la sobrecarga confirm_trip_and_pay(uuid) si existe junto a la firma canónica
-- (uuid + opcionales con DEFAULT). PostgREST / supabase-js a veces envían solo p_ride_id
-- y PostgreSQL no puede resolver entre las dos.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'confirm_trip_and_pay'
          AND n.nspname = 'public'
          AND p.pronargs = 1
    LOOP
        EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
    END LOOP;
END $$;
