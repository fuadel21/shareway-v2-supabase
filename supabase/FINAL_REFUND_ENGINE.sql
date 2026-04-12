-- ==========================================
-- SHAREWAY V2: MASTER REFUND & DISPUTE ENGINE
-- ==========================================
-- Maneja reembolsos manuales, disputas y garantías de pago.
-- 1. RPC PARA REEMBOLSO MANUAL (ADMIN)
-- Permite a un administrador devolver dinero a un pasajero desde el Escrow o Tesorería.
CREATE OR REPLACE FUNCTION public.admin_process_refund(
        p_ride_id UUID,
        p_passenger_id UUID,
        p_amount DECIMAL,
        p_reason TEXT,
        p_source TEXT DEFAULT 'held' -- 'held' (Escrow) o 'platform' (Tesorería)
    ) RETURNS JSON AS $$
DECLARE v_admin_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_current_held DECIMAL;
v_new_balance DECIMAL;
BEGIN -- 1. Validar Admin
IF NOT (
    SELECT is_admin
    FROM public.profiles
    WHERE id = v_admin_id
) THEN RAISE EXCEPTION 'No autorizado. Se requieren permisos de administrador.';
END IF;
-- 2. Procesar según origen
IF p_source = 'held' THEN -- Verificar que el pasajero tenga dinero retenido
SELECT held_balance INTO v_current_held
FROM public.wallets
WHERE user_id = p_passenger_id FOR
UPDATE;
IF v_current_held < p_amount THEN RAISE EXCEPTION 'El pasajero solo tiene %€ en garantía, no se pueden devolver %€',
v_current_held,
p_amount;
END IF;
UPDATE public.wallets
SET balance = balance + p_amount,
    held_balance = held_balance - p_amount,
    updated_at = NOW()
WHERE user_id = p_passenger_id
RETURNING balance INTO v_new_balance;
ELSIF p_source = 'platform' THEN -- Descontar de tesorería y sumar al usuario
UPDATE public.wallets
SET balance = balance - p_amount
WHERE user_id = v_platform_id;
UPDATE public.wallets
SET balance = balance + p_amount
WHERE user_id = p_passenger_id
RETURNING balance INTO v_new_balance;
END IF;
-- 3. Auditoría
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
        p_amount,
        v_new_balance,
        'refund_manual',
        'Reembolso Admin: ' || p_reason,
        p_ride_id
    );
-- 4. Notificar al pasajero
PERFORM public.create_notification(
    p_passenger_id,
    '💰 Reembolso Procesado',
    'Se te han abonado ' || p_amount || '€ en tu cartera por: ' || p_reason,
    'success',
    jsonb_build_object('ride_id', p_ride_id)
);
RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. MEJORA DE RESOLUCIÓN DE DISPUTAS
CREATE OR REPLACE FUNCTION public.resolve_ride_dispute(
        p_dispute_id UUID,
        p_action TEXT,
        -- 'refund_passenger', 'payout_driver', 'split_50_50'
        p_admin_notes TEXT
    ) RETURNS JSON AS $$
DECLARE v_dispute RECORD;
v_booked_price DECIMAL;
v_passenger_id UUID;
v_driver_id UUID;
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN -- 1. Validar Admin
IF NOT (
    SELECT is_admin
    FROM public.profiles
    WHERE id = auth.uid()
) THEN RAISE EXCEPTION 'No autorizado.';
END IF;
SELECT * INTO v_dispute
FROM public.ride_disputes
WHERE id = p_dispute_id;
v_passenger_id := v_dispute.reporter_id;
v_driver_id := v_dispute.target_id;
-- Obtener el precio pagado buscando en el array de pasajeros del viaje
SELECT (p->>'booked_price')::DECIMAL INTO v_booked_price
FROM public.rides r,
    jsonb_array_elements(r.passengers) p
WHERE r.id = v_dispute.ride_id
    AND (p->>'id')::UUID = v_passenger_id;
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'No se encontró el registro de pago para este pasajero.';
END IF;
-- ACCIÓN: Reembolso Total al Pasajero
IF p_action = 'refund_passenger' THEN PERFORM public.admin_process_refund(
    v_dispute.ride_id,
    v_passenger_id,
    v_booked_price,
    'Disputa resuelta a favor del pasajero: ' || p_admin_notes,
    'held'
);
-- ACCIÓN: Pago al Conductor (Cerrar disputa ignorando queja)
ELSIF p_action = 'payout_driver' THEN -- Esto es básicamente lo que haría complete_ride pero manual
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
UPDATE public.wallets
SET balance = balance + (v_booked_price * 0.85)
WHERE user_id = v_driver_id;
UPDATE public.wallets
SET balance = balance + (v_booked_price * 0.15)
WHERE user_id = v_platform_id;
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_driver_id,
        v_driver_id,
        v_booked_price * 0.85,
        'dispute_payout',
        'Pago liberado tras disputa: ' || p_admin_notes,
        v_dispute.ride_id
    );
-- ACCIÓN: Mitad y Mitad
ELSIF p_action = 'split_50_50' THEN -- Pasajero recupera el 50%
UPDATE public.wallets
SET balance = balance + (v_booked_price * 0.5),
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
-- Conductor recibe el 50% (menos comisión plataforma del total)
UPDATE public.wallets
SET balance = balance + (v_booked_price * 0.35)
WHERE user_id = v_driver_id;
UPDATE public.wallets
SET balance = balance + (v_booked_price * 0.15)
WHERE user_id = v_platform_id;
END IF;
UPDATE public.ride_disputes
SET status = 'resolved',
    resolution_action = p_action
WHERE id = p_dispute_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;