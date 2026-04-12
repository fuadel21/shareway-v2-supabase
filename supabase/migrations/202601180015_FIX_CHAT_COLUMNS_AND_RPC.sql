-- ========================================================
-- FIX: Añadir columnas faltantes en Chats y Mensajes
-- y corregir la función get_ride_chats
-- ========================================================

-- 1. Asegurar columnas en public.chats
ALTER TABLE public.chats 
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'group' CHECK (type IN ('group', 'individual', 'support'));

-- 2. Asegurar columnas en public.messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '[]'::jsonb;

-- 3. Corregir función get_ride_chats (Hardened)
-- Eliminamos primero para evitar error de cambio de tipo de retorno
DROP FUNCTION IF EXISTS public.get_ride_chats(uuid);

CREATE OR REPLACE FUNCTION public.get_ride_chats(p_ride_id UUID) RETURNS TABLE (
        chat_id UUID,
        chat_type TEXT,
        participants UUID [],
        participant_names JSONB,
        last_message JSONB,
        unread_count INTEGER,
        ride_id UUID
    ) AS $$ 
BEGIN 
    RETURN QUERY
    SELECT 
        c.id as chat_id,
        COALESCE(c.type, 'group') as chat_type,
        c.participants,
        (
            SELECT jsonb_object_agg(p.id, p.display_name)
            FROM public.profiles p
            WHERE p.id = ANY(c.participants)
        ) as participant_names,
        (
            SELECT json_build_object(
                    'content', m.content,
                    'created_at', m.created_at,
                    'sender_id', m.sender_id
                )::JSONB
            FROM public.messages m
            WHERE m.chat_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
        ) as last_message,
        (
            SELECT COUNT(*)::INTEGER
            FROM public.messages m
            WHERE m.chat_id = c.id
                AND m.sender_id != auth.uid()
                AND NOT (m.read_by @> jsonb_build_array(auth.uid()))
        ) as unread_count,
        c.ride_id
    FROM public.chats c
    WHERE c.ride_id = p_ride_id
        AND auth.uid() = ANY(c.participants);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Comentario para auditoría
COMMENT ON FUNCTION public.get_ride_chats IS 'Versión corregida que maneja las columnas type y read_by';
