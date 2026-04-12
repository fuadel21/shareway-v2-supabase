-- ==========================================
-- FIX: Políticas de RLS para Chats y Mensajes
-- ==========================================

-- Asegurar que RLS esté habilitado
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS PARA CHATS
DROP POLICY IF EXISTS "Users can view chats they are part of" ON public.chats;
CREATE POLICY "Users can view chats they are part of" ON public.chats
FOR SELECT USING (auth.uid() = ANY(participants));

DROP POLICY IF EXISTS "Users can create chats if they are participants" ON public.chats;
CREATE POLICY "Users can create chats if they are participants" ON public.chats
FOR INSERT WITH CHECK (auth.uid() = ANY(participants));

-- POLÍTICAS PARA MENSAJES
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
CREATE POLICY "Users can view messages in their chats" ON public.messages
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.chats
        WHERE chats.id = messages.chat_id
        AND auth.uid() = ANY(chats.participants)
    )
);

DROP POLICY IF EXISTS "Users can send messages to their chats" ON public.messages;
CREATE POLICY "Users can send messages to their chats" ON public.messages
FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
        SELECT 1 FROM public.chats
        WHERE chats.id = messages.chat_id
        AND auth.uid() = ANY(chats.participants)
    )
);

-- Comentario para auditoría
COMMENT ON TABLE public.chats IS 'Tabla de chats con RLS corregido para permitir acceso a participantes';
COMMENT ON TABLE public.messages IS 'Tabla de mensajes con RLS corregido para permitir acceso a participantes del chat';
