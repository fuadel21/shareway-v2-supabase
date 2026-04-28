-- ==========================================
-- 20260506_MAINTENANCE_ENGINE.sql
-- Motor de Mantenimiento, Auditoría y Configuración Elite (v3 Inmune a errores de tipo)
-- ==========================================

-- 1. Asegurar Tabla de Auditoría
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES auth.users(id),
    admin_name TEXT,
    action TEXT NOT NULL,
    target_key TEXT,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Asegurar Tabla de Ajustes
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 🔧 REPARACIÓN: Añadir columna category si no existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='platform_settings' AND column_name='category') THEN
        ALTER TABLE public.platform_settings ADD COLUMN category TEXT DEFAULT 'General';
    END IF;
END $$;

-- Insertar/Actualizar valores iniciales
INSERT INTO public.platform_settings (key, value, description, category)
VALUES
('platform_maintenance_mode', 'false'::jsonb, 'Activa el bloqueo total de la app para usuarios', 'Sistema'),
('commission_rate', '10'::jsonb, 'Porcentaje de comisión de la plataforma', 'Finanzas'),
('co2_kg_per_km', '0.2'::jsonb, 'Kilogramos de CO2 ahorrados por kilómetro', 'Impacto')
ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, description = EXCLUDED.description;

-- 3. RPC: Diagnóstico de Salud (BORRADO PREVIO PARA EVITAR ERROR 42P13)
DROP FUNCTION IF EXISTS public.get_admin_health_dashboard();
CREATE OR REPLACE FUNCTION public.get_admin_health_dashboard()
RETURNS JSONB AS $$
DECLARE
    v_notifications_to_clean INTEGER;
    v_suspended_users INTEGER;
    v_disputes_pending INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_notifications_to_clean FROM public.notifications WHERE created_at < now() - interval '30 days';
    SELECT COUNT(*) INTO v_suspended_users FROM public.profiles WHERE role = 'suspended';
    v_disputes_pending := 0;

    RETURN jsonb_build_object(
        'notifications_to_clean', v_notifications_to_clean,
        'suspended_users', v_suspended_users,
        'disputes_pending', v_disputes_pending
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Ejecutar Mantenimiento Manual
DROP FUNCTION IF EXISTS public.run_manual_maintenance_tasks();
CREATE OR REPLACE FUNCTION public.run_manual_maintenance_tasks()
RETURNS JSONB AS $$
DECLARE
    v_notif_count INTEGER;
BEGIN
    DELETE FROM public.notifications WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_notif_count = ROW_COUNT;

    INSERT INTO public.platform_audit_logs (admin_id, admin_name, action, target_key, new_value)
    SELECT auth.uid(), p.full_name, 'manual_maintenance', 'all', jsonb_build_object('notifications_cleaned', v_notif_count)
    FROM public.profiles p WHERE p.id = auth.uid();

    RETURN jsonb_build_object('success', true, 'notifications_cleaned', v_notif_count, 'suspensions_lifted', 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: Gestión de Ajustes (Borrar firmas antiguas antes de crear)
DROP FUNCTION IF EXISTS public.get_platform_settings();
CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS SETOF public.platform_settings AS $$
BEGIN
    RETURN QUERY SELECT * FROM public.platform_settings ORDER BY category, key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.update_platform_setting(TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    v_old_value JSONB;
BEGIN
    SELECT value INTO v_old_value FROM public.platform_settings WHERE key = p_key;
    INSERT INTO public.platform_settings (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = p_value, updated_at = now();

    INSERT INTO public.platform_audit_logs (admin_id, admin_name, action, target_key, old_value, new_value)
    SELECT auth.uid(), p.full_name, 'update_setting', p_key, v_old_value, p_value
    FROM public.profiles p WHERE p.id = auth.uid();
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.get_platform_audit_logs(INTEGER);
CREATE OR REPLACE FUNCTION public.get_platform_audit_logs(p_limit INTEGER DEFAULT 20)
RETURNS SETOF public.platform_audit_logs AS $$
BEGIN
    RETURN QUERY SELECT * FROM public.platform_audit_logs ORDER BY created_at DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permisos Finales
GRANT ALL ON public.platform_audit_logs TO authenticated;
GRANT ALL ON public.platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_health_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_manual_maintenance_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_setting(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_audit_logs(INTEGER) TO authenticated;
