-- ==========================================
-- FINAL LIFECYCLE FIX: Sincronización Total v2.0
-- Proposito: Resolver conflictos de ambigüedad y sincronizar firmas GPS/Notificaciones.
-- ==========================================

-- 1. LIMPIEZA DE AMBIGÜEDAD (Elimina el error 42725)
-- Borramos todas las variantes para asegurar una única firma compatible con React
DROP FUNCTION IF EXISTS public.update_ride_location(uuid, jsonb);
DROP FUNCTION IF EXISTS public.update_ride_location(uuid, double precision, double precision);
DROP FUNCTION IF EXISTS public.start_ride(uuid);

-- 2. RE-CREACIÓN: UPDATE_RIDE_LOCATION
-- Ahora acepta lat/lng individuales para coincidir exactamente con el envío de RideManagement.jsx
CREATE OR REPLACE FUNCTION public.update_ride_location(
    p_ride_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_location JSONB;
BEGIN
    v_location := jsonb_build_object('lat', p_lat, 'lng', p_lng);
    
    UPDATE public.rides
    SET current_location = v_location,
        updated_at = NOW()
    WHERE id = p_ride_id 
      AND driver_id = v_driver_id
      AND status = 'active';

    RETURN json_build_object('success', FOUND);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RE-CREACIÓN: START_RIDE
-- Sincronizada con la firma unificada de 7 parámetros de create_notification
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) 
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_passenger_id UUID;
BEGIN
    -- 1. Actualizar estado del viaje
    UPDATE public.rides
    SET status = 'active',
        started_at = NOW()
    WHERE id = p_ride_id
      AND driver_id = v_driver_id
      AND status = 'scheduled'
    RETURNING * INTO v_ride;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo iniciar el viaje. Verifica el estado o permisos.';
    END IF;

    -- 2. Notificar a los pasajeros (Firma de 7 parámetros corregida)
    FOR v_passenger_id IN SELECT unnest(v_ride.participant_ids)
    LOOP
        IF v_passenger_id != v_driver_id THEN
            PERFORM public.create_notification(
                v_passenger_id,
                '¡Viaje iniciado!',
                'Tu conductor ha comenzado el trayecto. ¡Buen viaje!',
                'ride_started',
                jsonb_build_object('ride_id', p_ride_id),
                p_ride_id,
                1 -- Prioridad alta
            );
        END IF;
    END LOOP;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PERMISOS EXPLÍCITOS (Sin ambigüedad)
GRANT EXECUTE ON FUNCTION public.update_ride_location(uuid, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_ride(uuid) TO authenticated;

SELECT 'Sincronización de ciclo de vida completada con éxito' as status;
