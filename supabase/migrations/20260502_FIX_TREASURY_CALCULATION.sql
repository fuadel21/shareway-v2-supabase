-- ========================================================
-- SHAREWAY ELITE: FIX DE CÁLCULO DE TESORERÍA REAL
-- Propósito: Calcular comisiones basándose en el balance de la billetera de tesorería
-- en lugar de proyecciones sobre viajes completados.
-- ========================================================

CREATE OR REPLACE FUNCTION public.get_platform_stats() RETURNS JSON AS $$
DECLARE
    v_treasury_balance DECIMAL;
    v_total_users INTEGER;
    v_total_completed_rides INTEGER;
    v_pending_verifications INTEGER;
    v_total_co2_saved DECIMAL;
    v_total_km_shared DECIMAL;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
    v_recent_tx JSONB;
BEGIN
    -- 1. Balance Real
    SELECT COALESCE(balance, 0) INTO v_treasury_balance
    FROM public.wallets
    WHERE user_id = v_treasury_id;

    -- 2. Estadísticas base
    SELECT COUNT(*) INTO v_total_users FROM public.profiles;
    SELECT COUNT(*) INTO v_total_completed_rides FROM public.rides WHERE status = 'completed';
    SELECT COUNT(*) INTO v_pending_verifications FROM public.profiles WHERE (verification->>'status') = 'pending';

    -- 3. Historial de comisiones (Últimas 15)
    SELECT jsonb_agg(t) INTO v_recent_tx
    FROM (
        SELECT
            id,
            amount,
            type,
            description,
            created_at as date
        FROM public.transactions
        WHERE wallet_id = (SELECT id FROM public.wallets WHERE user_id = v_treasury_id)
        ORDER BY created_at DESC
        LIMIT 15
    ) t;

    -- 4. Impacto (Sincronizado con v_eu_grant_report)
    SELECT
        COALESCE(SUM(total_km_traveled), 0),
        COALESCE(SUM(net_co2_savings_kg), 0)
    INTO v_total_km_shared, v_total_co2_saved
    FROM public.v_eu_grant_report;

    RETURN json_build_object(
        'success', true,
        'stats', json_build_object(
            'totalUncollectedFees', ROUND(v_treasury_balance, 2),
            'totalUsers', v_total_users,
            'totalCompletedRides', v_total_completed_rides,
            'pendingVerifications', v_pending_verifications,
            'totalCo2Saved', ROUND(v_total_co2_saved, 2),
            'totalKmShared', ROUND(v_total_km_shared, 2),
            'recentFeeTransactions', COALESCE(v_recent_tx, '[]'::jsonb)
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ACTUALIZACIÓN: Payout de plataforma basado en balance REAL
CREATE OR REPLACE FUNCTION public.request_platform_payout() RETURNS JSON AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
    v_balance DECIMAL;
    v_wallet_id UUID;
BEGIN
    -- Verificar Admin
    IF NOT public.is_admin(v_admin_id) THEN
        RAISE EXCEPTION 'No autorizado.';
    END IF;

    -- Obtener saldo y wallet
    SELECT id, balance INTO v_wallet_id, v_balance
    FROM public.wallets
    WHERE user_id = v_treasury_id;

    IF v_balance <= 0 THEN
        RAISE EXCEPTION 'No hay fondos suficientes en tesorería para retirar.';
    END IF;

    -- 1. Descontar del balance de tesorería
    UPDATE public.wallets
    SET balance = 0, updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 2. Registrar transacción de salida
    INSERT INTO public.transactions (wallet_id, amount, type, description)
    VALUES (v_wallet_id, -v_balance, 'payout', 'Retiro de tesorería a cuenta principal');

    -- 3. Log de auditoría
    PERFORM public.log_admin_action(
        'PLATFORM_PAYOUT_EXECUTED',
        jsonb_build_object('amount', v_balance, 'wallet_id', v_wallet_id),
        NULL
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Liquidación de ' || ROUND(v_balance, 2) || '€ procesada correctamente.',
        'amount', v_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
