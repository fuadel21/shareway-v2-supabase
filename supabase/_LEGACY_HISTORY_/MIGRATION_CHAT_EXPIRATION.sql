-- ========================================================
-- MIGRACIÓN: CHAT EXPIRATION POLICY (24h Rule)
-- Propósito: Desactivar el envío de mensajes 24h después de 
-- que el viaje haya terminado o sido cancelado.
-- ========================================================
-- 1. Función para verificar si un chat está activo
CREATE OR REPLACE FUNCTION public.is_chat_active(p_chat_id UUID) RETURNS BOOLEAN AS $$
DECLARE v_ride_id UUID;
v_status TEXT;
v_finished_at TIMESTAMPTZ;
BEGIN -- Obtener el ride asociado al chat
SELECT ride_id INTO v_ride_id
FROM public.chats
WHERE id = p_chat_id;
-- Si no hay ride asociado, por ahora permitimos que siga activo
-- (Opcional: podrías poner una regla de 24h desde el último mensaje)
IF v_ride_id IS NULL THEN RETURN TRUE;
END IF;
-- Obtener estado y fecha de finalización del ride
SELECT status,
    COALESCE(completed_at, cancelled_at) INTO v_status,
    v_finished_at
FROM public.rides
WHERE id = v_ride_id;
-- Regla: Si el ride está acabado o cancelado hace más de 24 horas, el chat está inactivo
IF v_status IN ('completed', 'cancelled')
AND v_finished_at < NOW() - INTERVAL '24 hours' THEN RETURN FALSE;
END IF;
-- En cualquier otro caso (viaje programado, activo, o acabado hace poco), está activo
RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. Trigger para aplicar la regla en la base de datos (Nivel de Seguridad)
CREATE OR REPLACE FUNCTION public.check_chat_active_on_message() RETURNS TRIGGER AS $$ BEGIN IF NOT public.is_chat_active(NEW.chat_id) THEN RAISE EXCEPTION 'CHAT_EXPIRED: Este chat ha sido cerrado automáticamente después de 24h del viaje.';
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tr_check_chat_active ON public.messages;
CREATE TRIGGER tr_check_chat_active BEFORE
INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.check_chat_active_on_message();
-- 3. Actualizar la vista de chats para el frontend
-- (Opcional: podrías añadir una columna virtual 'is_active' en la tabla chats si prefieres)
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS is_active_override BOOLEAN DEFAULT TRUE;
-- Por si un admin quiere reabrirlo manualmente