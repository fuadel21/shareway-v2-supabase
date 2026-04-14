-- ========================================================
-- MIGRACIÓN: GEOLOCATION WATCHDOG v1.0
-- Objetivo: Seguimiento GPS preciso y validación de frescura de datos.
-- ========================================================

-- 1. EXTENSIÓN DE TABLA RIDES
-- Añadimos la columna para saber CUÁNDO se recibió la última señal GPS.
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS last_gps_update TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS current_location_geog GEOGRAPHY(POINT, 4326);

-- 2. FUNCIÓN DE ACTUALIZACIÓN DE UBICACIÓN BLINDADA
-- Esta función será llamada por el frontend del conductor.
CREATE OR REPLACE FUNCTION public.update_ride_location(
    p_ride_id UUID,
    p_lat FLOAT,
    p_lng FLOAT
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
BEGIN
    -- Solo el conductor puede actualizar su ubicación
    UPDATE public.rides
    SET 
        current_location = jsonb_build_object('lat', p_lat, 'lng', p_lng),
        current_location_geog = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
        last_gps_update = NOW()
    WHERE id = p_ride_id AND driver_id = v_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o viaje inexistente.';
    END IF;

    RETURN json_build_object('success', true, 'timestamp', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. VISTA DE SEGURIDAD PARA EL PASAJERO (Con indicador de frescura)
-- Permite al pasajero saber si el GPS es fiable o está "congelado".
CREATE OR REPLACE VIEW public.active_ride_tracking AS
SELECT 
    id as ride_id,
    current_location,
    last_gps_update,
    (EXTRACT(EPOCH FROM (NOW() - last_gps_update)) < 300) as is_gps_fresh -- True si < 5 min
FROM public.rides
WHERE status IN ('active', 'in_progress');
