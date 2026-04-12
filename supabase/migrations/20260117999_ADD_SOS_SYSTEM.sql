-- Emergency System Migration
-- Adds tables and functions for SOS features
-- 1. Emergency Contacts Table
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    relationship TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Emergency Alerts Log Table
CREATE TABLE IF NOT EXISTS public.emergency_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id),
    user_id UUID REFERENCES public.profiles(id),
    location JSONB,
    -- {lat, lng}
    status TEXT DEFAULT 'active',
    -- active, resolved, dismissed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
-- 3. RPC: trigger_emergency_alert
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(
        p_ride_id UUID,
        p_current_location JSONB DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_alert_id UUID;
BEGIN IF v_user_id IS NULL THEN RETURN json_build_object(
    'success',
    false,
    'error',
    'Usuario no autenticado'
);
END IF;
-- Insert Alert Record
INSERT INTO public.emergency_alerts (ride_id, user_id, location)
VALUES (p_ride_id, v_user_id, p_current_location)
RETURNING id INTO v_alert_id;
-- Return success
RETURN json_build_object(
    'success',
    true,
    'alertId',
    v_alert_id,
    'message',
    'Alerta registrada en el sistema'
);
EXCEPTION
WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. RLS Policies
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Users can manage their own emergency contacts" ON public.emergency_contacts FOR ALL USING (auth.uid() = user_id);
ALTER TABLE public.emergency_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own alerts" ON public.emergency_alerts;
CREATE POLICY "Users can view their own alerts" ON public.emergency_alerts FOR
SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "System can insert alerts" ON public.emergency_alerts;
CREATE POLICY "System can insert alerts" ON public.emergency_alerts FOR
INSERT WITH CHECK (auth.uid() = user_id);