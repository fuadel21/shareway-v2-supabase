-- ========================================================
-- MIGRACIÓN: PUSH NOTIFICATION DISPATCHER v1.1
-- Objetivo: Automatizar el envío de notificaciones al móvil (Chat + Ride Status)
-- ========================================================

-- 1. FUNCIÓN DE DISPACHO (Invocada por Trigger)
CREATE OR REPLACE FUNCTION public.dispatch_push_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_fcm_token TEXT;
    v_service_key TEXT;
    v_project_url TEXT := 'https://wmkhutsesgtkcgqbctef.supabase.co'; 
BEGIN
    -- 1. Obtener el token del usuario desde su perfil
    SELECT fcm_token INTO v_fcm_token 
    FROM public.profiles 
    WHERE id = NEW.user_id;

    -- 2. Si el usuario no tiene token (no ha dado permiso o no está en móvil), no hacemos nada
    IF v_fcm_token IS NULL OR v_fcm_token = '' THEN
        RETURN NEW;
    END IF;

    -- 3. Obtener la Service Key
    v_service_key := current_setting('app.secrets.service_role_key', true);

    -- 4. Llamada asíncrona a la Edge Function 'send-push'
    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(v_service_key, '')
        ),
        body := jsonb_build_object(
            'token', v_fcm_token,
            'title', NEW.payload->>'title',
            'body', NEW.payload->>'content',
            'data', NEW.payload->'data',
            'notification_id', NEW.id
        )
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error despachando Push: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. TRIGGER VINCULADO
DROP TRIGGER IF EXISTS tr_dispatch_push ON public.notifications;
CREATE TRIGGER tr_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_push_notification();

-- 3. NOTIFICACIONES DE CHAT
CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_recipient_id UUID;
    v_sender_name TEXT;
BEGIN
    SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

    SELECT p INTO v_recipient_id
    FROM (SELECT unnest(participants) as p FROM public.chats WHERE id = NEW.chat_id) sub
    WHERE p != NEW.sender_id
    LIMIT 1;

    IF v_recipient_id IS NOT NULL THEN
        PERFORM public.create_notification(
            v_recipient_id,
            v_sender_name,
            NEW.content,
            'chat_message',
            jsonb_build_object('chat_id', NEW.chat_id, 'sender_id', NEW.sender_id)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_on_new_message_notify ON public.messages;
CREATE TRIGGER tr_on_new_message_notify
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_message_notification();

-- 4. NOTIFICACIONES DE ESTADO DEL VIAJE (¡NUEVO!)
CREATE OR REPLACE FUNCTION public.handle_ride_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_passenger_id UUID;
BEGIN
    -- Solo actuar si el estado ha cambiado
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Notificar a todos los pasajeros (participant_ids incluye al driver, lo filtramos)
        FOR v_passenger_id IN SELECT unnest(NEW.participant_ids) LOOP
            IF v_passenger_id != NEW.driver_id THEN
                PERFORM public.create_notification(
                    v_passenger_id,
                    CASE 
                        WHEN NEW.status = 'active' THEN '¡Viaje en marcha! 🚗'
                        WHEN NEW.status = 'completed' THEN 'Has llegado a tu destino 🏁'
                        WHEN NEW.status = 'cancelled' THEN 'Viaje cancelado ⚠️'
                        ELSE 'Actualización de viaje'
                    END,
                    CASE 
                        WHEN NEW.status = 'active' THEN 'El conductor ha iniciado el trayecto. ¡Nos vemos!'
                        WHEN NEW.status = 'completed' THEN 'Esperamos que hayas tenido un buen viaje. ¡No olvides valorar!'
                        WHEN NEW.status = 'cancelled' THEN 'El conductor ha cancelado este viaje.'
                        ELSE 'El estado de tu viaje ha cambiado a ' || NEW.status
                    END,
                    'ride_update',
                    jsonb_build_object('ride_id', NEW.id, 'status', NEW.status)
                );
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_on_ride_status_notify ON public.rides;
CREATE TRIGGER tr_on_ride_status_notify
AFTER UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.handle_ride_status_notification();
