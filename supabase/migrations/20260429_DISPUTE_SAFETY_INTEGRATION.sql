-- ==============================================================================
-- INTEGRACIÓN DE BÓVEDA DE SEGURIDAD CON DISPUTAS (MODO SEGURO)
-- ==============================================================================

-- 1. Añadir columna de referencia en cancellation_disputes sin FK estricta para evitar errores de relación
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cancellation_disputes' AND column_name = 'safety_evidence_id') THEN
        ALTER TABLE public.cancellation_disputes ADD COLUMN safety_evidence_id UUID;
    END IF;
END $$;

-- 2. Actualizar el RPC de creación de disputas
CREATE OR REPLACE FUNCTION public.create_cancellation_dispute(
    p_ride_id UUID,
    p_reason TEXT,
    p_evidence_urls TEXT[] DEFAULT NULL,
    p_safety_evidence_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_dispute_id UUID;
BEGIN
    -- Verificar que el viaje existe y el usuario participaba
    IF NOT EXISTS (
        SELECT 1 FROM public.rides
        WHERE id = p_ride_id AND (driver_id = auth.uid() OR auth.uid() = ANY(participant_ids))
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'No tienes permiso para reportar este viaje');
    END IF;

    -- Insertar la disputa
    INSERT INTO public.cancellation_disputes (
        ride_id,
        user_id,
        reason,
        evidence_urls,
        safety_evidence_id,
        status,
        created_at
    ) VALUES (
        p_ride_id,
        auth.uid(),
        p_reason,
        p_evidence_urls,
        p_safety_evidence_id,
        'pending',
        NOW()
    ) RETURNING id INTO v_dispute_id;

    -- Intentar actualizar el estado de la evidencia si la tabla existe
    BEGIN
        UPDATE public.safety_evidence
        SET status = 'under_investigation'
        WHERE id = p_safety_evidence_id;
    EXCEPTION WHEN OTHERS THEN
        -- Si la tabla no existe o falla, ignoramos este paso para no bloquear la creación de la disputa
        NULL;
    END;

    RETURN jsonb_build_object('success', true, 'dispute_id', v_dispute_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
