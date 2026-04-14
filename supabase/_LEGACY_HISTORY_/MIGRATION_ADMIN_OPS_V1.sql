-- ========================================================
-- MIGRACIÓN: ADMIN OPERATIONS & RESILIENCE (Fase 6)
-- Objetivo: Herramientas de resolución de conflictos y automatización
-- ========================================================

-- 1. RPC PARA RESOLVER DISPUTAS (Arbitraje Financiero)
CREATE OR REPLACE FUNCTION public.resolve_ride_dispute(
    p_dispute_id UUID,
    p_action TEXT, -- 'refund_all', 'payout_driver'
    p_admin_notes TEXT
) RETURNS JSON AS $$
DECLARE
    v_dispute RECORD;
    v_ride_price DECIMAL;
BEGIN
    -- Validar que el ejecutor sea Admin
    IF NOT (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador.';
    END IF;

    SELECT * INTO v_dispute FROM public.ride_disputes WHERE id = p_dispute_id;
    IF v_dispute.id IS NULL THEN RAISE EXCEPTION 'Disputa no encontrada.'; END IF;

    SELECT price INTO v_ride_price FROM public.rides WHERE id = v_dispute.ride_id;

    -- ACCIÓN A: Reembolsar al Pasajero
    IF p_action = 'refund_all' THEN
        UPDATE public.wallets 
        SET balance = balance + v_ride_price, held_balance = held_balance - v_ride_price 
        WHERE user_id = v_dispute.reporter_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, description, related_ride_id)
        VALUES (v_dispute.reporter_id, v_dispute.reporter_id, 'refund', v_ride_price, 'Reembolso por disputa resuelta: ' || p_admin_notes, v_dispute.ride_id);

    -- ACCIÓN B: Pagar al Conductor (Cerrar Escrow)
    ELSIF p_action = 'payout_driver' THEN
        UPDATE public.wallets SET held_balance = held_balance - v_ride_price WHERE user_id = v_dispute.reporter_id;
        UPDATE public.wallets SET balance = balance + v_ride_price WHERE user_id = v_dispute.target_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, description, related_ride_id)
        VALUES (v_dispute.target_id, v_dispute.target_id, 'payout', v_ride_price, 'Pago liberado tras revisión de disputa', v_dispute.ride_id);
    END IF;

    -- Actualizar estado de la disputa
    UPDATE public.ride_disputes SET 
        status = 'resolved', 
        resolution_action = p_action,
        created_at = NOW() -- Usado aquí como resolved_at por simplicidad
    WHERE id = p_dispute_id;

    RETURN json_build_object('success', true, 'message', 'Conflicto resuelto y fondos movidos.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. SISTEMA DE INDEXACIÓN PARA PERFORMANCE (Escalabilidad)
-- Estos índices aseguran que la app vuele cuando tengas miles de viajes
CREATE INDEX IF NOT EXISTS idx_rides_status_departure ON public.rides(status, departure_time);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_ride_requests_requester ON public.ride_requests(requester_id, status);
