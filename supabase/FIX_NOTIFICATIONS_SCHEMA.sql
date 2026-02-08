-- ========================================================
-- MIGRACIÓN: FIX NOTIFICATIONS SCHEMA
-- Objetivo: Asegurar que la tabla notifications coincida con el frontend
-- ========================================================

-- 1. Asegurar columnas básicas
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='read') THEN
        ALTER TABLE public.notifications ADD COLUMN read BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='title') THEN
        ALTER TABLE public.notifications ADD COLUMN title TEXT DEFAULT 'Notificación';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='content') THEN
        ALTER TABLE public.notifications ADD COLUMN content TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='type') THEN
        ALTER TABLE public.notifications ADD COLUMN type TEXT DEFAULT 'info';
    END IF;
END $$;

-- 2. Asegurar que RLS permita lectura
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own notifications" ON public.notifications;
CREATE POLICY "Users can see their own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id);

-- 3. Función simplificada para crear notificaciones compatible con el JS
-- Borramos la función anterior para evitar conflictos de tipo de retorno
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_title TEXT,
    p_content TEXT,
    p_type TEXT DEFAULT 'info',
    p_data JSONB DEFAULT '{}'::jsonb
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.notifications (user_id, title, content, type, payload, read)
    VALUES (p_user_id, p_title, p_content, p_type, p_data, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
