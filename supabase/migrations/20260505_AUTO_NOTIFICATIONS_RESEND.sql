-- ==========================================
-- 20260505_AUTO_NOTIFICATIONS_RESEND.sql
-- Automatización de Avisos por Email (Elite)
-- ==========================================

-- 1. Función para disparar notificaciones via Edge Function
CREATE OR REPLACE FUNCTION public.handle_ride_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
    v_url TEXT := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/notify-admin-new-user'; -- Podemos reutilizar o crear una específica
    v_service_key TEXT := 'TU_SERVICE_ROLE_KEY'; -- Se recomienda configurar vía Vault
BEGIN
    -- Caso A: Nueva Reserva (Se añade un pasajero al array)
    IF (TG_OP = 'UPDATE' AND OLD.passengers IS DISTINCT FROM NEW.passengers AND jsonb_array_length(NEW.passengers) > jsonb_array_length(OLD.passengers)) THEN
        v_payload := jsonb_build_object(
            'type', 'new_booking',
            'ride_id', NEW.id,
            'driver_id', NEW.driver_id,
            'message', '¡Alguien ha reservado una plaza en tu viaje!'
        );
        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := v_payload
        );
    END IF;

    -- Caso B: Viaje Finalizado (Pago realizado)
    IF (TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed') THEN
        v_payload := jsonb_build_object(
            'type', 'ride_completed',
            'ride_id', NEW.id,
            'driver_id', NEW.driver_id,
            'message', '¡Viaje finalizado! El pago ha sido ingresado en tu cartera.'
        );
        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := v_payload
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger en la tabla Rides
DROP TRIGGER IF EXISTS tr_ride_notifications ON public.rides;
CREATE TRIGGER tr_ride_notifications
AFTER UPDATE ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.handle_ride_notification();
