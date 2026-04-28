-- ==========================================
-- 20260506_ADVANCED_AUDIT_SYSTEM.sql
-- Auditoría Proactiva y Seguimiento de Operaciones Críticas (v2 Corregida)
-- ==========================================

-- 1. Función General de Auditoría Automática
CREATE OR REPLACE FUNCTION public.fn_audit_critical_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_admin_name TEXT;
BEGIN
    -- Intentar obtener el nombre del admin si es una operación autenticada
    SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = auth.uid();

    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO public.platform_audit_logs (admin_id, admin_name, action, target_key, old_value, new_value)
        VALUES (
            auth.uid(),
            COALESCE(v_admin_name, 'Sistema/Trigger'),
            TG_TABLE_NAME || '_UPDATE',
            NEW.id::text,
            to_jsonb(OLD),
            to_jsonb(NEW)
        );
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO public.platform_audit_logs (admin_id, admin_name, action, target_key, old_value)
        VALUES (
            auth.uid(),
            COALESCE(v_admin_name, 'Sistema/Trigger'),
            TG_TABLE_NAME || '_DELETE',
            OLD.id::text,
            to_jsonb(OLD)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Aplicar Auditoría Proactiva
DROP TRIGGER IF EXISTS tr_audit_wallets ON public.wallets;
CREATE TRIGGER tr_audit_wallets
AFTER UPDATE OF balance ON public.wallets
FOR EACH ROW WHEN (auth.role() = 'authenticated')
EXECUTE FUNCTION public.fn_audit_critical_changes();

DROP TRIGGER IF EXISTS tr_audit_profiles_verification ON public.profiles;
CREATE TRIGGER tr_audit_profiles_verification
AFTER UPDATE OF verification, role ON public.profiles
FOR EACH ROW WHEN (auth.role() = 'authenticated')
EXECUTE FUNCTION public.fn_audit_critical_changes();

-- 3. Nueva RPC para obtener logs filtrados (LIMPIEZA PREVIA PARA EVITAR 42P13)
DROP FUNCTION IF EXISTS public.get_filtered_audit_logs(text, integer);

CREATE OR REPLACE FUNCTION public.get_filtered_audit_logs(p_category TEXT DEFAULT 'all', p_limit INTEGER DEFAULT 50)
RETURNS SETOF public.platform_audit_logs AS $$
BEGIN
    IF p_category = 'all' THEN
        RETURN QUERY SELECT * FROM public.platform_audit_logs ORDER BY created_at DESC LIMIT p_limit;
    ELSE
        RETURN QUERY SELECT * FROM public.platform_audit_logs
        WHERE action ILIKE '%' || p_category || '%'
        ORDER BY created_at DESC LIMIT p_limit;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_filtered_audit_logs(TEXT, INTEGER) TO authenticated;
