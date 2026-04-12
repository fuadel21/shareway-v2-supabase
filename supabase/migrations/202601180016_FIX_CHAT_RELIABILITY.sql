-- ========================================================
-- FIX: Fiabilidad del Sistema de Chat
-- Actualización automática de timestamps y mejora de RPC
-- ========================================================

-- 1. Trigger para actualizar el timestamp del chat al recibir mensajes
CREATE OR REPLACE FUNCTION public.handle_new_message_sync()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.chats
    SET updated_at = NOW()
    WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_new_message_update_chat ON public.messages;
CREATE TRIGGER on_new_message_update_chat
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.handle_new_message_sync();

-- 2. Asegurar que el RPC de creación de chat maneja correctamente los tipos
CREATE OR REPLACE FUNCTION public.get_or_create_chat_v2(
    p_other_user_id UUID,
    p_ride_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_chat_id UUID;
    v_chat_type TEXT;
BEGIN
    -- Determinar el tipo de chat
    IF p_ride_id IS NOT NULL THEN
        -- Si hay un ride_id, podría ser el chat grupal o uno individual sobre el viaje
        -- Por defecto lo trataremos como individual entre conductor y pasajero si p_other_user_id no es el conductor
        v_chat_type := 'individual';
    ELSE
        v_chat_type := 'individual';
    END IF;

    -- Buscar si ya existe un chat individual entre estos dos usuarios
    -- (Opcional: Filtrar por ride_id si quieres chats específicos por viaje)
    SELECT id INTO v_chat_id
    FROM public.chats
    WHERE participants @> ARRAY[v_user_id, p_other_user_id]
      AND cardinality(participants) = 2
      AND (p_ride_id IS NULL OR ride_id = p_ride_id)
    LIMIT 1;

    -- Si no existe, crearlo
    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (
            participants,
            ride_id,
            type,
            updated_at
        )
        VALUES (
            ARRAY[v_user_id, p_other_user_id],
            p_ride_id,
            v_chat_type,
            NOW()
        )
        RETURNING id INTO v_chat_id;
    END IF;

    RETURN json_build_object('chatId', v_chat_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario para auditoría
COMMENT ON FUNCTION public.get_or_create_chat_v2 IS 'Crea o recupera un chat asegurando que el timestamp se inicialice correctamente';
