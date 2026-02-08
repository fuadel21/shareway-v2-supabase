-- SHAREWAY V2: STRIPE & FINANCIAL HARDENING
-- Objetivo: Corregir errores de auditoría en pagos, webhooks y retiros.
DO $$ BEGIN -- 1. Asegurar que la tabla ride_requests use requester_id de forma consistente
-- (Si existe passenger_id, lo renombramos o creamos un alias en las funciones)
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ride_requests'
        AND column_name = 'passenger_id'
) THEN -- Si existe passenger_id, lo mantendremos por compatibilidad pero aseguramos que requester_id sea el principal
-- O simplemente nos aseguramos de que requester_id esté presente.
NULL;
END IF;
END $$;
-- 2. ACTUALIZAR FUNCIÓN DE CRÉDITO (Permitir especificar user_id desde Webhook)
CREATE OR REPLACE FUNCTION public.credit_wallet_on_success(
        p_user_id UUID,
        p_payment_intent_id TEXT,
        p_amount DECIMAL
    ) RETURNS JSON AS $$
DECLARE v_current_balance DECIMAL;
BEGIN -- Validaciones
IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id es requerido';
END IF;
IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido';
END IF;
-- Evitar duplicidad
IF EXISTS (
    SELECT 1
    FROM public.transactions
    WHERE description LIKE '%' || p_payment_intent_id || '%'
) THEN RETURN json_build_object('success', true, 'message', 'Pago ya procesado.');
END IF;
-- UPSERT: Crear wallet si no existe y sumar balance
INSERT INTO public.wallets (user_id, balance, held_balance, updated_at)
VALUES (p_user_id, p_amount, 0, NOW()) ON CONFLICT (user_id) DO
UPDATE
SET balance = public.wallets.balance + EXCLUDED.balance,
    updated_at = NOW()
RETURNING balance INTO v_current_balance;
-- Registrar la Transacción
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
VALUES (
        p_user_id,
        p_user_id,
        p_amount,
        v_current_balance,
        'deposit_stripe',
        'Recarga vía Stripe: ' || p_payment_intent_id
    );
RETURN json_build_object(
    'success',
    true,
    'new_balance',
    v_current_balance
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. FUNCIÓN PARA GESTIONAR RETIROS (Payouts) SEGUROS
CREATE OR REPLACE FUNCTION public.request_payout_with_deduction(p_user_id UUID, p_amount DECIMAL) RETURNS JSON AS $$
DECLARE v_current_balance DECIMAL;
BEGIN -- 1. Verificar si tiene saldo suficiente
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = p_user_id FOR
UPDATE;
IF v_current_balance IS NULL
OR v_current_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente para retirar %. Saldo actual: %',
p_amount,
COALESCE(v_current_balance, 0);
END IF;
-- 2. Restar el saldo inmediatamente (Bloqueo preventivo)
UPDATE public.wallets
SET balance = balance - p_amount,
    updated_at = NOW()
WHERE user_id = p_user_id;
-- 3. Registrar transacción de retiro pendiente
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
VALUES (
        p_user_id,
        p_user_id,
        - p_amount,
        v_current_balance - p_amount,
        'payout',
        'Retiro a cuenta bancaria (Stripe)'
    );
RETURN json_build_object(
    'success',
    true,
    'remaining_balance',
    v_current_balance - p_amount
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;