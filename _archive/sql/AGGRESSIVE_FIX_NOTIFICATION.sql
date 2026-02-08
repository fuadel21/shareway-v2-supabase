-- ==========================================
-- AGGRESSIVE FIX: CREATE_NOTIFICATION FUNCTION
-- ==========================================
-- Drop ALL versions of the function to avoid ambiguity

-- Drop all functions with this name
DROP FUNCTION IF EXISTS public.create_notification;
DROP FUNCTION IF EXISTS public.create_notification(UUID);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER);

-- Create the correct version
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
BEGIN
    v_expires_at := NOW() + (p_expires_days || ' days')::INTERVAL;
    
    INSERT INTO public.notifications(
        user_id, title, message, type, data, priority, expires_at
    ) VALUES (
        p_user_id, p_title, p_message, p_type, p_data, p_priority, v_expires_at
    ) RETURNING id INTO v_notification_id;
    
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

-- Test the function again
SELECT public.create_notification(
    '550e8400-e29b-11d5-9b2d-0242ac120003',
    'Test Notification 2',
    'This is another test notification',
    'success',
    '{"test": true, "version": 2}',
    3,
    14
);

-- Get the created notifications
SELECT 
    id,
    title,
    message,
    type,
    priority,
    created_at,
    expires_at
FROM public.notifications 
WHERE user_id = '550e8400-e29b-11d5-9b2d-0242ac120003'
ORDER BY created_at DESC
LIMIT 5;
