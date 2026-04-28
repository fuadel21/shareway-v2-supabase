-- ==============================================================================
-- 20260430_OPTIMIZED_TRACKING.sql
-- Propósito: Tracking de alta frecuencia sin saturar la tabla de viajes.
-- ==============================================================================

-- 1. Tabla ultra-ligera para posiciones en tiempo real
CREATE TABLE IF NOT EXISTS public.ride_locations (
    ride_id UUID PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar Realtime específico para esta tabla
ALTER publication supabase_realtime ADD TABLE public.ride_locations;

-- 3. RPC optimizado para el conductor (Upsert rápido)
CREATE OR REPLACE FUNCTION public.update_ride_location(
    p_ride_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_heading DOUBLE PRECISION DEFAULT 0
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.ride_locations (ride_id, latitude, longitude, heading, updated_at)
    VALUES (p_ride_id, p_lat, p_lng, p_heading, NOW())
    ON CONFLICT (ride_id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        heading = EXCLUDED.heading,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS para seguridad
ALTER TABLE public.ride_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participantes pueden ver ubicación" ON public.ride_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE id = ride_locations.ride_id
              AND (driver_id = auth.uid() OR auth.uid() = ANY(participant_ids))
        )
    );
