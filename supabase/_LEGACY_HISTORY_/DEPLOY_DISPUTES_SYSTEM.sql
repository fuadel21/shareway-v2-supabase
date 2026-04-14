-- ==========================================
-- SCRIPT DE DESPLIEGUE COMPLETO
-- Sistema de Disputas y Penalizaciones
-- ==========================================
-- IMPORTANTE: Ejecuta este script en el SQL Editor de Supabase
-- Tiempo estimado: 2-3 minutos
-- ==========================================

-- ==========================================
-- PASO 1: MODIFICAR TABLA PROFILES
-- ==========================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS suspension_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_count_30d INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_cancellation_check TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN public.profiles.is_suspended IS 'Indica si la cuenta está suspendida temporalmente';
COMMENT ON COLUMN public.profiles.suspension_until IS 'Fecha hasta la cual la cuenta está suspendida';
COMMENT ON COLUMN public.profiles.cancellation_count_30d IS 'Número de cancelaciones en los últimos 30 días';
COMMENT ON COLUMN public.profiles.last_cancellation_check IS 'Última vez que se verificó el contador de cancelaciones';

-- ==========================================
-- PASO 2: CREAR TABLA CANCELLATION_DISPUTES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.cancellation_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    user_type TEXT NOT NULL CHECK (user_type IN ('driver', 'passenger')),
    reason TEXT NOT NULL,
    evidence_urls TEXT[],
    refund_amount NUMERIC(10, 2),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_disputes_user_id ON public.cancellation_disputes(user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_ride_id ON public.cancellation_disputes(ride_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.cancellation_disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON public.cancellation_disputes(created_at DESC);

COMMENT ON TABLE public.cancellation_disputes IS 'Disputas de cancelación por fuerza mayor';

-- ==========================================
-- PASO 3: CONFIGURAR ROW LEVEL SECURITY
-- ==========================================

ALTER TABLE public.cancellation_disputes ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes si existen
DROP POLICY IF EXISTS "Users can view their own disputes" ON public.cancellation_disputes;
DROP POLICY IF EXISTS "Users can create their own disputes" ON public.cancellation_disputes;
DROP POLICY IF EXISTS "Admins can view all disputes" ON public.cancellation_disputes;
DROP POLICY IF EXISTS "Admins can update disputes" ON public.cancellation_disputes;

-- Crear políticas
CREATE POLICY "Users can view their own disputes"
  ON public.cancellation_disputes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own disputes"
  ON public.cancellation_disputes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all disputes"
  ON public.cancellation_disputes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update disputes"
  ON public.cancellation_disputes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- ==========================================
-- PASO 4: CREAR FUNCIONES RPC
-- ==========================================

-- Función: create_cancellation_dispute
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
    ELSE
        SELECT 5.0 INTO v_refund_amount;
    END IF;

    INSERT INTO public.cancellation_disputes (
        ride_id, user_id, user_type, reason, evidence_urls, refund_amount
    ) VALUES (
        p_ride_id, v_user_id, v_user_type, p_reason, p_evidence_urls, v_refund_amount
    ) RETURNING id INTO v_dispute_id;

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

-- Función: resolve_cancellation_dispute
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
               'Reembolso excepcional por fuerza mayor (Disputa aprobada)', v_ride_id
        FROM public.wallets WHERE user_id = v_user_id;

        PERFORM public.create_notification(
            v_user_id,
            'Disputa Aprobada',
            'Tu solicitud de reembolso por fuerza mayor ha sido aprobada. Se ha ingresado ' || v_refund_amount || '€ en tu saldo.',
            'success',
            jsonb_build_object('dispute_id', p_dispute_id, 'amount', v_refund_amount)
        );
    ELSE
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

-- Función: check_cancellation_abuse
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
    SELECT last_cancellation_check INTO v_last_check
    FROM public.profiles WHERE id = p_user_id;

    IF v_last_check < NOW() - INTERVAL '30 days' THEN
        UPDATE public.profiles
        SET cancellation_count_30d = 0,
            last_cancellation_check = NOW()
        WHERE id = p_user_id;
        
        RETURN json_build_object('success', true, 'action', 'reset_counter');
    END IF;

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

-- Función: lift_suspension_if_expired
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
-- PASO 5: CREAR TRIGGERS
-- ==========================================

CREATE OR REPLACE FUNCTION public.trigger_check_cancellation_abuse()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        PERFORM public.check_cancellation_abuse(NEW.driver_id);
        
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

-- ==========================================
-- VERIFICACIÓN FINAL
-- ==========================================

DO $$
BEGIN
    RAISE NOTICE '✅ Script ejecutado exitosamente';
    RAISE NOTICE '✅ Tabla cancellation_disputes creada';
    RAISE NOTICE '✅ 4 funciones RPC creadas';
    RAISE NOTICE '✅ Trigger automático activado';
    RAISE NOTICE '✅ Políticas RLS configuradas';
    RAISE NOTICE '';
    RAISE NOTICE '🎉 Sistema de Disputas y Penalizaciones LISTO';
END $$;
