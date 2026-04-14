-- ==============================================================================
-- BOOKING_NOTIFICATIONS_TRIGGER.sql
-- Propósito: Notificar en tiempo real al conductor cuando alguien reserva plaza.
-- ==============================================================================

-- 1. Función que inserta la notificación en la tabla 'notifications'
CREATE OR REPLACE FUNCTION public.create_booking_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_driver_id UUID;
    v_passenger_name TEXT;
    v_ride_origin TEXT;
    v_ride_destination TEXT;
BEGIN
    -- Seguridad: Solo actuar si el array de pasajeros ha crecido (nueva reserva)
    IF TG_OP = 'UPDATE' AND (
        NEW.passengers IS NULL OR 
        (OLD.passengers IS NOT NULL AND jsonb_array_length(NEW.passengers) <= jsonb_array_length(OLD.passengers))
    ) THEN
        RETURN NEW;
    END IF;

    -- Extraer información del viaje y del pasajero recién incorporado
    v_driver_id := NEW.driver_id;
    
    -- Obtenemos el nombre del último elemento en el array de pasajeros
    v_passenger_name := COALESCE(
        NEW.passengers -> (jsonb_array_length(NEW.passengers) - 1) ->> 'displayName',
        NEW.passengers -> (jsonb_array_length(NEW.passengers) - 1) ->> 'display_name',
        'Un pasajero'
    );
    
    v_ride_origin := COALESCE(NEW.origin ->> 'name', 'su origen');
    v_ride_destination := COALESCE(NEW.destination ->> 'name', 'su destino');

    -- Insertar la notificación para el conductor
    -- El sistema de tiempo real (Supabase Realtime) detectará este insert y avisará al cliente
    INSERT INTO public.notifications (
        user_id, 
        title, 
        content, 
        type, 
        data,
        read
    )
    VALUES (
        v_driver_id,
        '¡Nueva Reserva!',
        v_passenger_name || ' se ha unido a tu viaje de ' || v_ride_origin || ' a ' || v_ride_destination,
        'booking',
        jsonb_build_object(
            'ride_id', NEW.id, 
            'passenger_name', v_passenger_name,
            'origin', v_ride_origin,
            'destination', v_ride_destination
        ),
        false
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- En triggers es vital no romper la operación principal (la reserva)
    RAISE NOTICE 'Error en create_booking_notification: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Vincular el trigger a la tabla 'rides'
-- Se dispara cada vez que se actualiza la columna 'passengers'
DROP TRIGGER IF EXISTS tr_notify_on_booking ON public.rides;
CREATE TRIGGER tr_notify_on_booking
AFTER UPDATE OF passengers ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.create_booking_notification();

-- 3. Habilitar replicación para la tabla de notificaciones (si no está ya habilitada)
-- Esto es CRÍTICO para que el pop-up salga en tiempo real sin refrescar
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
