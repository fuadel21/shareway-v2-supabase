-- ========================================================
-- CHAT ELITE: Gestión de Mensajes Leídos y No Leídos
-- ========================================================

-- Función para marcar todos los mensajes de un chat como leídos
CREATE OR REPLACE FUNCTION public.mark_chat_as_read(p_chat_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.messages
    SET read_by = read_by || jsonb_build_array(auth.uid())
    WHERE chat_id = p_chat_id
      AND NOT (read_by @> jsonb_build_array(auth.uid()))
      AND sender_id != auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para obtener el total de mensajes no leídos del usuario (Global)
CREATE OR REPLACE FUNCTION public.get_total_unread_count()
RETURNS INTEGER AS $$
DECLARE
    v_total INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO v_total
    FROM public.messages m
    JOIN public.chats c ON m.chat_id = c.id
    WHERE auth.uid() = ANY(c.participants)
      AND m.sender_id != auth.uid()
      AND NOT (m.read_by @> jsonb_build_array(auth.uid()));

    RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
