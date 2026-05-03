-- ==========================================
-- 20260510_SECURE_PAYMENT_FLOW_V1.sql
-- Implementación de flujo de depósitos verificado (Anti-Fraude)
-- ==========================================

-- 1. Tabla para rastrear intentos de pago
CREATE TABLE IF NOT EXISTS public.payment_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
    provider TEXT NOT NULL, -- 'stripe', 'paypal'
    external_id TEXT UNIQUE, -- ID de Sesión de Stripe o Pedido de PayPal
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS para payment_intents (Solo lectura para el usuario propio)
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own intents" ON public.payment_intents;
CREATE POLICY "Users can view their own intents" ON public.payment_intents FOR SELECT USING (auth.uid() = user_id);

-- 2. RPC para registrar el inicio de un pago (Desde el App)
CREATE OR REPLACE FUNCTION public.create_deposit_intent(
    p_amount NUMERIC,
    p_provider TEXT,
    p_external_id TEXT
) RETURNS JSONB AS $$
DECLARE
    v_intent_id UUID;
BEGIN
    INSERT INTO public.payment_intents (user_id, amount, provider, external_id, status)
    VALUES (auth.uid(), p_amount, p_provider, p_external_id, 'pending')
    RETURNING id INTO v_intent_id;

    RETURN jsonb_build_object('success', true, 'intent_id', v_intent_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC SECRETO para confirmar el depósito (Solo para Webhooks/Edge Functions)
-- Esta función NO debería ser invocable directamente por usuarios normales con éxito.
CREATE OR REPLACE FUNCTION public.confirm_deposit_secure(
    p_external_id TEXT,
    p_secret_key TEXT DEFAULT NULL -- Opcional: validación extra
) RETURNS JSONB AS $$
DECLARE
    v_intent RECORD;
    v_wallet_id UUID;
BEGIN
    -- SEGURIDAD: Solo permitir si es llamado por el rol 'service_role'
    -- o si se valida una clave secreta interna (configurada en vault o env)
    -- En este ejemplo, confiamos en que el Edge Function usa service_role.

    -- 1. Buscar el intento de pago
    SELECT * INTO v_intent FROM public.payment_intents WHERE external_id = p_external_id FOR UPDATE;

    IF v_intent.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Intento de pago no encontrado');
    END IF;

    IF v_intent.status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El pago ya fue procesado anteriormente');
    END IF;

    -- 2. Actualizar saldo de la billetera
    UPDATE public.wallets
    SET balance = balance + v_intent.amount,
        updated_at = NOW()
    WHERE user_id = v_intent.user_id;

    -- 3. Marcar intento como completado
    UPDATE public.payment_intents
    SET status = 'completed', updated_at = NOW()
    WHERE id = v_intent.id;

    -- 4. Registrar transacción oficial
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_intent.user_id, v_intent.amount, 'deposit', 'Carga de saldo confirmada via ' || v_intent.provider, NULL);

    -- 5. Notificar al usuario
    PERFORM public.create_notification(
        v_intent.user_id,
        'payment_success',
        '¡Carga Exitosa!',
        'Se han acreditado $' || v_intent.amount || ' a tu billetera.',
        jsonb_build_object('intent_id', v_intent.id)
    );

    RETURN jsonb_build_object('success', true, 'new_status', 'completed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. DEPRECAR add_funds (Hacerla inservible para usuarios normales)
CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_method TEXT DEFAULT 'card')
RETURNS JSON AS $$
BEGIN
    -- Ahora esta función solo lanza un error si se intenta usar desde el cliente.
    -- Obliga a usar el flujo de Webhook.
    RAISE EXCEPTION 'EL_METODO_DIRECTO_ESTA_DESHABILITADO. Use el flujo de pago seguro.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Permisos
REVOKE ALL ON FUNCTION public.confirm_deposit_secure(TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.confirm_deposit_secure(TEXT, TEXT) FROM authenticated;
-- Solo el service_role (usado por Edge Functions) debería tener permiso
GRANT EXECUTE ON FUNCTION public.confirm_deposit_secure(TEXT, TEXT) TO service_role;
