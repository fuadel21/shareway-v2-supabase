-- ========================================================
-- MIGRACIÓN: DISPUTE & ABUSE REFACTOR
-- Objetivo: Penalizaciones justas y sistema de evidencias
-- Nivel: Principal Engineer / Trust & Safety
-- ========================================================

-- 1. REPARACIÓN DEL TRIGGER DE ABUSO
CREATE OR REPLACE FUNCTION public.trigger_check_cancellation_abuse()
RETURNS TRIGGER AS $$
BEGIN
    -- CASO A: El conductor cancela el viaje completo
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- Solo penalizamos al conductor, los pasajeros son víctimas
        PERFORM public.check_cancellation_abuse(NEW.driver_id);
    END IF;
    
    -- CASO B: Un pasajero cancela su plaza individual (Gestionado por el RPC de cancelación)
    -- Esta lógica se dispara cuando el JSONB de passengers cambia su status a 'cancelled'
    -- (Opcional: Se puede implementar un check específico aquí si se desea)
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. MEJORA DEL RPC DE CREACIÓN DE DISPUTA
CREATE OR REPLACE FUNCTION public.create_cancellation_dispute(
    p_ride_id UUID,
    p_reason TEXT,
    p_evidence_urls TEXT[] DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_type TEXT;
    v_dispute_id UUID;
    v_refund_amount DECIMAL;
BEGIN
    -- Validar si es parte del viaje
    SELECT 
        CASE 
            WHEN driver_id = v_user_id THEN 'driver'
            WHEN v_user_id = ANY(participant_ids) THEN 'passenger'
            ELSE NULL
        END INTO v_user_type
    FROM public.rides WHERE id = p_ride_id;

    IF v_user_type IS NULL THEN RAISE EXCEPTION 'No autorizado para este viaje.'; END IF;

    -- Extraer el precio que pagó el pasajero para proponer el reembolso
    IF v_user_type = 'passenger' THEN
        SELECT (p->>'booked_price')::DECIMAL INTO v_refund_amount
        FROM public.rides, jsonb_array_elements(passengers) p
        WHERE id = p_ride_id AND (p->>'id')::UUID = v_user_id;
    ELSE
        v_refund_amount := 0; -- El conductor no recibe reembolso, solicita anular penalización
    END IF;

    INSERT INTO public.cancellation_disputes (
        ride_id, user_id, user_type, reason, evidence_urls, refund_amount, status
    ) VALUES (
        p_ride_id, v_user_id, v_user_type, p_reason, p_evidence_urls, v_refund_amount, 'pending'
    ) RETURNING id INTO v_dispute_id;

    -- Alerta Admin Inmediata
    PERFORM public.create_notification(
        (SELECT id FROM public.profiles WHERE is_admin = true LIMIT 1),
        'Urgente: Nueva Disputa',
        'Se ha registrado una solicitud de arbitraje por cancelación.',
        'error',
        jsonb_build_object('dispute_id', v_dispute_id)
    );

    RETURN json_build_object('success', true, 'disputeId', v_dispute_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
