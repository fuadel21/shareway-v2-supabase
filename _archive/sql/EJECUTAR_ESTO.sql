-- EJECUTA ESTE SQL EN SUPABASE DASHBOARD -> SQL EDITOR
-- Copia todo y pega en el editor, luego presiona RUN
-- ========================================================
-- FIX: GET_USER_NOTIFICATIONS RPC
-- ========================================================
-- 1. Asegurar estructura de tabla
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'content'
) THEN
ALTER TABLE public.notifications
ADD COLUMN content TEXT;
END IF;
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'body'
) THEN
UPDATE public.notifications
SET content = body
WHERE content IS NULL;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'title'
) THEN
ALTER TABLE public.notifications
ADD COLUMN title TEXT DEFAULT 'Notificación';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'data'
) THEN
ALTER TABLE public.notifications
ADD COLUMN data JSONB DEFAULT '{}'::jsonb;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'type'
) THEN
ALTER TABLE public.notifications
ADD COLUMN type TEXT DEFAULT 'info';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'read'
) THEN
ALTER TABLE public.notifications
ADD COLUMN read BOOLEAN DEFAULT FALSE;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications'
        AND column_name = 'status'
) THEN
ALTER TABLE public.notifications
ADD COLUMN status TEXT DEFAULT 'pending';
END IF;
UPDATE public.notifications
SET read = TRUE
WHERE status = 'read';
UPDATE public.notifications
SET status = 'read'
WHERE read = TRUE;
END $$;
-- 2. Eliminar función antigua
DROP FUNCTION IF EXISTS public.get_user_notifications(UUID, INTEGER, INTEGER, BOOLEAN);
-- 3. Crear función corregida
CREATE OR REPLACE FUNCTION public.get_user_notifications(
        p_user_id UUID,
        p_limit INTEGER DEFAULT 50,
        p_offset INTEGER DEFAULT 0,
        p_unread_only BOOLEAN DEFAULT false
    ) RETURNS TABLE (
        id UUID,
        type TEXT,
        title TEXT,
        message TEXT,
        data JSONB,
        is_read BOOLEAN,
        created_at TIMESTAMPTZ
    ) AS $$ BEGIN RETURN QUERY
SELECT n.id,
    n.type,
    COALESCE(n.title, 'Notificación') as title,
    COALESCE(n.content, '') as message,
    COALESCE(n.data, '{}'::jsonb) as data,
    COALESCE(n.read, false) as is_read,
    n.created_at
FROM public.notifications n
WHERE n.user_id = p_user_id
    AND (
        NOT p_unread_only
        OR (n.read = false)
    )
ORDER BY n.created_at DESC
LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Dar permisos
GRANT EXECUTE ON FUNCTION public.get_user_notifications(UUID, INTEGER, INTEGER, BOOLEAN) TO authenticated;