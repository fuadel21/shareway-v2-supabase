-- ==============================================================================
-- 20260501_FIX_CHAT_VISIBILITY.sql
-- Propósito: Corregir errores 406 y asegurar visibilidad de metadatos del chat.
-- ==============================================================================

-- 1. Asegurar que la columna read_by sea accesible y tenga un valor por defecto seguro
ALTER TABLE public.messages
ALTER COLUMN read_by SET DEFAULT '[]'::jsonb;

-- 2. Refrescar políticas de lectura para mensajes
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
CREATE POLICY "Users can view messages in their chats" ON public.messages
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.chats c
        WHERE c.id = messages.chat_id
        AND auth.uid() = ANY(c.participants)
    )
);

-- 3. Asegurar que el usuario pueda insertar mensajes en sus chats
DROP POLICY IF EXISTS "Users can insert messages in their chats" ON public.messages;
CREATE POLICY "Users can insert messages in their chats" ON public.messages
FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.chats c
        WHERE c.id = chat_id
        AND auth.uid() = ANY(c.participants)
    )
);

-- 4. Nueva política para que PostgREST no falle al pedir metadatos
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO postgres;
