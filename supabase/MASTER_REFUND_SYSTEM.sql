-- ==========================================
-- SHAREWAY V2: UNIFIED REFUND SYSTEM (V4.0)
-- ==========================================
-- Centraliza todas las devoluciones, ya sean automáticas, 
-- por disputa o manuales por el administrador.
-- 1. TABLA DE LOGS DE REEMBOLSOS (Para auditoría financiera estricta)
CREATE TABLE IF NOT EXISTS public.refund_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id),
    user_id UUID REFERENCES public.profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    type TEXT NOT NULL,
    -- 'wallet_credit', 'stripe_reversal'
    reason TEXT,
    status TEXT DEFAULT 'processed',
    processed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. RPC: SOLICITAR REEMBOLSOS (Pasajero)
-- Esto crea una entrada en cancellation_disputes que el admin verá.
CREATE OR REPLACE FUNCTION public.request_extraordinary_refund(
        p_ride_id UUID,
        p_reason TEXT,
        p_evidence_urls TEXT [] DEFAULT NULL
    ) RETURNS JSON AS $$ BEGIN RETURN public.create_cancellation_dispute(p_ride_id, p_reason, p_evidence_urls);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. RPC: PROCESAR REEMBOLSO TOTAL (ADMIN)
-- Devuelve el 100% al pasajero, ignorando políticas automáticas.
CREATE OR REPLACE FUNCTION public.admin_force_refund(
        p_ride_id UUID,
        p_passenger_id UUID,
        p_reason TEXT
    ) RETURNS JSON AS $$
DECLARE v_booked_price DECIMAL;
v_new_balance DECIMAL;
v_held_balance DECIMAL;
BEGIN -- Validar Admin
IF NOT (
    SELECT is_admin
    FROM public.profiles
    WHERE id = auth.uid()
) THEN RAISE EXCEPTION 'No autorizado';
END IF;
-- Obtener montos del escrow (held_balance)
SELECT (p->>'booked_price')::DECIMAL INTO v_booked_price
FROM public.rides r,
    jsonb_array_elements(r.passengers) p
WHERE r.id = p_ride_id
    AND (p->>'id')::UUID = p_passenger_id;
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'No se encontró el pago para este pasajero en este viaje.';
END IF;
-- Verificar si los fondos aún están en held_balance
SELECT held_balance INTO v_held_balance
FROM public.wallets
WHERE user_id = p_passenger_id FOR
UPDATE;
IF v_held_balance < v_booked_price THEN -- Si ya no están en escrow (porque el viaje se completó), el reembolso sale de Tesorería.
UPDATE public.wallets
SET balance = balance - v_booked_price
WHERE user_id = '00000000-0000-0000-0000-000000000000';
ELSE -- Si están en escrow, los liberamos al balance
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = p_passenger_id;
END IF;
UPDATE public.wallets
SET balance = balance + v_booked_price,
    updated_at = NOW()
WHERE user_id = p_passenger_id
RETURNING balance INTO v_new_balance;
-- Log
INSERT INTO public.refund_logs (
        ride_id,
        user_id,
        amount,
        type,
        reason,
        processed_by
    )
VALUES (
        p_ride_id,
        p_passenger_id,
        v_booked_price,
        'wallet_credit',
        p_reason,
        auth.uid()
    );
-- Transacción unificada
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description,
        related_ride_id
    )
VALUES (
        p_passenger_id,
        p_passenger_id,
        v_booked_price,
        v_new_balance,
        'refund_forced',
        'Reembolso extraordinario: ' || p_reason,
        p_ride_id
    );
-- Notificar
PERFORM public.create_notification(
    p_passenger_id,
    '💰 Reembolso Aplicado',
    'Se te han devuelto ' || v_booked_price || '€ de forma extraordinaria.',
    'success',
    jsonb_build_object('ride_id', p_ride_id)
);
RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. MEJORA DE POLITICA DE CANCELACIÓN (Sincronización con Logs)
-- Asegura que todo reembolso automático deje huella en refund_logs.
-- (Esta lógica se integrará en el trigger derides o en el RPC de cancelación)