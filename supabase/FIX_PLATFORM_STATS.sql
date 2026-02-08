-- ==========================================
-- REPARACIÓN DEFINITIVA: MOTOR DE ESTADÍSTICAS ADMIN V2
-- Objetivo: Robustez en cálculos y compatibilidad JSONB
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_platform_stats() RETURNS JSON AS $$
DECLARE v_total_uncollected_fees DECIMAL;
v_gross_total_volume DECIMAL;
v_total_users INTEGER;
v_total_completed_rides INTEGER;
v_pending_verifications INTEGER;
v_platform_fee_percent FLOAT;
v_raw_fee_setting JSONB;
BEGIN -- 1. Obtener la comisión configurada con mayor robustez
SELECT value INTO v_raw_fee_setting
FROM public.platform_settings
WHERE key = 'platform_fee_percent';
-- Intentar extraer el número del JSONB de forma segura
IF v_raw_fee_setting IS NOT NULL THEN -- Si es un objeto/valor directo, lo convertimos a texto y luego a float
v_platform_fee_percent := (v_raw_fee_setting#>>'{}')::FLOAT;
ELSE v_platform_fee_percent := 10.0;
-- Default 10%
END IF;
-- 2. Cálculos globales
SELECT COUNT(*) INTO v_total_users
FROM public.profiles;
SELECT COUNT(*) INTO v_total_completed_rides
FROM public.rides
WHERE status = 'completed';
-- 3. Volumen de transacciones (Suma de precios de viajes completados)
SELECT COALESCE(SUM(price), 0) INTO v_gross_total_volume
FROM public.rides
WHERE status = 'completed';
-- 4. Comisiones (GTV * Porcentaje)
v_total_uncollected_fees := v_gross_total_volume * (v_platform_fee_percent / 100.0);
-- 5. Verificaciones pendientes
SELECT COUNT(*) INTO v_pending_verifications
FROM public.profiles
WHERE (verification->>'status') = 'pending';
RETURN json_build_object(
    'success',
    true,
    'stats',
    json_build_object(
        'totalUncollectedFees',
        ROUND(v_total_uncollected_fees, 2),
        'grossTotalVolume',
        ROUND(v_gross_total_volume, 2),
        'totalUsers',
        v_total_users,
        'totalCompletedRides',
        v_total_completed_rides,
        'pendingVerifications',
        v_pending_verifications
    )
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;