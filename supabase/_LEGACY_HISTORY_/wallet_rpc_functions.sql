-- Funciones de Wallet faltantes

-- 1. add_funds
-- Simula la recarga de fondos. En producción, esto debería validar el pago con Stripe mediante una Edge Function.
CREATE OR REPLACE FUNCTION public.add_funds(
    p_amount DECIMAL,
    p_payment_method_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'El monto debe ser positivo';
    END IF;

    -- Actualizar Wallet (upsert)
    INSERT INTO public.wallets (user_id, balance, updated_at)
    VALUES (v_user_id, p_amount, NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        balance = public.wallets.balance + excluded.balance,
        updated_at = NOW();

    -- Registrar Transacción (Consolidado a la tabla transactions)
    INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, balance_after)
    SELECT 
        id, 
        v_user_id, 
        p_amount, 
        'deposit', 
        'Recarga de saldo (Stripe: ' || p_payment_method_id || ')', 
        balance
    FROM public.wallets 
    WHERE user_id = v_user_id;

    RETURN json_build_object('success', true, 'message', 'Fondos añadidos correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. request_payout
-- Gestiona la solicitud de retirada de fondos
CREATE OR REPLACE FUNCTION public.request_payout(
    p_amount DECIMAL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_balance DECIMAL;
    v_wallet_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    SELECT id, balance INTO v_wallet_id, v_balance FROM public.wallets WHERE user_id = v_user_id;
    
    IF v_balance IS NULL OR v_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    -- Restar del balance
    UPDATE public.wallets
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Registrar transacción (Consolidado a la tabla transactions)
    INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, balance_after)
    VALUES (v_wallet_id, v_user_id, -p_amount, 'withdraw', 'Solicitud de retiro procesada', v_balance - p_amount);
    
    RETURN json_build_object('success', true, 'message', 'Retiro solicitado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
