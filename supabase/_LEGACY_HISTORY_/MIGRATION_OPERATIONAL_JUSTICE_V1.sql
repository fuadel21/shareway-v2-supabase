-- ========================================================
-- MIGRACIÓN: JUSTICIA OPERATIVA v1.0
-- Objetivo: Penalizaciones selectivas, ventana deslizante de abusos y protección del pasajero.
-- ========================================================

-- 1. MEJORA: check_cancellation_abuse (Ventana Deslizante Real)
CREATE OR REPLACE FUNCTION public.check_cancellation_abuse(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_cancellation_count INTEGER;
    v_rating_penalty DECIMAL := 0;
    v_should_suspend BOOLEAN := FALSE;
BEGIN
    -- Contar cancelaciones reales (donde el usuario fue el RESPONSABLE)
    -- Asumimos que guardamos el responsable en audit_logs o similar, 
    -- pero por ahora filtramos por transacciones de penalización (cancellation_fee o penalty)
    SELECT COUNT(*) INTO v_cancellation_count
    FROM public.transactions
    WHERE user_id = p_user_id 
      AND type IN ('cancellation_fee', 'hold_forfeited') -- Tipos que indican que el usuario canceló mal
      AND created_at > NOW() - INTERVAL '30 days';

    -- Actualizar contador en el perfil
    UPDATE public.profiles
    SET cancellation_count_30d = v_cancellation_count,
        last_cancellation_check = NOW()
    WHERE id = p_user_id;

    -- Escala de justicia
    IF v_cancellation_count >= 5 THEN
        v_should_suspend := TRUE;
        v_rating_penalty := 0.5;
    ELSIF v_cancellation_count >= 3 THEN
        v_rating_penalty := 0.2;
    END IF;

    -- Aplicar penalización de Rating
    IF v_rating_penalty > 0 THEN
        UPDATE public.profiles
        SET rating = GREATEST(rating - v_rating_penalty, 1.0)
        WHERE id = p_user_id;
    END IF;

    -- Suspensión
    IF v_should_suspend THEN
        UPDATE public.profiles
        SET is_suspended = TRUE,
            suspension_until = NOW() + INTERVAL '7 days'
        WHERE id = p_user_id;

        PERFORM public.create_notification(
            p_user_id,
            'Cuenta Suspendida',
            'Tu cuenta ha sido bloqueada 7 días por reincidencia en cancelaciones.',
            'error'
        );
    END IF;

    RETURN json_build_object('cancellations', v_cancellation_count, 'suspended', v_should_suspend);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. MEJORA: Trigger de Cancelación (PROTECCIÓN AL PASAJERO)
CREATE OR REPLACE FUNCTION public.trigger_check_cancellation_abuse()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el viaje completo se cancela, el responsable es el CONDUCTOR.
    -- NO penalizamos a los pasajeros, ellos son las víctimas aquí.
    PERFORM public.check_cancellation_abuse(NEW.driver_id);
    
    -- Notificar a los pasajeros (esto ya estaba, pero aseguramos que NO se les penalice)
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. MEJORA: create_cancellation_dispute (Validación de Pérdida Real)
CREATE OR REPLACE FUNCTION public.create_cancellation_dispute(
    p_ride_id UUID,
    p_reason TEXT,
    p_evidence_urls TEXT[] DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_has_penalty BOOLEAN;
    v_dispute_id UUID;
BEGIN
    -- VALIDACIÓN CLAVE: ¿Realmente perdió dinero este usuario?
    -- Solo permitimos disputas si hubo una transacción de penalización o pérdida.
    SELECT EXISTS (
        SELECT 1 FROM public.transactions 
        WHERE user_id = v_user_id AND related_ride_id = p_ride_id 
        AND type IN ('cancellation_fee', 'trip_payment') -- O tipos donde no hubo reembolso total
    ) INTO v_has_penalty;

    IF NOT v_has_penalty THEN
        RAISE EXCEPTION 'NO_HAY_PERDIDA: No se detectaron penalizaciones económicas en este viaje para tu cuenta.';
    END IF;

    INSERT INTO public.cancellation_disputes (
        ride_id, user_id, reason, evidence_urls, status
    ) VALUES (
        p_ride_id, v_user_id, p_reason, p_evidence_urls, 'pending'
    ) RETURNING id INTO v_dispute_id;

    RETURN json_build_object('success', true, 'disputeId', v_dispute_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
