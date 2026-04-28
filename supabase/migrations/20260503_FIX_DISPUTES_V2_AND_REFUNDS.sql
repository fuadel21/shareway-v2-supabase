-- ==========================================
-- SHAREWAY V2: ENHANCED DISPUTE RESOLUTION (v2)
-- ==========================================
-- Unifica la resolución de disputas con reembolsos reales en el Escrow.

CREATE OR REPLACE FUNCTION public.resolve_dispute_v2(
    p_dispute_id UUID,
    p_status TEXT, -- 'approved' o 'rejected'
    p_admin_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_dispute RECORD;
    v_ride RECORD;
    v_amount DECIMAL;
    v_passenger_id UUID;
    v_driver_id UUID;
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_new_balance DECIMAL;
BEGIN
    -- 1. Validar Admin
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'No autorizado');
    END IF;

    -- 2. Obtener la disputa (de la tabla cancellation_disputes que es la que usa la UI)
    SELECT * INTO v_dispute FROM public.cancellation_disputes WHERE id = p_dispute_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Disputa no encontrada');
    END IF;

    IF v_dispute.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Esta disputa ya ha sido resuelta');
    END IF;

    -- 3. Obtener el viaje y datos financieros
    SELECT * INTO v_ride FROM public.rides WHERE id = v_dispute.ride_id;
    v_passenger_id := v_dispute.user_id;
    v_amount := v_dispute.refund_amount; -- La tabla suele guardar el monto sugerido o capturado

    -- Si refund_amount es null, intentamos sacarlo de los metadatos del viaje si es posible
    IF v_amount IS NULL OR v_amount = 0 THEN
        SELECT (p->>'booked_price')::DECIMAL INTO v_amount
        FROM jsonb_array_elements(v_ride.passengers) p
        WHERE (p->>'id')::UUID = v_passenger_id;
    END IF;

    -- 4. Procesar Resolución
    IF p_status = 'approved' THEN
        -- REEMBOLSO: Mover de held_balance a balance
        -- Primero verificamos si hay fondos retenidos
        IF EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_passenger_id AND held_balance >= v_amount) THEN
            UPDATE public.wallets
            SET balance = balance + v_amount,
                held_balance = held_balance - v_amount,
                updated_at = NOW()
            WHERE user_id = v_passenger_id
            RETURNING balance INTO v_new_balance;

            -- Registrar Transacción
            INSERT INTO public.wallet_transactions (
                user_id, wallet_id, amount, balance_after, type, description, related_ride_id
            ) VALUES (
                v_passenger_id, v_passenger_id, v_amount, v_new_balance,
                'refund', 'Disputa Aprobada: ' || COALESCE(p_admin_notes, 'Reembolso por cancelación'), v_dispute.ride_id
            );

            -- Notificación
            PERFORM public.create_notification(
                v_passenger_id,
                '💰 Reembolso Aprobado',
                'Se han devuelto ' || v_amount || '€ a tu saldo tras revisar tu disputa.',
                'success',
                jsonb_build_object('ride_id', v_dispute.ride_id)
            );
        ELSE
            -- Si no hay fondos retenidos (quizás ya se pagó al conductor?), devolvemos error para que el admin decida
            RETURN jsonb_build_object('success', false, 'message', 'No hay fondos retenidos suficientes para este reembolso automático.');
        END IF;

    ELSIF p_status = 'rejected' THEN
        -- RECHAZO: No movemos fondos (asumimos que el sistema los liberará al conductor o ya lo hizo)
        -- Simplemente notificamos
        PERFORM public.create_notification(
            v_passenger_id,
            '⚖️ Disputa Revisada',
            'Tu solicitud de reembolso ha sido denegada tras la revisión administrativa.',
            'info',
            jsonb_build_object('ride_id', v_dispute.ride_id)
        );
    END IF;

    -- 5. Actualizar Disputa
    UPDATE public.cancellation_disputes
    SET status = p_status,
        admin_notes = p_admin_notes,
        resolved_at = NOW()
    WHERE id = p_dispute_id;

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
