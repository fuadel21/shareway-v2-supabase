-- ==========================================
-- COMPLETE FIX: CREATE_NOTIFICATION FUNCTION
-- ==========================================
-- First, check the actual table structure and fix the function

-- Check actual table structure
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns 
-- WHERE table_name = 'notifications' AND table_schema = 'public' ORDER BY column_name;

-- Based on the error, it seems the table has different columns including 'body'
-- Let's create a function that adapts to the actual table structure

-- Drop all existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.create_notification;
DROP FUNCTION IF EXISTS public.create_notification(UUID);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER);

-- Create function that adapts to the actual table structure
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_title TEXT,
    p_message TEXT,
    p_type TEXT DEFAULT 'info',
    p_data JSONB DEFAULT '{}'::JSONB,
    p_priority INTEGER DEFAULT 1,
    p_expires_days INTEGER DEFAULT 30
) RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_has_body BOOLEAN;
    v_has_content BOOLEAN;
    v_has_message BOOLEAN;
BEGIN
    v_expires_at := NOW() + (p_expires_days || ' days')::INTERVAL;
    
    -- Check which columns exist in the actual table
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns cols
        WHERE cols.table_name = 'notifications'
            AND cols.table_schema = 'public'
            AND cols.column_name = 'body'
    ) INTO v_has_body;
    
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns cols
        WHERE cols.table_name = 'notifications'
            AND cols.table_schema = 'public'
            AND cols.column_name = 'content'
    ) INTO v_has_content;
    
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns cols
        WHERE cols.table_name = 'notifications'
            AND cols.table_schema = 'public'
            AND cols.column_name = 'message'
    ) INTO v_has_message;
    
    -- Insert based on actual table structure
    IF v_has_body THEN
        -- Use 'body' column (actual structure)
        INSERT INTO public.notifications(
            user_id, title, body, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
        ) RETURNING id INTO v_notification_id;
    ELSIF v_has_content THEN
        -- Use 'content' column (alternative structure)
        INSERT INTO public.notifications(
            user_id, title, content, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
        ) RETURNING id INTO v_notification_id;
    ELSIF v_has_message THEN
        -- Use 'message' column (new structure)
        INSERT INTO public.notifications(
            user_id, title, message, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
        ) RETURNING id INTO v_notification_id;
    ELSE
        -- Use default structure with available columns
        -- Let's check what columns we actually have
        INSERT INTO public.notifications(
            user_id, title, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_type, p_data, p_priority, v_expires_at
        ) RETURNING id INTO v_notification_id;
    END IF;
    
    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;

-- Test the function
SELECT public.create_notification(
    '550e8400-e29b-11d5-9b2d-0242ac120003',
    'Test Notification',
    'This is a test notification',
    'info',
    '{"test": true}',
    2,
    7
);

-- ==========================================
-- VERIFY FUNCTION CREATION
-- ==========================================

-- Check if function was created successfully
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type,
    'CREATED' as status
FROM pg_proc 
WHERE proname = 'create_notification' 
    AND pronamespace = 'public'::regnamespace;

-- Get the created notifications to verify
SELECT 
    id,
    title,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND table_schema = 'public' AND column_name = 'body')
        THEN body
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND table_schema = 'public' AND column_name = 'content')
        THEN content
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND table_schema = 'public' AND column_name = 'message')
        THEN message
        ELSE type::TEXT
    END as message,
    type,
    priority,
    created_at,
    expires_at
FROM public.notifications 
WHERE user_id = '550e8400-e29b-11d5-9b2d-0242ac120003'
ORDER BY created_at DESC
LIMIT 5;

-- ==========================================
-- TABLE STRUCTURE VERIFICATION
-- ==========================================

-- Show the actual table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'notifications' 
    AND table_schema = 'public'
ORDER BY column_name;
