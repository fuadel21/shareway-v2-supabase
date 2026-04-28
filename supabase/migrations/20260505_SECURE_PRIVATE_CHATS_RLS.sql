-- ==========================================
-- 20260505_SECURE_PRIVATE_CHATS_RLS.sql
-- Blindaje de Seguridad para Mensajería Privada
-- ==========================================

-- 1. Habilitar RLS en las tablas de mensajería
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 2. POLÍTICAS PARA LA TABLA 'CHATS'
-- Permitir ver chats solo si el usuario es un participante
DROP POLICY IF EXISTS "Users can view chats they are part of" ON public.chats;
CREATE POLICY "Users can view chats they are part of"
ON public.chats
FOR SELECT
USING (auth.uid() = ANY(participants));

-- Permitir crear chats (esto suele ser automático por RPC o lógica de negocio)
-- Pero por si se hace vía REST:
DROP POLICY IF EXISTS "Users can create chats if they are participants" ON public.chats;
CREATE POLICY "Users can create chats if they are participants"
ON public.chats
FOR INSERT
WITH CHECK (auth.uid() = ANY(participants));

-- 3. POLÍTICAS PARA LA TABLA 'MESSAGES'
-- Permitir ver mensajes solo si el usuario pertenece al chat correspondiente
DROP POLICY IF EXISTS "Users can view messages of their chats" ON public.messages;
CREATE POLICY "Users can view messages of their chats"
ON public.messages
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.chats
        WHERE chats.id = messages.chat_id
        AND auth.uid() = ANY(chats.participants)
    )
);

-- Permitir enviar mensajes solo si el usuario es participante del chat y es el emisor
DROP POLICY IF EXISTS "Users can send messages to their chats" ON public.messages;
CREATE POLICY "Users can send messages to their chats"
ON public.messages
FOR INSERT
WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM public.chats
        WHERE chats.id = messages.chat_id
        AND auth.uid() = ANY(chats.participants)
    )
);

-- 4. VISTA DE SEGURIDAD PARA CONTAR MENSAJES NO LEÍDOS (Opcional pero recomendado)
-- Asegura que el conteo de notificaciones también respete el RLS
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_by UUID[] DEFAULT '{}';
