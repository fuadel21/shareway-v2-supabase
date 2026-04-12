-- ========================================================
-- FIX: NOTIFICATION FUNCTION AMBIGUITY & SIGNATURE UNIFICATION
-- ========================================================

-- 1. Eliminar todas las versiones posibles para limpiar el cache de PostgREST
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ);

-- 2. Crear la versión definitiva UNIFICADA
-- Usamos el orden de parámetros más común en el código: (user, title, body, type, data, ...)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_title TEXT,
    p_body TEXT,
    p_type TEXT DEFAULT 'info',
    p_data JSONB DEFAULT '{}'::jsonb,
    p_priority TEXT DEFAULT 'normal',
    p_category TEXT DEFAULT 'general',
    p_scheduled_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS UUID AS $$
DECLARE 
    v_notification_id UUID;
    v_preferences RECORD;
    v_can_send BOOLEAN := TRUE;
    v_current_time TIME := LOCALTIME;
BEGIN 
    -- Obtener preferencias del usuario
    SELECT * INTO v_preferences FROM public.notification_preferences WHERE user_id = p_user_id;

    -- Si no tiene preferencias, crear defaults
    IF v_preferences IS NULL THEN
        INSERT INTO public.notification_preferences (user_id) VALUES (p_user_id)
        ON CONFLICT (user_id) DO NOTHING;
        SELECT * INTO v_preferences FROM public.notification_preferences WHERE user_id = p_user_id;
    END IF;

    -- Verificar si se puede enviar (lógica simplificada para evitar fallos por nulos)
    IF v_preferences IS NOT NULL THEN
        -- Verificar horario de silencio
        IF v_preferences.do_not_disturb AND p_priority != 'urgent' THEN 
            IF v_current_time >= v_preferences.quiet_hours_start OR v_current_time <= v_preferences.quiet_hours_end THEN 
                v_can_send := FALSE; 
            END IF;
        END IF;
    END IF;

    -- Insertar notificación
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        data,
        status,
        priority,
        category,
        scheduled_at
    )
    VALUES (
        p_user_id,
        p_type,
        p_title,
        p_body,
        p_data,
        CASE WHEN v_can_send THEN 'pending' ELSE 'failed' END,
        p_priority,
        p_category,
        p_scheduled_at
    )
    RETURNING id INTO v_notification_id;

    -- Notificar al listener de push (si se puede enviar)
    IF v_can_send THEN
        PERFORM pg_notify(
            'new_notification',
            json_build_object(
                'notification_id', v_notification_id,
                'user_id', p_user_id,
                'type', p_type
            )::TEXT
        );
    END IF;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Comentario de auditoría
COMMENT ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) 
IS 'Unified notification function. Order: (user, title, body, type, data, priority, category, sched)';
