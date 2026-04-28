-- ==========================================
-- 20260506_FINANCIAL_PAYOUT_SYSTEM.sql
-- Sistema de Gestión de Pagos y Liquidaciones a Conductores
-- ==========================================

-- 1. Tabla de Solicitudes de Pago (si no existe)
CREATE TABLE IF NOT EXISTS public.payout_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id),
    amount DECIMAL NOT NULL CHECK (amount > 0),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    bank_details JSONB,
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- 2. RPC para solicitar pago (Conductor)
DROP FUNCTION IF EXISTS public.request_payout(DECIMAL);
DROP FUNCTION IF EXISTS public.request_payout(NUMERIC);

CREATE OR REPLACE FUNCTION public.request_payout(p_amount DECIMAL)
RETURNS JSONB AS $$
DECLARE
    v_balance DECIMAL;
BEGIN
    -- Verificar saldo en la wallet
    SELECT balance INTO v_balance FROM public.wallets WHERE user_id = auth.uid();

    IF v_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    -- Crear solicitud
    INSERT INTO public.payout_requests (user_id, amount, status)
    VALUES (auth.uid(), p_amount, 'pending');

    -- Bloquear saldo (opcional, aquí simplemente lo registramos)
    RETURN jsonb_build_object('success', true, 'message', 'Solicitud enviada con éxito');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC para Procesar Pago (Admin)
CREATE OR REPLACE FUNCTION public.process_payout_elite(p_payout_id UUID, p_action TEXT, p_notes TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_amount DECIMAL;
BEGIN
    SELECT user_id, amount INTO v_user_id, v_amount FROM public.payout_requests WHERE id = p_payout_id;

    IF p_action = 'approve' THEN
        -- Restar de la wallet
        UPDATE public.wallets SET balance = balance - v_amount WHERE user_id = v_user_id;

        -- Marcar como completado
        UPDATE public.payout_requests
        SET status = 'completed', admin_notes = p_notes, completed_at = now()
        WHERE id = p_payout_id;

        -- Auditar
        INSERT INTO public.platform_audit_logs (admin_id, action, target_key, old_value, new_value)
        VALUES (auth.uid(), 'payout_approved', p_payout_id::text, null, jsonb_build_object('amount', v_amount, 'user_id', v_user_id));

    ELSIF p_action = 'reject' THEN
        UPDATE public.payout_requests SET status = 'rejected', admin_notes = p_notes WHERE id = p_payout_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_payout_elite(UUID, TEXT, TEXT) TO authenticated;
