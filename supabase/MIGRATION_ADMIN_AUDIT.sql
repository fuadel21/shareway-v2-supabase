-- ========================================================
-- MIGRACIÓN: ADMIN AUDIT LOG & SETTINGS HISTORY
-- Objetivo: Registrar qué administrador cambió cada valor y cuándo
-- ========================================================
-- 1. Crear tabla de Auditoría
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES public.profiles(id),
    admin_name TEXT,
    action TEXT NOT NULL,
    -- 'UPDATE_SETTING', 'RUN_MAINTENANCE', 'MAINTENANCE_MODE_TOGGLE'
    target_key TEXT,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Función para registrar auditoría (Interna)
CREATE OR REPLACE FUNCTION public.log_admin_action(
        p_action TEXT,
        p_target_key TEXT DEFAULT NULL,
        p_old_value JSONB DEFAULT NULL,
        p_new_value JSONB DEFAULT NULL
    ) RETURNS VOID AS $$
DECLARE v_admin_name TEXT;
BEGIN
SELECT display_name INTO v_admin_name
FROM public.profiles
WHERE id = auth.uid();
INSERT INTO public.platform_audit_logs (
        admin_id,
        admin_name,
        action,
        target_key,
        old_value,
        new_value
    )
VALUES (
        auth.uid(),
        v_admin_name,
        p_action,
        p_target_key,
        p_old_value,
        p_new_value
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Modificar update_platform_setting para auditar
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value JSONB) RETURNS JSON AS $$
DECLARE v_old_value JSONB;
BEGIN -- Capturar valor antiguo
SELECT value INTO v_old_value
FROM public.platform_settings
WHERE key = p_key;
UPDATE public.platform_settings
SET value = p_value,
    updated_at = NOW(),
    updated_by = auth.uid()
WHERE key = p_key;
-- Registrar en auditoría
PERFORM public.log_admin_action(
    CASE
        WHEN p_key = 'platform_maintenance_mode' THEN 'MAINTENANCE_MODE_TOGGLE'
        ELSE 'UPDATE_SETTING'
    END,
    p_key,
    v_old_value,
    p_value
);
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Modificar run_manual_maintenance_tasks para auditar
CREATE OR REPLACE FUNCTION public.run_manual_maintenance_tasks() RETURNS JSON AS $$
DECLARE v_count_notif INTEGER;
v_count_notif_expired INTEGER;
v_res JSON;
BEGIN -- Limpieza
DELETE FROM public.notifications
WHERE created_at < (NOW() - INTERVAL '30 days');
GET DIAGNOSTICS v_count_notif = ROW_COUNT;
v_res := json_build_object(
    'success',
    true,
    'notifications_cleaned',
    v_count_notif,
    'suspensions_lifted',
    0
);
-- Registrar en auditoría
PERFORM public.log_admin_action('RUN_MAINTENANCE', NULL, NULL, v_res);
RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. RPC para obtener logs (Para el nuevo Tab)
CREATE OR REPLACE FUNCTION public.get_platform_audit_logs(p_limit INTEGER DEFAULT 50) RETURNS JSON AS $$ BEGIN RETURN (
        SELECT json_agg(t)
        FROM (
                SELECT *
                FROM public.platform_audit_logs
                ORDER BY created_at DESC
                LIMIT p_limit
            ) t
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;