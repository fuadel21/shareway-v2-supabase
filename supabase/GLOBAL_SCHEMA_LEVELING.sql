-- ========================================================
-- MIGRACIÓN: GLOBAL SCHEMA LEVELING
-- Objetivo: Sincronizar TODAS las columnas que el Frontend espera
-- Nivel: Principal Engineer / Auditoría Preventiva
-- ========================================================

DO $$ 
BEGIN 
    -- 1. Tabla PROFILES (Asegurar estadísticas)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rides_count') THEN
        ALTER TABLE public.profiles ADD COLUMN rides_count INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='total_co2_saved') THEN
        ALTER TABLE public.profiles ADD COLUMN total_co2_saved DECIMAL DEFAULT 0;
    END IF;

    -- 2. Tabla RIDES (Asegurar integridad de datos de ruta)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='co2_saved') THEN
        ALTER TABLE public.rides ADD COLUMN co2_saved DECIMAL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='distance') THEN
        ALTER TABLE public.rides ADD COLUMN distance NUMERIC DEFAULT 0;
    END IF;

    -- 3. Tabla TRANSACTIONS (Asegurar campos de auditoría)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='balance_after') THEN
        ALTER TABLE public.transactions ADD COLUMN balance_after DECIMAL DEFAULT 0;
    END IF;

END $$;

-- 4. ÍNDICES DE RENDIMIENTO (Preventivo para MyRides)
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON public.rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_participant_ids ON public.rides USING GIN (participant_ids);
