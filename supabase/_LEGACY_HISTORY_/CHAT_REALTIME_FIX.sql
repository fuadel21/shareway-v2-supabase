-- ==========================================
-- CHAT REAL-TIME & RLS FIX (Robust Version)
-- ==========================================
-- 1. ENABLE REAL-TIME FOR CHAT TABLES
-- USES a DO block to safely add tables to the publication without syntax errors
DO $$ BEGIN -- Ensure tables have replica identity for real-time tracking
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.chats REPLICA IDENTITY FULL;
-- Add messages to publication if not already there
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'messages'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE public.messages;
END IF;
-- Add chats to publication if not already there
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chats'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE public.chats;
END IF;
END $$;
-- 2. OPTIMIZE RLS FOR MESSAGES (V3)
-- Ensures that participants can always see messages in their chats
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_select_involved" ON public.messages;
CREATE POLICY "messages_select_v3" ON public.messages FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.chats
            WHERE chats.id = messages.chat_id
                AND (auth.uid() = ANY(chats.participants))
        )
    );
-- Ensure insertion policy is correct
DROP POLICY IF EXISTS "Users can create messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert_v3" ON public.messages FOR
INSERT WITH CHECK (
        auth.uid() = sender_id
        AND EXISTS (
            SELECT 1
            FROM public.chats
            WHERE chats.id = chat_id
                AND (auth.uid() = ANY(chats.participants))
        )
    );
-- 3. RELOAD SCHEMA CACHE
NOTIFY pgrst,
'reload schema';