-- ==========================================
-- MIGRACIÓN: FIX BOOKING CONSTRAINTS
-- Objetivo: Asegurar que el upsert de reservas funciona en las Edge Functions
-- ==========================================
DO $$ BEGIN -- 1. Asegurar que existe el constraint UNIQUE(ride_id, requester_id) en ride_requests
-- Esto es necesario para que el upsert con onConflict funcione
IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ride_requests_ride_id_requester_id_key'
) THEN
ALTER TABLE public.ride_requests
ADD CONSTRAINT ride_requests_ride_id_requester_id_key UNIQUE (ride_id, requester_id);
END IF;
END $$;