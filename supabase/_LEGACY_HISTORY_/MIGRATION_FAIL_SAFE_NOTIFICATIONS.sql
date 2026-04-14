-- ========================================================
-- MIGRACIÓN: FAIL-SAFE NOTIFICATIONS (Principal Engineer Edition)
-- Objetivo: Notificaciones automáticas disparadas por eventos de DB
-- ========================================================

-- 1. Función para obtener el PIN de un pasajero específico desde el JSONB
CREATE OR REPLACE FUNCTION get_passenger_pin(p_passengers JSONB, p_user_id UUID) 
RETURNS TEXT AS $$
BEGIN
    RETURN (SELECT p->>'pin' FROM jsonb_array_elements(p_passengers) p WHERE (p->>'id')::UUID = p_user_id LIMIT 1);
END;
$$ LANGUAGE plpgsql;

-- 2. TRIGGER FUNCTION: Monitorizar cambios en RIDES
CREATE OR REPLACE FUNCTION public.handle_ride_notifications() 
RETURNS TRIGGER AS $$
DECLARE
    v_old_pax JSONB;
    v_new_pax JSONB;
    v_p RECORD;
    v_pin TEXT;
BEGIN
    -- Detectar cambios en el campo 'passengers' (JSONB)
    v_old_pax := COALESCE(OLD.passengers, '[]'::JSONB);
    v_new_pax := COALESCE(NEW.passengers, '[]'::JSONB);

    -- Iterar sobre los pasajeros en el nuevo estado
    FOR v_p IN SELECT * FROM jsonb_array_elements(v_new_pax) LOOP
        -- CASO 1: Pasajero pasa de 'pending' a 'confirmed'
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_old_pax) old_p
            WHERE (old_p->>'id') = (v_p.value->>'id')
            AND (old_p->>'status') = 'pending'
            AND (v_p.value->>'status') = 'confirmed'
        ) THEN
            v_pin := v_p.value->>'pin';
            PERFORM public.create_notification(
                (v_p.value->>'id')::UUID,
                '¡Plaza Confirmada!',
                'El conductor ha aceptado tu solicitud. Tu PIN de abordaje es ' || COALESCE(v_pin, '****'),
                'success',
                jsonb_build_object('ride_id', NEW.id, 'pin', v_pin)
            );
        END IF;

        -- CASO 2: Pasajero pasa de 'pending' a 'rejected'
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_old_pax) old_p
            WHERE (old_p->>'id') = (v_p.value->>'id')
            AND (old_p->>'status') = 'pending'
            AND (v_p.value->>'status') = 'rejected'
        ) THEN
            PERFORM public.create_notification(
                (v_p.value->>'id')::UUID,
                'Solicitud Rechazada',
                'Lo sentimos, el conductor ha rechazado tu solicitud. Tu dinero ha sido devuelto al monedero.',
                'error',
                jsonb_build_object('ride_id', NEW.id)
            );
        END IF;
    END LOOP;

    -- CASO 3: Cancelación total del viaje por el conductor
    IF OLD.status = 'scheduled' AND NEW.status = 'cancelled' THEN
        FOR v_p IN SELECT * FROM jsonb_array_elements(v_new_pax) LOOP
            IF (v_p.value->>'status') = 'cancelled' THEN
                PERFORM public.create_notification(
                    (v_p.value->>'id')::UUID,
                    'Viaje Cancelado',
                    'El conductor ha cancelado el viaje. Se ha tramitado el reembolso total.',
                    'warning',
                    jsonb_build_object('ride_id', NEW.id)
                );
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Crear el Trigger
DROP TRIGGER IF EXISTS tr_ride_notifications ON public.rides;
CREATE TRIGGER tr_ride_notifications
AFTER UPDATE ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.handle_ride_notifications();
