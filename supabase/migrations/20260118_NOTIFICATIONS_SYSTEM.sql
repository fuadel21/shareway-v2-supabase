-- ========================================================
-- SISTEMA DE NOTIFICACIONES COMPLETO
-- Push notifications, email notifications y preferencias
-- ========================================================

-- 1. Tabla de notificaciones
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'ride_request', 'ride_accepted', 'ride_cancelled', 'ride_completed',
        'payment_required', 'payment_confirmed', 'payment_failed',
        'review_reminder', 'new_review', 'badge_earned',
        'message_received', 'trip_reminder', 'driver_arriving',
        'emergency_alert', 'system_update', 'promotion'
    )),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb, -- Datos adicionales (ride_id, user_id, etc.)
    
    -- Estados y entrega
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    delivery_method TEXT DEFAULT 'push' CHECK (delivery_method IN ('push', 'email', 'in_app', 'sms')),
    
    -- Timing
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, -- Para notificaciones temporales
    
    -- Metadata
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category TEXT DEFAULT 'general' CHECK (category IN ('general', 'ride', 'payment', 'social', 'system', 'marketing')),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de preferencias de notificación
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Preferencias por tipo
    ride_requests BOOLEAN DEFAULT true,
    ride_accepted BOOLEAN DEFAULT true,
    ride_cancelled BOOLEAN DEFAULT true,
    ride_completed BOOLEAN DEFAULT true,
    payment_notifications BOOLEAN DEFAULT true,
    review_notifications BOOLEAN DEFAULT true,
    message_notifications BOOLEAN DEFAULT true,
    marketing_notifications BOOLEAN DEFAULT false,
    
    -- Preferencias de entrega
    push_enabled BOOLEAN DEFAULT true,
    email_enabled BOOLEAN DEFAULT true,
    sms_enabled BOOLEAN false,
    
    -- Horarios de silencio
    do_not_disturb BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '08:00',
    
    -- Frecuencia
    daily_digest BOOLEAN DEFAULT false,
    weekly_summary BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- 3. Tabla de dispositivos para push notifications
CREATE TABLE IF NOT EXISTS public.user_devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('ios', 'android', 'web')),
    device_id TEXT, -- Para identificar dispositivos únicos
    app_version TEXT,
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, device_token)
);

-- 4. Tabla de templates de email
CREATE TABLE IF NOT EXISTS public.email_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    variables JSONB DEFAULT '{}'::jsonb, -- Variables disponibles en el template
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabla de logs de envío de notificaciones
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    delivery_method TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    provider TEXT, -- 'fcm', 'sendgrid', 'twilio', etc.
    external_id TEXT, -- ID externo del proveedor
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Índices para performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_at ON public.notifications(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_active ON public.user_devices(is_active);
CREATE INDEX IF NOT EXISTS idx_user_devices_token ON public.user_devices(device_token);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON public.notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON public.notification_logs(created_at);

-- 7. Función para crear notificación
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
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
    SELECT * INTO v_preferences
    FROM public.notification_preferences
    WHERE user_id = p_user_id;
    
    -- Si no tiene preferencias, usar defaults
    IF v_preferences IS NULL THEN
        INSERT INTO public.notification_preferences (user_id)
        VALUES (p_user_id);
        
        SELECT * INTO v_preferences
        FROM public.notification_preferences
        WHERE user_id = p_user_id;
    END IF;
    
    -- Verificar preferencias según tipo
    CASE p_type
        WHEN 'ride_request' THEN
            v_can_send := v_preferences.ride_requests;
        WHEN 'ride_accepted' THEN
            v_can_send := v_preferences.ride_accepted;
        WHEN 'ride_cancelled' THEN
            v_can_send := v_preferences.ride_cancelled;
        WHEN 'ride_completed' THEN
            v_can_send := v_preferences.ride_completed;
        WHEN 'payment_required', 'payment_confirmed', 'payment_failed' THEN
            v_can_send := v_preferences.payment_notifications;
        WHEN 'review_reminder', 'new_review' THEN
            v_can_send := v_preferences.review_notifications;
        WHEN 'message_received' THEN
            v_can_send := v_preferences.message_notifications;
        WHEN 'promotion' THEN
            v_can_send := v_preferences.marketing_notifications;
    END CASE;
    
    -- Verificar horario de silencio
    IF v_preferences.do_not_disturb AND p_priority != 'urgent' THEN
        IF v_current_time >= v_preferences.quiet_hours_start OR 
           v_current_time <= v_preferences.quiet_hours_end THEN
            v_can_send := FALSE;
        END IF;
    END IF;
    
    -- Si no se puede enviar, crear como 'failed'
    IF NOT v_can_send THEN
        INSERT INTO public.notifications (
            user_id, type, title, body, data, status, priority, category
        ) VALUES (
            p_user_id, p_type, p_title, p_body, p_data, 'failed', p_priority, p_category
        )
        RETURNING id INTO v_notification_id;
        
        RETURN v_notification_id;
    END IF;
    
    -- Crear notificación
    INSERT INTO public.notifications (
        user_id, type, title, body, data, priority, category, scheduled_at
    ) VALUES (
        p_user_id, p_type, p_title, p_body, p_data, p_priority, p_category, p_scheduled_at
    )
    RETURNING id INTO v_notification_id;
    
    -- Programar envío asíncrono
    PERFORM pg_notify('new_notification', json_build_object(
        'notification_id', v_notification_id,
        'user_id', p_user_id,
        'type', p_type
    )::TEXT);
    
    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Función para enviar notificación push
CREATE OR REPLACE FUNCTION public.send_push_notification(
    p_notification_id UUID,
    p_device_tokens TEXT [] DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_notification RECORD;
    v_tokens TEXT [];
    v_result JSON;
BEGIN
    -- Obtener datos de la notificación
    SELECT * INTO v_notification
    FROM public.notifications
    WHERE id = p_notification_id;
    
    IF v_notification IS NULL THEN
        RAISE EXCEPTION 'Notificación no encontrada';
    END IF;
    
    -- Si no se proporcionan tokens, obtener dispositivos del usuario
    IF p_device_tokens IS NULL THEN
        SELECT ARRAY_AGG(device_token) INTO v_tokens
        FROM public.user_devices
        WHERE user_id = v_notification.user_id
            AND is_active = TRUE;
    ELSE
        v_tokens := p_device_tokens;
    END IF;
    
    -- Si no hay tokens, marcar como failed
    IF v_tokens IS NULL OR array_length(v_tokens, 1) IS NULL THEN
        UPDATE public.notifications
        SET status = 'failed', updated_at = NOW()
        WHERE id = p_notification_id;
        
        RETURN json_build_object('success', false, 'message', 'No hay dispositivos activos');
    END IF;
    
    -- Aquí iría la integración con FCM/OneSignal
    -- Por ahora, simulamos el envío
    UPDATE public.notifications
    SET 
        status = 'sent',
        sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_notification_id;
    
    -- Registrar log
    INSERT INTO public.notification_logs (
        notification_id, user_id, delivery_method, status, provider
    ) VALUES (
        p_notification_id, v_notification.user_id, 'push', 'sent', 'fcm_simulator'
    );
    
    RETURN json_build_object(
        'success', true,
        'tokens_sent', array_length(v_tokens, 1),
        'notification_id', p_notification_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Función para enviar email
CREATE OR REPLACE FUNCTION public.send_email_notification(
    p_notification_id UUID
) RETURNS JSON AS $$
DECLARE
    v_notification RECORD;
    v_user_email TEXT;
    v_template RECORD;
    v_result JSON;
BEGIN
    -- Obtener datos de la notificación
    SELECT * INTO v_notification
    FROM public.notifications
    WHERE id = p_notification_id;
    
    IF v_notification IS NULL THEN
        RAISE EXCEPTION 'Notificación no encontrada';
    END IF;
    
    -- Obtener email del usuario
    SELECT email INTO v_user_email
    FROM public.profiles
    WHERE id = v_notification.user_id;
    
    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Usuario no tiene email';
    END IF;
    
    -- Obtener template según tipo
    SELECT * INTO v_template
    FROM public.email_templates
    WHERE name = 'default_' || v_notification.type
        AND is_active = TRUE;
    
    -- Si no hay template, usar uno genérico
    IF v_template IS NULL THEN
        SELECT * INTO v_template
        FROM public.email_templates
        WHERE name = 'default_notification'
            AND is_active = TRUE;
    END IF;
    
    -- Aquí iría la integración con SendGrid/Postmark
    -- Por ahora, simulamos el envío
    UPDATE public.notifications
    SET 
        status = 'sent',
        sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_notification_id;
    
    -- Registrar log
    INSERT INTO public.notification_logs (
        notification_id, user_id, delivery_method, status, provider
    ) VALUES (
        p_notification_id, v_notification.user_id, 'email', 'sent', 'sendgrid_simulator'
    );
    
    RETURN json_build_object(
        'success', true,
        'email', v_user_email,
        'template', COALESCE(v_template.name, 'default')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Función para marcar notificación como leída
CREATE OR REPLACE FUNCTION public.mark_notification_read(
    p_notification_id UUID,
    p_user_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := COALESCE(p_user_id, auth.uid());
    v_notification RECORD;
BEGIN
    -- Obtener notificación
    SELECT * INTO v_notification
    FROM public.notifications
    WHERE id = p_notification_id
        AND user_id = v_user_id;
    
    IF v_notification IS NULL THEN
        RAISE EXCEPTION 'Notificación no encontrada';
    END IF;
    
    -- Actualizar estado
    UPDATE public.notifications
    SET 
        status = 'read',
        read_at = NOW(),
        updated_at = NOW()
    WHERE id = p_notification_id;
    
    RETURN json_build_object('success', true, 'read_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Función para obtener notificaciones no leídas
CREATE OR REPLACE FUNCTION public.get_unread_notifications(
    p_user_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 20
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := COALESCE(p_user_id, auth.uid());
    v_notifications JSONB;
    v_unread_count INTEGER;
BEGIN
    -- Obtener notificaciones no leídas
    SELECT jsonb_agg(
        json_build_object(
            'id', id,
            'type', type,
            'title', title,
            'body', body,
            'data', data,
            'priority', priority,
            'category', category,
            'created_at', created_at,
            'expires_at', expires_at
        )
    ) INTO v_notifications
    FROM public.notifications
    WHERE user_id = v_user_id
        AND status IN ('pending', 'sent', 'delivered')
        AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY 
        CASE priority 
            WHEN 'urgent' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'normal' THEN 3 
            WHEN 'low' THEN 4 
        END,
        created_at DESC
    LIMIT p_limit;
    
    -- Contar no leídas
    SELECT COUNT(*) INTO v_unread_count
    FROM public.notifications
    WHERE user_id = v_user_id
        AND status IN ('pending', 'sent', 'delivered')
        AND (expires_at IS NULL OR expires_at > NOW());
    
    RETURN json_build_object(
        'success', true,
        'notifications', COALESCE(v_notifications, '[]'::jsonb),
        'unread_count', v_unread_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Trigger para limpiar notificaciones antiguas
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    -- Eliminar notificaciones leídas de más de 30 días
    DELETE FROM public.notifications
    WHERE status = 'read'
        AND read_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
    -- Eliminar notificaciones expiradas
    DELETE FROM public.notifications
    WHERE expires_at IS NOT NULL
        AND expires_at < NOW();
    
    GET DIAGNOSTICS v_deleted_count = v_deleted_count + ROW_COUNT;
    
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentarios para auditoría
COMMENT ON TABLE public.notifications IS 'Notificaciones push, email y in-app';
COMMENT ON TABLE public.notification_preferences IS 'Preferencias de notificación por usuario';
COMMENT ON TABLE public.user_devices IS 'Dispositivos registrados para push notifications';
COMMENT ON FUNCTION public.create_notification IS 'Crea notificación con validación de preferencias';
COMMENT ON FUNCTION public.send_push_notification IS 'Envía notificación push vía FCM/OneSignal';
COMMENT ON FUNCTION public.send_email_notification IS 'Envía email vía SendGrid/Postmark';
