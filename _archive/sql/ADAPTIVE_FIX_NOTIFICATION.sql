-- ==========================================
-- ADAPTIVE FIX: CREATE_NOTIFICATION FUNCTION
-- ==========================================
-- First, check the actual table structure and adapt the function

-- Check actual table structure (you should run this first)
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'notifications' AND table_schema = 'public' ORDER BY column_name;

-- Based on the error, it seems the table has different columns.
-- Let's create a function that adapts to the actual structure.

-- Drop all existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.create_notification;
DROP FUNCTION IF EXISTS public.create_notification(UUID);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER);

-- Create adaptive function that works with the actual table structure
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
    v_column_exists BOOLEAN;
BEGIN
    v_expires_at := NOW() + (p_expires_days || ' days')::INTERVAL;
    
    -- Check if 'message' column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' 
            AND table_schema = 'public' 
            AND column_name = 'message'
    ) INTO v_column_exists;
    
    -- Insert based on actual table structure
    IF v_column_exists THEN
        -- Use 'message' column (new structure)
        INSERT INTO public.notifications(
            user_id, title, message, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
        ) RETURNING id INTO v_notification_id;
    ELSE
        -- Use 'content' column (old structure)
        INSERT INTO public.notifications(
            user_id, title, content, type, data, priority, expires_at
        ) VALUES (
            p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
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
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND table_schema = 'public' AND column_name = 'message')
        THEN message
        ELSE content
    END as message,
    type,
    priority,
    created_at,
    expires_at
FROM public.notifications 
WHERE user_id = '550e8400-e29b-11d5-9b2d-0242ac120003'
ORDER BY created_at DESC
LIMIT 5;
