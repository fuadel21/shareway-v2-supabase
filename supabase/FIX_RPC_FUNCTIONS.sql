-- ==========================================
-- CORRECCIÓN: Recrear Funciones RPC
-- ==========================================
-- Este script corrige el error de las funciones
-- ==========================================

-- Eliminar funciones existentes si hay problemas
DROP FUNCTION IF EXISTS public.create_cancellation_dispute(UUID, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.resolve_cancellation_dispute(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.check_cancellation_abuse(UUID);
DROP FUNCTION IF EXISTS public.lift_suspension_if_expired();

-- Recrear: create_cancellation_dispute
CREATE OR REPLACE FUNCTION public.create_cancellation_dispute(
    p_ride_id UUID,
    p_reason TEXT,
    p_evidence_urls TEXT[] DEFAULT NULL
)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
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

    SELECT status INTO v_ride_status FROM public.rides WHERE id = p_ride_id;
    
    IF v_ride_status IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe';
    END IF;

    IF v_ride_status NOT IN ('cancelled', 'scheduled') THEN
        RAISE EXCEPTION 'Solo se pueden disputar viajes cancelados o programados';
    END IF;

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

    IF v_user_type = 'passenger' THEN
        SELECT (passenger->>'booked_price')::DECIMAL INTO v_refund_amount
        FROM public.rides, jsonb_array_elements(passengers) AS passenger
        WHERE id = p_ride_id AND (passenger->>'id')::UUID = v_user_id;
        
        IF v_refund_amount IS NULL THEN
            v_refund_amount := 0;
        END IF;
    ELSE
        v_refund_amount := 5.0;
    END IF;

    INSERT INTO public.cancellation_disputes (
        ride_id, user_id, user_type, reason, evidence_urls, refund_amount
    ) VALUES (
        p_ride_id, v_user_id, v_user_type, p_reason, p_evidence_urls, v_refund_amount
    ) RETURNING id INTO v_dispute_id;

    -- Notificar admins solo si la tabla notifications existe
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
        INSERT INTO public.notifications (user_id, title, message, type, data)
        SELECT 
            id,
            'Nueva Disputa de Cancelación',
            'Un usuario ha solicitado revisión de una cancelación por fuerza mayor.',
            'admin',
            jsonb_build_object('dispute_id', v_dispute_id, 'ride_id', p_ride_id)
        FROM public.profiles WHERE is_admin = true;
    END IF;

    RETURN json_build_object(
        'success', true, 
        'disputeId', v_dispute_id,
        'message', 'Disputa creada. Un administrador la revisará pronto.'
    );
END;
$$;

-- Recrear: resolve_cancellation_dispute
CREATE OR REPLACE FUNCTION public.resolve_cancellation_dispute(
    p_dispute_id UUID,
    p_status TEXT,
    p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_id UUID;
    v_user_id UUID;
    v_ride_id UUID;
    v_refund_amount DECIMAL;
    v_user_type TEXT;
BEGIN
    v_admin_id := auth.uid();
    
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND is_admin = true) THEN
        RAISE EXCEPTION 'Solo los administradores pueden resolver disputas';
    END IF;

    SELECT user_id, ride_id, refund_amount, user_type
    INTO v_user_id, v_ride_id, v_refund_amount, v_user_type
    FROM public.cancellation_disputes
    WHERE id = p_dispute_id AND status = 'pending';

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Disputa no encontrada o ya resuelta';
    END IF;

    UPDATE public.cancellation_disputes
    SET status = p_status,
        admin_id = v_admin_id,
        admin_notes = p_admin_notes,
        resolved_at = NOW()
    WHERE id = p_dispute_id;

    IF p_status = 'approved' AND v_refund_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_refund_amount
        WHERE user_id = v_user_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
        SELECT id, user_id, 'dispute_refund', v_refund_amount, balance, 
               'Reembolso excepcional por fuerza mayor', v_ride_id
        FROM public.wallets WHERE user_id = v_user_id;

        IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'create_notification') THEN
            PERFORM public.create_notification(
                v_user_id,
                'Disputa Aprobada',
                'Tu solicitud ha sido aprobada. Reembolso: ' || v_refund_amount || '€',
                'success',
                jsonb_build_object('dispute_id', p_dispute_id, 'amount', v_refund_amount)
            );
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'create_notification') THEN
            PERFORM public.create_notification(
                v_user_id,
                'Disputa Rechazada',
                COALESCE(p_admin_notes, 'Tu solicitud ha sido rechazada.'),
                'warning',
                jsonb_build_object('dispute_id', p_dispute_id)
            );
        END IF;
    END IF;

    RETURN json_build_object('success', true, 'status', p_status);
END;
$$;

-- Recrear: check_cancellation_abuse
CREATE OR REPLACE FUNCTION public.check_cancellation_abuse(
    p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cancellation_count INTEGER;
    v_rating_penalty DECIMAL := 0;
    v_should_suspend BOOLEAN := FALSE;
    v_last_check TIMESTAMPTZ;
BEGIN
    SELECT last_cancellation_check INTO v_last_check
    FROM public.profiles WHERE id = p_user_id;

    IF v_last_check IS NULL OR v_last_check < NOW() - INTERVAL '30 days' THEN
        UPDATE public.profiles
        SET cancellation_count_30d = 0,
            last_cancellation_check = NOW()
        WHERE id = p_user_id;
        
        RETURN json_build_object('success', true, 'action', 'reset_counter');
    END IF;

    SELECT COUNT(*) INTO v_cancellation_count
    FROM public.rides
    WHERE status = 'cancelled'
    AND cancelled_at IS NOT NULL
    AND cancelled_at > NOW() - INTERVAL '30 days'
    AND (
        driver_id = p_user_id 
        OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(passengers) AS passenger
            WHERE (passenger->>'id')::UUID = p_user_id
        )
    );

    UPDATE public.profiles
    SET cancellation_count_30d = v_cancellation_count,
        last_cancellation_check = NOW()
    WHERE id = p_user_id;

    IF v_cancellation_count >= 5 THEN
        v_should_suspend := TRUE;
        v_rating_penalty := 0.3;
    ELSIF v_cancellation_count >= 3 THEN
        v_rating_penalty := 0.1;
    END IF;

    IF v_rating_penalty > 0 THEN
        UPDATE public.profiles
        SET rating = GREATEST(rating - v_rating_penalty, 1.0)
        WHERE id = p_user_id;
    END IF;

    IF v_should_suspend THEN
        UPDATE public.profiles
        SET is_suspended = TRUE,
            suspension_until = NOW() + INTERVAL '7 days'
        WHERE id = p_user_id;

        IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'create_notification') THEN
            PERFORM public.create_notification(
                p_user_id,
                'Cuenta Suspendida',
                'Suspendida por 7 días debido a múltiples cancelaciones.',
                'error',
                jsonb_build_object('suspension_until', NOW() + INTERVAL '7 days')
            );
        END IF;
    END IF;

    RETURN json_build_object(
        'success', true,
        'cancellation_count', v_cancellation_count,
        'rating_penalty', v_rating_penalty,
        'suspended', v_should_suspend
    );
END;
$$;

-- Recrear: lift_suspension_if_expired
CREATE OR REPLACE FUNCTION public.lift_suspension_if_expired()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_lifted_count INTEGER;
BEGIN
    UPDATE public.profiles
    SET is_suspended = FALSE,
        suspension_until = NULL
    WHERE is_suspended = TRUE
    AND suspension_until IS NOT NULL
    AND suspension_until < NOW();

    GET DIAGNOSTICS v_lifted_count = ROW_COUNT;

    RETURN json_build_object('success', true, 'lifted_count', v_lifted_count);
END;
$$;

-- Verificación
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    AND routine_name IN (
        'create_cancellation_dispute',
        'resolve_cancellation_dispute',
        'check_cancellation_abuse',
        'lift_suspension_if_expired'
    );
    
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════';
    IF v_count = 4 THEN
        RAISE NOTICE '✅ CORRECCIÓN EXITOSA';
        RAISE NOTICE '✅ Las 4 funciones RPC están creadas correctamente';
    ELSE
        RAISE NOTICE '⚠️  Solo % funciones encontradas', v_count;
    END IF;
    RAISE NOTICE '════════════════════════════════════════════════';
    RAISE NOTICE '';
END $$;
