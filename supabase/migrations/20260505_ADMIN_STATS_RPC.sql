-- ==========================================
-- 20260505_ADMIN_STATS_RPC.sql
-- Motor de estadísticas para el Dashboard Elite (v3 Inmune a errores)
-- ==========================================

-- 1. Asegurar que la columna role existe y tu usuario es admin
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
UPDATE public.profiles SET role = 'admin' WHERE email = 'fuadel21@hotmail.com';

-- 2. Función recreada con validación redundante
CREATE OR REPLACE FUNCTION public.get_platform_admin_stats()
RETURNS JSONB AS $$
DECLARE
    v_total_revenue DECIMAL;
    v_platform_commissions DECIMAL;
    v_total_rides INTEGER;
    v_active_users INTEGER;
    v_co2_saved DECIMAL;
    v_caller_email TEXT;
BEGIN
    -- Obtener email del token de sesión para máxima seguridad
    v_caller_email := auth.jwt() ->> 'email';

    -- SEGURIDAD ELITE: Permitir si es admin en tabla O si es el email del dueño en el token
    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        OR v_caller_email = 'fuadel21@hotmail.com'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado: % no tiene permisos de administrador.', v_caller_email;
    END IF;

    -- 1. Total transaccionado (Precio total de plazas confirmadas)
    SELECT COALESCE(SUM(price), 0) INTO v_total_revenue
    FROM public.rides
    WHERE status = 'completed';

    -- 2. Comisiones (10%)
    v_platform_commissions := v_total_revenue * 0.10;

    -- 3. Total de viajes realizados
    SELECT COUNT(*) INTO v_total_rides FROM public.rides WHERE status = 'completed';

    -- 4. Usuarios totales
    SELECT COUNT(id) INTO v_active_users FROM public.profiles;

    -- 5. Ahorro de CO2
    v_co2_saved := v_total_rides * 15 * 0.2;

    RETURN jsonb_build_object(
        'total_revenue', COALESCE(v_total_revenue, 0),
        'platform_profit', COALESCE(v_platform_commissions, 0),
        'completed_rides', COALESCE(v_total_rides, 0),
        'active_users', COALESCE(v_active_users, 0),
        'co2_saved_kg', COALESCE(v_co2_saved, 0),
        'last_updated', now(),
        'success', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_platform_admin_stats() TO authenticated;
