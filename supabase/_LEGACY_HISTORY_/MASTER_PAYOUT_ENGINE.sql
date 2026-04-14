-- ==========================================
-- SHAREWAY V2: UNIFIED PAYOUT & CASH-OUT ENGINE
-- ==========================================
-- Gestiona las solicitudes de los usuarios para retirar saldo a su banco.
-- 1. TABLA DE SOLICITUDES DE RETIRO (PAYOUT_REQUESTS)
CREATE TABLE IF NOT EXISTS public.payout_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    currency TEXT DEFAULT 'EUR',
    status TEXT DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'processing',
            'completed',
            'cancelled',
            'failed'
        )
    ),
    type TEXT DEFAULT 'bank_transfer' CHECK (
        type IN (
            'bank_transfer',
            'stripe_refund',
            'instant_payout'
        )
    ),
    admin_notes TEXT,
    stripe_payout_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. RPC: REQUEST_PAYOUT (REDEFINIDO)
-- Ahora resta el saldo inmediatamente y crea una solicitud pendiente.
CREATE OR REPLACE FUNCTION public.request_payout(
        p_amount DECIMAL,
        p_type TEXT DEFAULT 'bank_transfer'
    ) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_current_balance DECIMAL;
v_payout_id UUID;
BEGIN -- 1. Validaciones
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autorizado';
END IF;
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_user_id FOR
UPDATE;
IF v_current_balance IS NULL
OR v_current_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente para retirar %€ (Tu saldo: %€)',
p_amount,
COALESCE(v_current_balance, 0);
END IF;
-- 2. Bloquear Fondos (Restar de balance)
UPDATE public.wallets
SET balance = balance - p_amount,
    updated_at = NOW()
WHERE user_id = v_user_id;
-- 3. Crear Registro de Solicitud
INSERT INTO public.payout_requests (user_id, amount, type, status)
VALUES (v_user_id, p_amount, p_type, 'pending')
RETURNING id INTO v_payout_id;
-- 4. Auditoría en wallet_transactions
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
VALUES (
        v_user_id,
        v_user_id,
        - p_amount,
        v_current_balance - p_amount,
        'withdraw_request',
        'Solicitud de retiro a banco (ID: ' || v_payout_id || ')'
    );
-- 5. Notificar a Admins (Opcional, pero recomendado)
-- Aquí podrías insertar una notificación para el rol admin
RETURN json_build_object(
    'success',
    true,
    'payoutId',
    v_payout_id,
    'message',
    'Solicitud recibida. Se procesará en 1-3 días hábiles.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. RPC: CANCEL_PAYOUT (Permitir al usuario arrepentirse si aún está pending)
CREATE OR REPLACE FUNCTION public.cancel_payout(p_payout_id UUID) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_amount DECIMAL;
v_status TEXT;
BEGIN
SELECT amount,
    status INTO v_amount,
    v_status
FROM public.payout_requests
WHERE id = p_payout_id
    AND user_id = v_user_id;
IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada.';
END IF;
IF v_status != 'pending' THEN RAISE EXCEPTION 'La solicitud ya está en proceso y no se puede cancelar.';
END IF;
-- Devolver dinero a la wallet
UPDATE public.wallets
SET balance = balance + v_amount
WHERE user_id = v_user_id;
-- Actualizar estado
UPDATE public.payout_requests
SET status = 'cancelled',
    updated_at = NOW()
WHERE id = p_payout_id;
-- Auditoría
INSERT INTO public.wallet_transactions (user_id, wallet_id, amount, type, description)
VALUES (
        v_user_id,
        v_user_id,
        v_amount,
        'withdraw_cancel',
        'Retiro cancelado: Fondos devueltos a Cartera'
    );
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;