-- ========================================================
-- MIGRACIÓN: FINANCIAL FINAL FIX v2 (Self-Healing Wallet)
-- Objetivo: Asegurar que el saldo se acredite incluso si no existe fila de wallet
-- ========================================================

CREATE OR REPLACE FUNCTION public.credit_wallet_on_success(
    p_payment_intent_id TEXT,
    p_amount DECIMAL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_current_balance DECIMAL;
BEGIN
    -- 1. Validaciones de Seguridad
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;

    -- 2. Evitar duplicidad (Idempotencia)
    IF EXISTS (
        SELECT 1 FROM public.transactions 
        WHERE description LIKE '%' || p_payment_intent_id || '%'
    ) THEN
        RETURN json_build_object('success', true, 'message', 'Pago ya procesado.');
    END IF;

    -- 3. AUTO-REPARACIÓN (UPSERT): Crear wallet si no existe y sumar balance
    INSERT INTO public.wallets (user_id, balance, held_balance, updated_at)
    VALUES (v_user_id, p_amount, 0, NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        balance = public.wallets.balance + EXCLUDED.balance,
        updated_at = NOW()
    RETURNING balance INTO v_current_balance;

    -- 4. Registrar la Transacción con el saldo real después del cambio
    INSERT INTO public.transactions (user_id, wallet_id, amount, balance_after, type, description)
    VALUES (
        v_user_id, 
        v_user_id, -- wallet_id es el user_id en este esquema
        p_amount, 
        v_current_balance, 
        'deposit_stripe', 
        'Recarga vía Stripe: ' || p_payment_intent_id
    );

    RETURN json_build_object(
        'success', true, 
        'new_balance', v_current_balance,
        'message', 'Saldo acreditado y cartera sincronizada.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
