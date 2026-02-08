-- ==========================================
-- WEEK 2: COMPLEMENTARY FEATURES (CLEAN & ROBUST REPAIR)
-- ==========================================
-- This script fixes schema issues and cleans up conflicting function definitions.
-- ==========================================
-- 0. CLEANUP CONFLICTING FUNCTIONS
-- ==========================================
-- Drop all possible variations of create_notification to resolve ambiguity
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT);
-- Drop other related functions to ensure clean recreation
DROP FUNCTION IF EXISTS public.get_user_notifications(UUID, INTEGER, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.mark_notification_read(UUID, UUID);
DROP FUNCTION IF EXISTS public.mark_all_notifications_read(UUID);
DROP FUNCTION IF EXISTS public.get_unread_notification_count(UUID);
DROP FUNCTION IF EXISTS public.send_message(UUID, UUID, UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.get_conversation_messages(UUID, UUID, UUID, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.mark_messages_read(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.get_user_conversations(UUID);
-- ==========================================
-- 1. SCHEMA REPAIR - MESSAGES TABLE
-- ==========================================
DO $$ BEGIN -- 1. Ensure 'messages' table exists
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Add 'sender_id' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'sender_id'
) THEN
ALTER TABLE public.messages
ADD COLUMN sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
END IF;
-- 3. Add 'receiver_id' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'receiver_id'
) THEN
ALTER TABLE public.messages
ADD COLUMN receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
END IF;
-- 4. Add 'content' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'content'
) THEN
ALTER TABLE public.messages
ADD COLUMN content TEXT;
END IF;
-- 5. Add 'ride_id' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'ride_id'
) THEN
ALTER TABLE public.messages
ADD COLUMN ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE;
END IF;
-- 6. Add 'request_id' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'request_id'
) THEN
ALTER TABLE public.messages
ADD COLUMN request_id UUID REFERENCES public.ride_requests(id) ON DELETE CASCADE;
END IF;
-- 7. Add 'message_type' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'message_type'
) THEN
ALTER TABLE public.messages
ADD COLUMN message_type TEXT DEFAULT 'text' CHECK (
        message_type IN ('text', 'location', 'system', 'ride_update')
    );
END IF;
-- 8. Add 'metadata' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'metadata'
) THEN
ALTER TABLE public.messages
ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
END IF;
-- 9. Add 'read_at' if missing
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
        AND column_name = 'read_at'
) THEN
ALTER TABLE public.messages
ADD COLUMN read_at TIMESTAMPTZ;
END IF;
END $$;
-- ==========================================
-- 2. PERSISTENT NOTIFICATION SYSTEM
-- ==========================================
-- Create comprehensive notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN (
            'info',
            'success',
            'warning',
            'error',
            'ride_update',
            'request_update',
            'chat_message',
            'system'
        )
    ),
    data JSONB DEFAULT '{}'::JSONB,
    read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    priority INTEGER DEFAULT 1 CHECK (
        priority BETWEEN 1 AND 5
    )
);
-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, read_at)
WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_type_priority ON public.notifications(type, priority DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires ON public.notifications(expires_at);
-- Function to create notification
CREATE OR REPLACE FUNCTION public.create_notification(
        p_user_id UUID,
        p_title TEXT,
        p_message TEXT,
        p_type TEXT DEFAULT 'info',
        p_data JSONB DEFAULT '{}'::JSONB,
        p_priority INTEGER DEFAULT 1,
        p_expires_days INTEGER DEFAULT 30
    ) RETURNS UUID AS $$
DECLARE v_notification_id UUID;
v_expires_at TIMESTAMPTZ;
BEGIN v_expires_at := NOW() + (p_expires_days || ' days')::INTERVAL;
INSERT INTO public.notifications(
        user_id,
        title,
        message,
        type,
        data,
        priority,
        expires_at
    )
VALUES (
        p_user_id,
        p_title,
        p_message,
        p_type,
        p_data,
        p_priority,
        v_expires_at
    )
RETURNING id INTO v_notification_id;
RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get user notifications with pagination
CREATE OR REPLACE FUNCTION public.get_user_notifications(
        p_user_id UUID,
        p_limit INTEGER DEFAULT 20,
        p_offset INTEGER DEFAULT 0,
        p_unread_only BOOLEAN DEFAULT false
    ) RETURNS TABLE (
        id UUID,
        title TEXT,
        message TEXT,
        type TEXT,
        data JSONB,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        priority INTEGER,
        is_read BOOLEAN
    ) AS $$ BEGIN RETURN QUERY
SELECT n.id,
    n.title,
    n.message,
    n.type,
    n.data,
    n.read_at,
    n.created_at,
    n.expires_at,
    n.priority,
    (n.read_at IS NOT NULL) as is_read
FROM public.notifications n
WHERE n.user_id = p_user_id
    AND n.expires_at > NOW()
    AND (
        NOT p_unread_only
        OR n.read_at IS NULL
    )
ORDER BY n.priority DESC,
    n.created_at DESC
LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Function to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(
        p_notification_id UUID,
        p_user_id UUID
    ) RETURNS BOOLEAN AS $$
DECLARE v_updated BOOLEAN;
BEGIN
UPDATE public.notifications
SET read_at = NOW(),
    updated_at = NOW()
WHERE id = p_notification_id
    AND user_id = p_user_id
    AND read_at IS NULL;
GET DIAGNOSTICS v_updated = ROW_COUNT;
RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to mark all notifications as read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id UUID) RETURNS INTEGER AS $$
DECLARE v_updated_count INTEGER;
BEGIN
UPDATE public.notifications
SET read_at = NOW(),
    updated_at = NOW()
WHERE user_id = p_user_id
    AND read_at IS NULL;
GET DIAGNOSTICS v_updated_count = ROW_COUNT;
RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get unread notification count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id UUID) RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
SELECT COUNT(*) INTO v_count
FROM public.notifications
WHERE user_id = p_user_id
    AND read_at IS NULL
    AND expires_at > NOW();
RETURN v_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- ==========================================
-- 3. BASIC CHAT SYSTEM
-- ==========================================
-- Create indexes for messages (Tables repaired above)
CREATE INDEX IF NOT EXISTS idx_messages_ride_created ON public.messages(ride_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_request_created ON public.messages(request_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON public.messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON public.messages(receiver_id, read_at)
WHERE read_at IS NULL;
-- Function to send message
CREATE OR REPLACE FUNCTION public.send_message(
        p_ride_id UUID,
        p_request_id UUID,
        p_receiver_id UUID,
        p_content TEXT,
        p_message_type TEXT DEFAULT 'text',
        p_metadata JSONB DEFAULT '{}'::JSONB
    ) RETURNS UUID AS $$
DECLARE v_sender_id UUID := auth.uid();
v_message_id UUID;
v_ride_exists BOOLEAN;
v_request_exists BOOLEAN;
BEGIN -- Validate authentication
IF v_sender_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Validate ride or request exists and user has access
IF p_ride_id IS NOT NULL THEN
SELECT EXISTS(
        SELECT 1
        FROM public.rides
        WHERE id = p_ride_id
            AND (
                driver_id = v_sender_id
                OR participant_ids @> ARRAY [v_sender_id]
            )
    ) INTO v_ride_exists;
IF NOT v_ride_exists THEN RAISE EXCEPTION 'No tienes acceso a este viaje';
END IF;
END IF;
IF p_request_id IS NOT NULL THEN
SELECT EXISTS(
        SELECT 1
        FROM public.ride_requests
        WHERE id = p_request_id
            AND (
                requester_id = v_sender_id
                OR driver_id = v_sender_id
            )
    ) INTO v_request_exists;
IF NOT v_request_exists THEN RAISE EXCEPTION 'No tienes acceso a esta solicitud';
END IF;
END IF;
-- Insert message
INSERT INTO public.messages(
        ride_id,
        request_id,
        sender_id,
        receiver_id,
        content,
        message_type,
        metadata
    )
VALUES (
        p_ride_id,
        p_request_id,
        v_sender_id,
        p_receiver_id,
        p_content,
        p_message_type,
        p_metadata
    )
RETURNING id INTO v_message_id;
-- Create notification for receiver
PERFORM public.create_notification(
    p_receiver_id,
    'Nuevo Mensaje',
    SUBSTRING(p_content, 1, 100),
    'chat_message',
    json_build_object(
        'message_id',
        v_message_id,
        'sender_id',
        v_sender_id,
        'ride_id',
        p_ride_id,
        'request_id',
        p_request_id
    ),
    3,
    7
);
RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get conversation messages
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
        p_user_id UUID,
        p_other_user_id UUID,
        p_ride_id UUID DEFAULT NULL,
        p_request_id UUID DEFAULT NULL,
        p_limit INTEGER DEFAULT 50,
        p_offset INTEGER DEFAULT 0
    ) RETURNS TABLE (
        id UUID,
        sender_id UUID,
        receiver_id UUID,
        content TEXT,
        message_type TEXT,
        metadata JSONB,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ,
        is_sent BOOLEAN
    ) AS $$ BEGIN RETURN QUERY
SELECT m.id,
    m.sender_id,
    m.receiver_id,
    m.content,
    m.message_type,
    m.metadata,
    m.read_at,
    m.created_at,
    (m.sender_id = p_user_id) as is_sent
FROM public.messages m
WHERE (
        (
            m.sender_id = p_user_id
            AND m.receiver_id = p_other_user_id
        )
        OR (
            m.sender_id = p_other_user_id
            AND m.receiver_id = p_user_id
        )
    )
    AND (
        p_ride_id IS NULL
        OR m.ride_id = p_ride_id
    )
    AND (
        p_request_id IS NULL
        OR m.request_id = p_request_id
    )
ORDER BY m.created_at ASC
LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Function to mark messages as read
CREATE OR REPLACE FUNCTION public.mark_messages_read(
        p_user_id UUID,
        p_other_user_id UUID,
        p_ride_id UUID DEFAULT NULL,
        p_request_id UUID DEFAULT NULL
    ) RETURNS INTEGER AS $$
DECLARE v_updated_count INTEGER;
BEGIN
UPDATE public.messages
SET read_at = NOW(),
    updated_at = NOW()
WHERE receiver_id = p_user_id
    AND sender_id = p_other_user_id
    AND read_at IS NULL
    AND (
        p_ride_id IS NULL
        OR ride_id = p_ride_id
    )
    AND (
        p_request_id IS NULL
        OR request_id = p_request_id
    );
GET DIAGNOSTICS v_updated_count = ROW_COUNT;
RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get user conversations
CREATE OR REPLACE FUNCTION public.get_user_conversations(p_user_id UUID) RETURNS TABLE (
        other_user_id UUID,
        other_user_display_name TEXT,
        other_user_avatar TEXT,
        last_message TEXT,
        last_message_time TIMESTAMPTZ,
        unread_count INTEGER,
        ride_id UUID,
        request_id UUID
    ) AS $$ BEGIN RETURN QUERY WITH recent_messages AS (
        SELECT DISTINCT ON (
                CASE
                    WHEN m.sender_id = p_user_id THEN m.receiver_id
                    ELSE m.sender_id
                END
            ) CASE
                WHEN m.sender_id = p_user_id THEN m.receiver_id
                ELSE m.sender_id
            END as other_user_id,
            m.content,
            m.created_at,
            m.ride_id,
            m.request_id,
            m.read_at
        FROM public.messages m
        WHERE m.sender_id = p_user_id
            OR m.receiver_id = p_user_id
        ORDER BY CASE
                WHEN m.sender_id = p_user_id THEN m.receiver_id
                ELSE m.sender_id
            END,
            m.created_at DESC
    ),
    unread_counts AS (
        SELECT CASE
                WHEN m.sender_id = p_user_id THEN m.receiver_id
                ELSE m.sender_id
            END as other_user_id,
            COUNT(*) as unread_count
        FROM public.messages m
        WHERE m.receiver_id = p_user_id
            AND m.read_at IS NULL
        GROUP BY CASE
                WHEN m.sender_id = p_user_id THEN m.receiver_id
                ELSE m.sender_id
            END
    )
SELECT rm.other_user_id,
    COALESCE(p.display_name, 'Usuario') as other_user_display_name,
    COALESCE(p.photo_url, p.avatar_url, '') as other_user_avatar,
    rm.content as last_message,
    rm.created_at as last_message_time,
    COALESCE(uc.unread_count, 0) as unread_count,
    rm.ride_id,
    rm.request_id
FROM recent_messages rm
    LEFT JOIN public.profiles p ON p.id = rm.other_user_id
    LEFT JOIN unread_counts uc ON uc.other_user_id = rm.other_user_id
ORDER BY rm.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- ==========================================
-- 4. REAL-TIME DASHBOARD ENHANCEMENTS
-- ==========================================
-- Create dashboard activity log table
CREATE TABLE IF NOT EXISTS public.dashboard_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL CHECK (
        activity_type IN (
            'ride_created',
            'ride_updated',
            'request_created',
            'request_accepted',
            'request_cancelled',
            'location_update',
            'message_sent',
            'user_login'
        )
    ),
    activity_data JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Create indexes for dashboard activity
CREATE INDEX IF NOT EXISTS idx_dashboard_activity_user_created ON public.dashboard_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_activity_type_created ON public.dashboard_activity(activity_type, created_at DESC);
-- Function to log dashboard activity
CREATE OR REPLACE FUNCTION public.log_dashboard_activity(
        p_user_id UUID,
        p_activity_type TEXT,
        p_activity_data JSONB DEFAULT '{}'::JSONB
    ) RETURNS UUID AS $$
DECLARE v_activity_id UUID;
BEGIN
INSERT INTO public.dashboard_activity(user_id, activity_type, activity_data)
VALUES (p_user_id, p_activity_type, p_activity_data)
RETURNING id INTO v_activity_id;
RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get dashboard activity feed
CREATE OR REPLACE FUNCTION public.get_dashboard_activity_feed(
        p_user_id UUID,
        p_limit INTEGER DEFAULT 20,
        p_offset INTEGER DEFAULT 0
    ) RETURNS TABLE (
        id UUID,
        activity_type TEXT,
        activity_data JSONB,
        created_at TIMESTAMPTZ,
        relative_time TEXT
    ) AS $$ BEGIN RETURN QUERY
SELECT da.id,
    da.activity_type,
    da.activity_data,
    da.created_at,
    CASE
        WHEN da.created_at > NOW() - INTERVAL '1 minute' THEN 'ahora'
        WHEN da.created_at > NOW() - INTERVAL '1 hour' THEN EXTRACT(
            EPOCH
            FROM (NOW() - da.created_at)
        ) / 60 || ' minutos'
        WHEN da.created_at > NOW() - INTERVAL '1 day' THEN EXTRACT(
            EPOCH
            FROM (NOW() - da.created_at)
        ) / 3600 || ' horas'
        WHEN da.created_at > NOW() - INTERVAL '7 days' THEN EXTRACT(
            EPOCH
            FROM (NOW() - da.created_at)
        ) / 86400 || ' días'
        ELSE EXTRACT(
            DAY
            FROM (NOW() - da.created_at)
        ) || ' días'
    END as relative_time
FROM public.dashboard_activity da
WHERE da.user_id = p_user_id
    AND da.created_at > NOW() - INTERVAL '7 days'
ORDER BY da.created_at DESC
LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Function to get real-time dashboard stats
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_user_id UUID) RETURNS JSONB AS $$
DECLARE v_active_rides INTEGER;
v_pending_requests INTEGER;
v_unread_messages INTEGER;
v_unread_notifications INTEGER;
v_recent_activity INTEGER;
BEGIN -- Count active rides
SELECT COUNT(*) INTO v_active_rides
FROM public.rides
WHERE (
        driver_id = p_user_id
        OR participant_ids @> ARRAY [p_user_id]
    )
    AND status IN ('scheduled', 'active', 'in_progress');
-- Count pending requests
SELECT COUNT(*) INTO v_pending_requests
FROM public.ride_requests
WHERE requester_id = p_user_id
    AND status = 'pending';
-- Count unread messages
SELECT COUNT(*) INTO v_unread_messages
FROM public.messages
WHERE receiver_id = p_user_id
    AND read_at IS NULL;
-- Count unread notifications
SELECT public.get_unread_notification_count(p_user_id) INTO v_unread_notifications;
-- Count recent activity (last 24 hours)
SELECT COUNT(*) INTO v_recent_activity
FROM public.dashboard_activity
WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '24 hours';
RETURN json_build_object(
    'active_rides',
    v_active_rides,
    'pending_requests',
    v_pending_requests,
    'unread_messages',
    v_unread_messages,
    'unread_notifications',
    v_unread_notifications,
    'recent_activity',
    v_recent_activity,
    'last_updated',
    NOW()
);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- ==========================================
-- 5. NOTIFICATION TRIGGERS FOR AUTOMATIC UPDATES
-- ==========================================
-- Trigger for ride updates
CREATE OR REPLACE FUNCTION public.notify_ride_update() RETURNS TRIGGER AS $$ BEGIN -- Create notification for driver
    IF TG_OP = 'UPDATE'
    AND OLD.status != NEW.status THEN PERFORM public.create_notification(
        NEW.driver_id,
        'Estado de Viaje Actualizado',
        format(
            'Tu viaje %s ha cambiado de estado a %s',
            COALESCE(NEW.origin->>'address', 'destino desconocido'),
            NEW.status
        ),
        'ride_update',
        json_build_object(
            'ride_id',
            NEW.id,
            'old_status',
            OLD.status,
            'new_status',
            NEW.status
        ),
        3
    );
-- Create notifications for passengers
IF NEW.participant_ids IS NOT NULL THEN
INSERT INTO public.notifications(user_id, title, message, type, data, priority)
SELECT participant_id,
    'Estado de Viaje Actualizado',
    format(
        'Tu viaje %s ha cambiado de estado a %s',
        COALESCE(NEW.origin->>'address', 'destino desconocido'),
        NEW.status
    ),
    'ride_update',
    json_build_object(
        'ride_id',
        NEW.id,
        'old_status',
        OLD.status,
        'new_status',
        NEW.status
    ),
    3
FROM unnest(NEW.participant_ids) AS participant_id
WHERE participant_id != NEW.driver_id;
END IF;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Drop and recreate trigger for ride updates to ensure it's fresh
DROP TRIGGER IF EXISTS trigger_notify_ride_update ON public.rides;
CREATE TRIGGER trigger_notify_ride_update
AFTER
UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.notify_ride_update();
-- Trigger for request updates
CREATE OR REPLACE FUNCTION public.notify_request_update() RETURNS TRIGGER AS $$ BEGIN IF TG_OP = 'UPDATE'
    AND OLD.status != NEW.status THEN -- Notify requester
    PERFORM public.create_notification(
        NEW.requester_id,
        'Estado de Solicitud Actualizado',
        format(
            'Tu solicitud %s ha cambiado a %s',
            COALESCE(NEW.origin->>'address', 'destino desconocido'),
            NEW.status
        ),
        'request_update',
        json_build_object(
            'request_id',
            NEW.id,
            'old_status',
            OLD.status,
            'new_status',
            NEW.status
        ),
        3
    );
-- Notify driver if request was accepted
IF NEW.status = 'fulfilled'
AND NEW.driver_id IS NOT NULL THEN PERFORM public.create_notification(
    NEW.driver_id,
    'Solicitud Aceptada',
    format(
        'Has aceptado una solicitud de %s',
        COALESCE(NEW.origin->>'address', 'destino desconocido')
    ),
    'request_update',
    json_build_object(
        'request_id',
        NEW.id,
        'status',
        NEW.status
    ),
    3
);
END IF;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Drop and recreate trigger for request updates to ensure it's fresh
DROP TRIGGER IF EXISTS trigger_notify_request_update ON public.ride_requests;
CREATE TRIGGER trigger_notify_request_update
AFTER
UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.notify_request_update();
-- ==========================================
-- 6. GRANT PERMISSIONS
-- ==========================================
-- Notifications permissions
GRANT SELECT,
    INSERT,
    UPDATE ON public.notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count TO authenticated;
-- Messages permissions
GRANT SELECT,
    INSERT,
    UPDATE ON public.messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_conversations TO authenticated;
-- Dashboard permissions
GRANT SELECT,
    INSERT ON public.dashboard_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_dashboard_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_activity_feed TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated;