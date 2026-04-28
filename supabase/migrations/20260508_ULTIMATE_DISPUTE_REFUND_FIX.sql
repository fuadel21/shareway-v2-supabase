-- ==========================================
-- SHAREWAY V2: ULTIMATE DISPUTE RESOLUTION (v3)
-- Unifica la resolución de disputas con reembolsos reales en el Escrow.
-- Corregido para usar la tabla 'transactions' y columnas consistentes.
-- ==========================================

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
    v_wallet_id UUID;
BEGIN
    -- 1. Validar Admin
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'No autorizado');
    END IF;

    -- 2. Obtener la disputa
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
    v_amount := v_dispute.refund_amount;

    -- Si refund_amount es null, intentamos sacarlo de los metadatos del viaje
    IF v_amount IS NULL OR v_amount = 0 THEN
        SELECT (p->>'booked_price')::DECIMAL INTO v_amount
        FROM jsonb_array_elements(v_ride.passengers) p
        WHERE (p->>'id')::UUID = v_passenger_id;
    END IF;

    -- 4. Procesar Resolución
    IF p_status = 'approved' THEN
        -- REEMBOLSO: Mover de held_balance a balance
        -- Primero verificamos si hay fondos retenidos
        SELECT id, balance INTO v_wallet_id, v_new_balance
        FROM public.wallets
        WHERE user_id = v_passenger_id AND held_balance >= v_amount;

        IF v_wallet_id IS NOT NULL THEN
            UPDATE public.wallets
            SET balance = balance + v_amount,
                held_balance = held_balance - v_amount,
                updated_at = NOW()
            WHERE id = v_wallet_id
            RETURNING balance INTO v_new_balance;

            -- Registrar Transacción (Usando la tabla 'transactions' y columnas verificadas)
            INSERT INTO public.transactions (
                user_id, amount, balance_after, type, description, related_ride_id
            ) VALUES (
                v_passenger_id, v_amount, v_new_balance,
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
            -- Si no hay fondos retenidos, podría ser un reembolso de balance directo si el admin lo decide,
            -- o un error si ya se liquidó al conductor.
            RETURN jsonb_build_object('success', false, 'message', 'No hay fondos retenidos suficientes para este reembolso automático. Es posible que el viaje ya se haya liquidado.');
        END IF;

    ELSIF p_status = 'rejected' THEN
        -- RECHAZO: Simplemente notificamos
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
        resolved_at = NOW(),
        admin_id = auth.uid()
    WHERE id = p_dispute_id;

    -- 6. Log de Auditoría Admin
    INSERT INTO public.platform_audit_logs (
        admin_id,
        admin_name,
        action,
        target_key,
        new_value
    )
    SELECT
        auth.uid(),
        p.display_name,
        'DISPUTE_RESOLVED',
        p_dispute_id::TEXT,
        jsonb_build_object('status', p_status, 'amount', v_amount, 'passenger_id', v_passenger_id)
    FROM public.profiles p WHERE p.id = auth.uid();

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
