-- ========================================================
-- MIGRACIÓN: ADMINISTRATOR EMPOWERMENT v2.0
-- Objetivo: Dotar al admin de control total sobre usuarios y finanzas
-- ========================================================
-- 1. Asegurar columnas de auditoría en profiles
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'created_at'
) THEN
ALTER TABLE public.profiles
ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'updated_at'
) THEN
ALTER TABLE public.profiles
ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
END IF;
END $$;
-- 2. Función para Retiro de Comisiones de la Plataforma
-- Esta función calcula el total de comisiones y genera un "payout" para el admin
CREATE OR REPLACE FUNCTION public.request_platform_payout() RETURNS JSON AS $$
DECLARE v_admin_id UUID;
v_total_commissions DECIMAL;
v_platform_fee_percent FLOAT;
v_gtv DECIMAL;
BEGIN v_admin_id := auth.uid();
-- Verificar si es admin
IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_admin_id
        AND (
            role = 'admin'
            OR is_admin = true
        )
) THEN RAISE EXCEPTION 'No autorizado para retirar comisiones.';
END IF;
-- Obtener la comisión configurada
SELECT (value->>0)::FLOAT INTO v_platform_fee_percent
FROM public.platform_settings
WHERE key = 'platform_fee_percent';
v_platform_fee_percent := COALESCE(v_platform_fee_percent, 10.0);
-- Calcular GTV (Gross Total Volume) de viajes completados
SELECT COALESCE(SUM(price), 0) INTO v_gtv
FROM public.rides
WHERE status = 'completed';
v_total_commissions := v_gtv * (v_platform_fee_percent / 100.0);
-- En una implementación real con Stripe, aquí se invocaría la transferencia.
-- Por ahora registramos la acción en la auditoría.
PERFORM public.log_admin_action(
    'PLATFORM_PAYOUT_REQUESTED',
    'finance',
    jsonb_build_object('amount', v_total_commissions),
    NULL
);
RETURN json_build_object(
    'success',
    true,
    'message',
    'Solicitud de retiro de ' || ROUND(v_total_commissions, 2) || '€ enviada correctamente.',
    'amount',
    ROUND(v_total_commissions, 2)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Funciones de Control de Usuarios (Suspensión y Verificación)
CREATE OR REPLACE FUNCTION public.admin_update_user_status(
        p_user_id UUID,
        p_status TEXT,
        -- 'verified', 'rejected', 'pending'
        p_reason TEXT DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_old_status TEXT;
BEGIN
SELECT (verification->>'status') INTO v_old_status
FROM public.profiles
WHERE id = p_user_id;
UPDATE public.profiles
SET verification = jsonb_set(verification, '{status}', to_jsonb(p_status)),
    updated_at = NOW()
WHERE id = p_user_id;
PERFORM public.log_admin_action(
    'USER_VERIFICATION_UPDATE',
    p_user_id::TEXT,
    to_jsonb(v_old_status),
    to_jsonb(p_status)
);
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.admin_toggle_user_suspension(
        p_user_id UUID,
        p_suspend BOOLEAN,
        p_reason TEXT DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_old_state BOOLEAN;
BEGIN
SELECT is_suspended INTO v_old_state
FROM public.profiles
WHERE id = p_user_id;
UPDATE public.profiles
SET is_suspended = p_suspend,
    updated_at = NOW()
WHERE id = p_user_id;
PERFORM public.log_admin_action(
    CASE
        WHEN p_suspend THEN 'USER_SUSPENDED'
        ELSE 'USER_UNSUSPENDED'
    END,
    p_user_id::TEXT,
    to_jsonb(v_old_state),
    to_jsonb(p_suspend)
);
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;