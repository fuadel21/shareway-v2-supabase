-- ========================================================
-- FIX CRÍTICO: Validación de Permisos de Admin
-- Middleware para asegurar que solo admins accedan a funciones críticas
-- ========================================================
-- 1. Añadir columna de rol a profiles si no existe
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'role'
) THEN
ALTER TABLE public.profiles
ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator'));
END IF;
END $$;
-- 2. Función helper para verificar rol de admin
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT NULL) RETURNS BOOLEAN AS $$
DECLARE v_user_role TEXT;
v_check_id UUID;
BEGIN v_check_id := COALESCE(p_user_id, auth.uid());
IF v_check_id IS NULL THEN RETURN FALSE;
END IF;
SELECT role INTO v_user_role
FROM public.profiles
WHERE id = v_check_id;
RETURN v_user_role = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Policy para restringir acceso a funciones de admin
DROP POLICY IF EXISTS admin_only_policy ON public.rpc_error_logs;
CREATE POLICY admin_only_policy ON public.rpc_error_logs FOR ALL USING (public.is_admin(auth.uid()));
-- 4. Wrapper seguro para get_platform_stats
CREATE OR REPLACE FUNCTION public.get_platform_stats_secure() RETURNS JSON AS $$
DECLARE v_stats JSON;
BEGIN -- Verificar permisos de admin
IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador';
END IF;
-- Ejecutar la función original
SELECT * INTO v_stats
FROM public.get_platform_stats();
RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. Wrapper seguro para request_platform_payout
CREATE OR REPLACE FUNCTION public.request_platform_payout_secure(p_amount DECIMAL DEFAULT NULL) RETURNS JSON AS $$
DECLARE v_result JSON;
BEGIN -- Verificar permisos de admin
IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador';
END IF;
-- Validar monto mínimo (100€)
IF p_amount IS NOT NULL
AND p_amount < 100 THEN RAISE EXCEPTION 'El monto mínimo para payout es de 100€';
END IF;
-- Ejecutar la función original
SELECT * INTO v_result
FROM public.request_platform_payout(p_amount);
RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. Auditoría de acciones de admin
CREATE OR REPLACE FUNCTION public.log_admin_action(
        p_action TEXT,
        p_details JSONB DEFAULT '{}'::jsonb,
        p_target_user_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_admin_id UUID := auth.uid();
BEGIN -- Verificar que sea admin
IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador';
END IF;
-- Insertar log de auditoría
INSERT INTO public.admin_audit_logs (
        admin_id,
        action,
        details,
        target_user_id,
        created_at
    )
VALUES (
        v_admin_id,
        p_action,
        p_details,
        p_target_user_id,
        NOW()
    );
RETURN json_build_object('success', true, 'message', 'Acción registrada');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 7. Crear tabla de auditoría de admin si no existe
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE
    SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 8. Índices para auditoría
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs(action);
-- 9. Rate limiting para acciones críticas de admin
CREATE OR REPLACE FUNCTION public.check_admin_rate_limit(
        p_action TEXT,
        p_window_minutes INTEGER DEFAULT 60,
        p_max_actions INTEGER DEFAULT 10
    ) RETURNS BOOLEAN AS $$
DECLARE v_action_count INTEGER;
v_admin_id UUID := auth.uid();
BEGIN -- Verificar que sea admin
IF NOT public.is_admin() THEN RETURN FALSE;
END IF;
-- Contar acciones en la ventana de tiempo
SELECT COUNT(*) INTO v_action_count
FROM public.admin_audit_logs
WHERE admin_id = v_admin_id
    AND action = p_action
    AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;
RETURN v_action_count < p_max_actions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 10. Wrapper con rate limiting para payout
CREATE OR REPLACE FUNCTION public.request_platform_payout_with_rate_limit(p_amount DECIMAL DEFAULT NULL) RETURNS JSON AS $$
DECLARE v_result JSON;
BEGIN -- Verificar permisos de admin
IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador';
END IF;
-- Verificar rate limiting (máximo 5 payouts por hora)
IF NOT public.check_admin_rate_limit('payout', 60, 5) THEN RAISE EXCEPTION 'Límite de payouts alcanzado. Máximo 5 por hora.';
END IF;
-- Validar monto mínimo
IF p_amount IS NOT NULL
AND p_amount < 100 THEN RAISE EXCEPTION 'El monto mínimo para payout es de 100€';
END IF;
-- Registrar acción de auditoría
PERFORM public.log_admin_action(
    'request_payout',
    json_build_object('amount', p_amount),
    NULL
);
-- Ejecutar payout
SELECT * INTO v_result
FROM public.request_platform_payout(p_amount);
RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Comentarios para auditoría
COMMENT ON FUNCTION public.is_admin(UUID) IS 'Verifica si un usuario tiene rol de admin';
COMMENT ON FUNCTION public.get_platform_stats_secure IS 'Wrapper seguro para stats con validación de admin';
COMMENT ON FUNCTION public.request_platform_payout_secure IS 'Wrapper seguro para payout con validación de admin y monto mínimo';
COMMENT ON TABLE public.admin_audit_logs IS 'Auditoría de todas las acciones de administradores';