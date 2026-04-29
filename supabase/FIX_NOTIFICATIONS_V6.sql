-- ============================================================
-- 🛡️ SHAREWAY ELITE: REPARACIÓN MAESTRA DE NOTIFICACIONES V6
-- Soluciona el error de firma de 6 argumentos y protege contra IDs basura
-- ============================================================

-- 1. LIMPIEZA ATÓMICA
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

-- 2. VERSIÓN MEGA-COMPATIBLE (Exactamente la que pide el sistema)
-- Firma: (uuid, unknown, text, unknown, json, integer)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_arg2 TEXT,
    p_arg3 TEXT,
    p_arg4 TEXT,
    p_data JSON,
    p_arg6 INTEGER DEFAULT 0
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Bloque de seguridad: si algo falla al insertar (ej: el usuario no existe),
    -- capturamos el error para no romper la transacción principal de los viajes.
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
        p_user_id,
        COALESCE(p_arg2, 'info'),
        COALESCE(p_arg3, 'Notificación'),
        COALESCE(p_arg4, ''),
        COALESCE(p_data::jsonb, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- Silenciamos el error para permitir que el flujo de la app siga
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. VERSIÓN ESTÁNDAR PARA LLAMADAS SIMPLES (Cae en la de arriba por defecto)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT DEFAULT 'info',
    p_title TEXT DEFAULT 'Notificación',
    p_body TEXT DEFAULT '',
    p_data JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
BEGIN
    RETURN public.create_notification(p_user_id, p_type, p_title, p_body, p_data::json, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PERMISOS EXPLÍCITOS
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSON, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSON, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
