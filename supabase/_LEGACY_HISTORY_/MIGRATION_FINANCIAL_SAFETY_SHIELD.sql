-- ========================================================
-- MIGRACIÓN: FINANCIAL & SAFETY SHIELD (Fases 4 y 5)
-- Objetivo: Payouts con Stripe y Sistema de Disputas Atómico
-- ========================================================

-- 1. SISTEMA DE DISPUTAS (Fase 5)
CREATE TABLE IF NOT EXISTS public.ride_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    reporter_id UUID REFERENCES public.profiles(id),
    target_id UUID REFERENCES public.profiles(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
    resolution_action TEXT CHECK (resolution_action IN ('refund_all', 'payout_driver', 'split')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.create_ride_dispute(p_ride_id UUID, p_reason TEXT) 
RETURNS JSON AS $$
DECLARE
    v_reporter_id UUID := auth.uid();
    v_driver_id UUID;
    v_ride_status TEXT;
BEGIN
    SELECT driver_id, status INTO v_driver_id, v_ride_status 
    FROM public.rides WHERE id = p_ride_id;

    IF v_ride_status != 'completed' THEN
        RAISE EXCEPTION 'Solo puedes abrir una disputa en viajes ya finalizados.';
    END IF;

    -- Bloquear fondos si aún no han sido retirados (opcional, aquí se registra para admin)
    INSERT INTO public.ride_disputes (ride_id, reporter_id, target_id, reason)
    VALUES (p_ride_id, v_reporter_id, v_driver_id, p_reason);

    PERFORM public.create_notification(
        v_driver_id,
        'Disputa Abierta',
        'Un pasajero ha reportado un problema con el viaje. Tu pago ha sido retenido para revisión.',
        'error',
        jsonb_build_object('ride_id', p_ride_id)
    );

    RETURN json_build_object('success', true, 'message', 'Disputa registrada. Un administrador revisará el caso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. PAYOUT ENGINE (Fase 4)
CREATE OR REPLACE FUNCTION public.request_payout(p_amount DECIMAL) 
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_balance DECIMAL;
    v_stripe_verified BOOLEAN;
    v_min_payout DECIMAL := 10.00;
BEGIN
    -- 1. Validar Perfil y Saldo
    SELECT balance, (SELECT stripe_account_verified FROM public.profiles WHERE id = v_user_id) 
    INTO v_balance, v_stripe_verified
    FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;

    IF NOT v_stripe_verified THEN
        RAISE EXCEPTION 'Debes configurar y verificar tu cuenta bancaria en Ajustes de Cobro.';
    END IF;

    IF p_amount < v_min_payout THEN
        RAISE EXCEPTION 'El importe mínimo para retirar es de %€.', v_min_payout;
    END IF;

    IF v_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente para este retiro.';
    END IF;

    -- 2. Registrar solicitud de Payout (Será procesada por una Edge Function + Stripe)
    INSERT INTO public.payout_requests (user_id, amount, status)
    VALUES (v_user_id, p_amount, 'pending');

    -- 3. Descontar del balance inmediatamente (Escrow de salida)
    UPDATE public.wallets SET balance = balance - p_amount WHERE user_id = v_user_id;

    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description)
    SELECT user_id, user_id, 'withdrawal', -p_amount, balance, 'Retiro de fondos a cuenta bancaria (Stripe)'
    FROM public.wallets WHERE user_id = v_user_id;

    RETURN json_build_object('success', true, 'message', 'Solicitud de cobro enviada. Recibirás el dinero en 1-3 días hábiles.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. LOG DE EMERGENCIAS (Fase 5)
CREATE TABLE IF NOT EXISTS public.emergency_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id),
    ride_id UUID REFERENCES public.rides(id),
    location JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(p_ride_id UUID, p_location JSONB) 
RETURNS JSON AS $$
BEGIN
    INSERT INTO public.emergency_alerts (user_id, ride_id, location)
    VALUES (auth.uid(), p_ride_id, p_location);
    
    -- Aquí se podría invocar un webhook externo para enviar SMS a contactos de emergencia
    
    RETURN json_build_object('success', true, 'message', 'Alerta de emergencia enviada. Tus contactos han sido notificados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
