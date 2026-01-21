-- ========================================================
-- SHAREWAY GOLDEN SCHEMA - VERSIÓN DEFINITIVA
-- Nivel: Principal Engineer / Production Ready
-- ========================================================

-- 1. NIVELACIÓN DE TABLAS NÚCLEO
DO $$ BEGIN 
    -- Perfiles
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rides_count') THEN ALTER TABLE public.profiles ADD COLUMN rides_count INTEGER DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='total_co2_saved') THEN ALTER TABLE public.profiles ADD COLUMN total_co2_saved DECIMAL DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='eco_points') THEN ALTER TABLE public.profiles ADD COLUMN eco_points INTEGER DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='stripe_onboarding_complete') THEN ALTER TABLE public.profiles ADD COLUMN stripe_onboarding_complete BOOLEAN DEFAULT FALSE; END IF;

    -- Viajes (Rides)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='co2_saved') THEN ALTER TABLE public.rides ADD COLUMN co2_saved DECIMAL DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='current_location') THEN ALTER TABLE public.rides ADD COLUMN current_location JSONB; END IF;

    -- Solicitudes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='distance') THEN ALTER TABLE public.ride_requests ADD COLUMN distance NUMERIC DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='overview_polyline') THEN ALTER TABLE public.ride_requests ADD COLUMN overview_polyline TEXT DEFAULT ''; END IF;
END $$;

-- 2. INFRAESTRUCTURA DE RENDIMIENTO (Índices)
CREATE INDEX IF NOT EXISTS idx_rides_status_geo ON public.rides(status, departure_time);
CREATE INDEX IF NOT EXISTS idx_transactions_atomic ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_sync ON public.messages(chat_id, created_at ASC);

-- 3. STORAGE BUCKETS (Trust Hub)
-- Nota: Esto requiere que el bucket exista en la UI de Supabase o usar extensiones
-- Asegúrate de crear el bucket 'verification-documents' como PRIVADO.

-- 4. RECOMPILACIÓN DE RPCS CLAVE (Atomicidad Garantizada)
-- Todas las funciones (confirm_trip_and_pay, verify_passenger, create_ride) 
-- ya están actualizadas en tus archivos .sql individuales.
