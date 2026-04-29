-- ============================================================
-- 🛡️ SHAREWAY ELITE: REPARACIÓN MAESTRA DE NOTIFICACIONES
-- Soluciona el error de firma de 6 argumentos
-- ============================================================

-- 1. LIMPIEZA TOTAL
DO $$
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'create_notification' AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 2. VERSIÓN MAESTRA (5 Argumentos - JSONB)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (p_user_id, p_type, p_title, p_body, p_data)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. VERSIÓN ESPECÍFICA PARA EL ERROR (6 Argumentos: UUID, TEXT, TEXT, TEXT, JSON, INTEGER)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_arg2 TEXT,
    p_arg3 TEXT,
    p_arg4 TEXT,
    p_data JSON,
    p_arg6 INTEGER
) RETURNS UUID AS $$
BEGIN
    RETURN public.create_notification(p_user_id, p_arg2, p_arg3, p_arg4, p_data::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. VERSIÓN DE COMPATIBILIDAD (4 Argumentos)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT
) RETURNS UUID AS $$
BEGIN
    RETURN public.create_notification(p_user_id, p_type, p_title, p_body, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. PERMISOS (Especificando firmas para evitar error "not unique")
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSON, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSON, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT) TO service_role;
