-- ==========================================
-- SISTEMA DE DISPUTAS Y PENALIZACIONES
-- Gestión de cancelaciones por fuerza mayor y abusos
-- ==========================================

-- ==========================================
-- FUNCIÓN: create_cancellation_dispute
-- Crear una disputa por cancelación de fuerza mayor
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_cancellation_dispute(
    p_ride_id UUID,
    p_reason TEXT,
    p_evidence_urls TEXT[] DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_user_type TEXT;
    v_dispute_id UUID;
    v_ride_status TEXT;
    v_refund_amount DECIMAL;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Verificar que el viaje existe y obtener su estado
    SELECT status INTO v_ride_status FROM public.rides WHERE id = p_ride_id;
    
    IF v_ride_status IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe';
    END IF;

    IF v_ride_status NOT IN ('cancelled', 'scheduled') THEN
        RAISE EXCEPTION 'Solo se pueden disputar viajes cancelados o programados';
    END IF;

    -- Determinar si es conductor o pasajero
    SELECT 
        CASE 
            WHEN driver_id = v_user_id THEN 'driver'
            WHEN v_user_id = ANY(participant_ids) THEN 'passenger'
            ELSE NULL
        END INTO v_user_type
    FROM public.rides WHERE id = p_ride_id;

    IF v_user_type IS NULL THEN
        RAISE EXCEPTION 'No eres parte de este viaje';
    END IF;

    -- Calcular el monto potencial de reembolso
    IF v_user_type = 'passenger' THEN
        SELECT (passenger->>'booked_price')::DECIMAL INTO v_refund_amount
        FROM public.rides, jsonb_array_elements(passengers) AS passenger
        WHERE id = p_ride_id AND (passenger->>'id')::UUID = v_user_id;
    ELSE
        -- Para conductores, calcular penalización que pagaron
        SELECT 5.0 INTO v_refund_amount; -- Máxima penalización
    END IF;

    -- Crear la disputa
    INSERT INTO public.cancellation_disputes (
        ride_id, user_id, user_type, reason, evidence_urls, refund_amount
    ) VALUES (
        p_ride_id, v_user_id, v_user_type, p_reason, p_evidence_urls, v_refund_amount
    ) RETURNING id INTO v_dispute_id;

    -- Notificar a los administradores
    INSERT INTO public.notifications (user_id, title, message, type, data)
    SELECT 
        id,
        'Nueva Disputa de Cancelación',
        'Un usuario ha solicitado revisión de una cancelación por fuerza mayor.',
        'admin',
        jsonb_build_object('dispute_id', v_dispute_id, 'ride_id', p_ride_id)
    FROM public.profiles WHERE is_admin = true;

    RETURN json_build_object(
        'success', true, 
        'disputeId', v_dispute_id,
        'message', 'Disputa creada. Un administrador la revisará pronto.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- FUNCIÓN: resolve_cancellation_dispute
-- Resolver una disputa (solo administradores)
-- ==========================================
CREATE OR REPLACE FUNCTION public.resolve_cancellation_dispute(
    p_dispute_id UUID,
    p_status TEXT,
    p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_user_id UUID;
    v_ride_id UUID;
    v_refund_amount DECIMAL;
    v_user_type TEXT;
BEGIN
    v_admin_id := auth.uid();
    
    -- Verificar que es administrador
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND is_admin = true) THEN
        RAISE EXCEPTION 'Solo los administradores pueden resolver disputas';
    END IF;

    -- Obtener datos de la disputa
    SELECT user_id, ride_id, refund_amount, user_type
    INTO v_user_id, v_ride_id, v_refund_amount, v_user_type
    FROM public.cancellation_disputes
    WHERE id = p_dispute_id AND status = 'pending';

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Disputa no encontrada o ya resuelta';
    END IF;

    -- Actualizar la disputa
    UPDATE public.cancellation_disputes
    SET status = p_status,
        admin_id = v_admin_id,
        admin_notes = p_admin_notes,
        resolved_at = NOW()
    WHERE id = p_dispute_id;

    -- Si se aprueba, procesar el reembolso excepcional
    IF p_status = 'approved' AND v_refund_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_refund_amount
        WHERE user_id = v_user_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
        SELECT id, user_id, 'dispute_refund', v_refund_amount, balance, 
               'Reembolso excepcional por fuerza mayor (Disputa aprobada)', v_ride_id
        FROM public.wallets WHERE user_id = v_user_id;

        -- Notificar al usuario
        PERFORM public.create_notification(
            v_user_id,
            'Disputa Aprobada',
            'Tu solicitud de reembolso por fuerza mayor ha sido aprobada. Se ha ingresado ' || v_refund_amount || '€ en tu saldo.',
            'success',
            jsonb_build_object('dispute_id', p_dispute_id, 'amount', v_refund_amount)
        );
    ELSE
        -- Notificar rechazo
        PERFORM public.create_notification(
            v_user_id,
            'Disputa Rechazada',
            'Tu solicitud de revisión ha sido rechazada. ' || COALESCE(p_admin_notes, 'Revisa las políticas de cancelación.'),
            'warning',
            jsonb_build_object('dispute_id', p_dispute_id)
        );
    END IF;

    RETURN json_build_object('success', true, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- FUNCIÓN: check_cancellation_abuse
-- Verificar y penalizar cancelaciones abusivas
-- ==========================================
CREATE OR REPLACE FUNCTION public.check_cancellation_abuse(
    p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_cancellation_count INTEGER;
    v_rating_penalty DECIMAL := 0;
    v_should_suspend BOOLEAN := FALSE;
    v_last_check TIMESTAMPTZ;
BEGIN
    -- Obtener última verificación
    SELECT last_cancellation_check INTO v_last_check
    FROM public.profiles WHERE id = p_user_id;

    -- Si han pasado más de 30 días, resetear contador
    IF v_last_check < NOW() - INTERVAL '30 days' THEN
        UPDATE public.profiles
        SET cancellation_count_30d = 0,
            last_cancellation_check = NOW()
        WHERE id = p_user_id;
        
        RETURN json_build_object('success', true, 'action', 'reset_counter');
    END IF;

    -- Contar cancelaciones en los últimos 30 días
    SELECT COUNT(*) INTO v_cancellation_count
    FROM public.rides
    WHERE status = 'cancelled'
    AND cancelled_at > NOW() - INTERVAL '30 days'
    AND (
        driver_id = p_user_id 
        OR p_user_id = ANY(
            SELECT (passenger->>'id')::UUID 
            FROM jsonb_array_elements(passengers) AS passenger
        )
    );

    -- Actualizar contador
    UPDATE public.profiles
    SET cancellation_count_30d = v_cancellation_count,
        last_cancellation_check = NOW()
    WHERE id = p_user_id;

    -- Aplicar penalizaciones según el número de cancelaciones
    IF v_cancellation_count >= 5 THEN
        v_should_suspend := TRUE;
        v_rating_penalty := 0.3;
    ELSIF v_cancellation_count >= 3 THEN
        v_rating_penalty := 0.1;
    END IF;

    -- Aplicar penalización en rating
    IF v_rating_penalty > 0 THEN
        UPDATE public.profiles
        SET rating = GREATEST(rating - v_rating_penalty, 1.0)
        WHERE id = p_user_id;
    END IF;

    -- Aplicar suspensión temporal
    IF v_should_suspend THEN
        UPDATE public.profiles
        SET is_suspended = TRUE,
            suspension_until = NOW() + INTERVAL '7 days'
        WHERE id = p_user_id;

        -- Notificar al usuario
        PERFORM public.create_notification(
            p_user_id,
            'Cuenta Suspendida Temporalmente',
            'Tu cuenta ha sido suspendida por 7 días debido a múltiples cancelaciones. Podrás volver a usar Shareway el ' || 
            to_char(NOW() + INTERVAL '7 days', 'DD/MM/YYYY') || '.',
            'error',
            jsonb_build_object('suspension_until', NOW() + INTERVAL '7 days')
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'cancellation_count', v_cancellation_count,
        'rating_penalty', v_rating_penalty,
        'suspended', v_should_suspend
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- FUNCIÓN: lift_suspension_if_expired
-- Levantar suspensiones que ya expiraron
-- ==========================================
CREATE OR REPLACE FUNCTION public.lift_suspension_if_expired()
RETURNS JSON AS $$
DECLARE
    v_lifted_count INTEGER;
BEGIN
    UPDATE public.profiles
    SET is_suspended = FALSE,
        suspension_until = NULL
    WHERE is_suspended = TRUE
    AND suspension_until < NOW();

    GET DIAGNOSTICS v_lifted_count = ROW_COUNT;

    RETURN json_build_object('success', true, 'lifted_count', v_lifted_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- TRIGGER: Verificar abuso al cancelar viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.trigger_check_cancellation_abuse()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- Verificar abuso del conductor
        PERFORM public.check_cancellation_abuse(NEW.driver_id);
        
        -- Verificar abuso de cada pasajero
        PERFORM public.check_cancellation_abuse((passenger->>'id')::UUID)
        FROM jsonb_array_elements(NEW.passengers) AS passenger;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_ride_cancelled_check_abuse ON public.rides;
CREATE TRIGGER on_ride_cancelled_check_abuse
    AFTER UPDATE ON public.rides
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
    EXECUTE FUNCTION public.trigger_check_cancellation_abuse();
