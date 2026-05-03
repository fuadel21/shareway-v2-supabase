-- ==========================================
-- 20260510_TREASURY_DASHBOARD_RPC.sql
-- Panel de Control Financiero para la Tesorería (Admin Only)
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_treasury_dashboard()
RETURNS JSONB AS $$
DECLARE
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
    v_balance NUMERIC;
    v_held_balance NUMERIC;
    v_total_fees NUMERIC;
    v_total_penalties NUMERIC;
    v_recent_tx JSONB;
    v_caller_email TEXT;
BEGIN
    -- 1. SEGURIDAD ELITE (Solo Admin o Dueño)
    v_caller_email := auth.jwt() ->> 'email';
    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        OR v_caller_email = 'fuadel21@hotmail.com'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado: No tienes permisos para ver la tesorería.';
    END IF;

    -- 2. Obtener balance actual de la billetera de Tesorería
    SELECT balance, held_balance INTO v_balance, v_held_balance
    FROM public.wallets WHERE user_id = v_treasury_id;

    -- 3. Calcular acumulados históricos por tipo de transacción
    SELECT COALESCE(SUM(amount), 0) INTO v_total_fees
    FROM public.transactions WHERE user_id = v_treasury_id AND type = 'fee';

    SELECT COALESCE(SUM(amount), 0) INTO v_total_penalties
    FROM public.transactions WHERE user_id = v_treasury_id AND type = 'penalty';

    -- 4. Obtener las últimas 20 transacciones detalladas
    SELECT jsonb_agg(t) INTO v_recent_tx
    FROM (
        SELECT
            id,
            amount,
            type,
            description,
            related_ride_id,
            created_at
        FROM public.transactions
        WHERE user_id = v_treasury_id
        ORDER BY created_at DESC
        LIMIT 20
    ) t;

    -- 5. Retornar paquete de datos
    RETURN jsonb_build_object(
        'success', true,
        'treasury_wallet', jsonb_build_object(
            'balance', COALESCE(v_balance, 0),
            'held_balance', COALESCE(v_held_balance, 0)
        ),
        'stats', jsonb_build_object(
            'total_commissions', v_total_fees,
            'total_penalties', v_total_penalties,
            'total_accumulated', COALESCE(v_balance, 0)
        ),
        'recent_transactions', COALESCE(v_recent_tx, '[]'::jsonb),
        'server_time', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_treasury_dashboard() TO authenticated;
