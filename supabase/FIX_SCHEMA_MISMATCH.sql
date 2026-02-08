-- ========================================================
-- MIGRACIÓN: FIX SCHEMA MISMATCH
-- Objetivo: Añadir columnas faltantes detectadas en rpc_error_logs
-- ========================================================

DO $$ 
BEGIN 
    -- 1. Asegurar columna payment_expires_at en ride_requests (si no existe)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='payment_expires_at') THEN
        ALTER TABLE public.ride_requests ADD COLUMN payment_expires_at TIMESTAMPTZ;
    END IF;

    -- 2. Asegurar que las columnas en rides coincidan con lo que espera el código JS y RPC
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='co2_saved') THEN
        ALTER TABLE public.rides ADD COLUMN co2_saved DECIMAL DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='initial_price') THEN
        ALTER TABLE public.rides ADD COLUMN initial_price NUMERIC(10, 2) DEFAULT 0.00;
    END IF;
END $$;
