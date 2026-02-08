-- ==========================================
-- FIX: CREATE_NOTIFICATION FUNCTION
-- ==========================================
-- Fix parameter type issues and ensure compatibility

-- Drop existing function with exact signature to avoid ambiguity
DROP FUNCTION IF EXISTS public.create_notification(
    p_user_id UUID,
    p_title TEXT,
    p_message TEXT,
    p_type TEXT,
    p_data JSONB,
    p_priority INTEGER,
    p_expires_days INTEGER
);

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
-- VERIFY ALL FUNCTIONS
-- ==========================================

-- Check all notification-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%notification%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- Check all message-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%message%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- Check all dashboard-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%dashboard%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;
    
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
-- VERIFY ALL FUNCTIONS
-- ==========================================

-- Check all notification-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%notification%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- Check all message-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%message%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- Check all dashboard-related functions
SELECT 
    proname,
    proargnames,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname LIKE '%dashboard%' 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- ==========================================
-- INSTRUCTIONS
-- ==========================================
/*
FIX FOR CREATE_NOTIFICATION FUNCTION:

PROBLEM:
- Function exists but has wrong parameter types
- PostgreSQL can't match function signature
- Need to drop and recreate with correct types

SOLUTION:
1. Drop existing function with wrong signature
2. Create new function with correct parameter types
3. Grant permissions
4. Test the function

EXPECTED RESULT:
- Function works with correct parameter types
- Test notification created successfully
- All notification functions verified

HOW TO USE:
1. Execute this script in Supabase SQL Editor
2. Verify the test notification result
3. Check all related functions
4. Test in frontend if needed
*/
