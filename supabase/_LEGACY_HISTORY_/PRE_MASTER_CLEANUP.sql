-- ==========================================
-- CRITICAL FIX: Drop existing search_rides_secure before recreating
-- ==========================================
-- Drop all overloads of search_rides_secure
DROP FUNCTION IF EXISTS public.search_rides_secure(JSONB, JSONB, DATE, INTEGER, DECIMAL, FLOAT);
DROP FUNCTION IF EXISTS public.search_rides_secure(
    JSONB,
    JSONB,
    DATE,
    INTEGER,
    NUMERIC,
    DOUBLE PRECISION
);
-- Now the MASTER_COMPLETE_FINAL.sql can be executed without errors
DO $$
DECLARE stmt TEXT;
BEGIN
  SELECT string_agg('DROP FUNCTION ' || oid::regprocedure || ';', ' ')
    INTO stmt
  FROM pg_proc
  WHERE proname = 'search_rides_secure'
    AND pronamespace = 'public'::regnamespace;
  IF stmt IS NOT NULL THEN
    EXECUTE stmt;
  END IF;
END $$;
