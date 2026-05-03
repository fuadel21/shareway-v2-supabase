-- ==========================================
-- 20260511_ENABLE_CHAT_REALTIME.sql
-- Habilitación de Mensajería en Tiempo Real
-- ==========================================

-- 1. Asegurar Identidad de Réplica para actualizaciones completas
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.chats REPLICA IDENTITY FULL;

-- 2. Agregar tablas a la publicación de Supabase Realtime
-- Intentamos agregarlas solo si no están ya en la publicación
DO $$
BEGIN
    -- Agregar messages
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;

    -- Agregar chats
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chats'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
    END IF;
END $$;
