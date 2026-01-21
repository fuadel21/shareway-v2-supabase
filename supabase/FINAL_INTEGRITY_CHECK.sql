-- ========================================================
-- SHAREWAY INTEGRITY CHECK (Principal Engineer Final Fix)
-- Objetivo: Sincronizar esquema y limpiar colisiones
-- ========================================================

DO $$ 
BEGIN 
    -- PROFILES: Columnas de estadísticas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rides_count') THEN ALTER TABLE public.profiles ADD COLUMN rides_count INTEGER DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='total_co2_saved') THEN ALTER TABLE public.profiles ADD COLUMN total_co2_saved DECIMAL DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='eco_points') THEN ALTER TABLE public.profiles ADD COLUMN eco_points INTEGER DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rating_sum') THEN ALTER TABLE public.profiles ADD COLUMN rating_sum INTEGER DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rating_count') THEN ALTER TABLE public.profiles ADD COLUMN rating_count INTEGER DEFAULT 0; END IF;

    -- RIDES: Geolocalización y CO2
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='co2_saved') THEN ALTER TABLE public.rides ADD COLUMN co2_saved DECIMAL DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='current_location') THEN ALTER TABLE public.rides ADD COLUMN current_location JSONB; END IF;

    -- RIDE_REQUESTS: Ruta y Distancia
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='distance') THEN ALTER TABLE public.ride_requests ADD COLUMN distance NUMERIC DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='overview_polyline') THEN ALTER TABLE public.ride_requests ADD COLUMN overview_polyline TEXT DEFAULT ''; END IF;
END $$;

-- RESET DE POLÍTICAS DE CHAT (Para evitar error de lectura)
DROP POLICY IF EXISTS "messages_select_involved" ON public.messages;
CREATE POLICY "messages_select_involved" ON public.messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chats WHERE id = chat_id AND (SELECT auth.uid()) = ANY(participants))
);
