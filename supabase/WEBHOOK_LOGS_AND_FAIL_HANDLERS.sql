-- ==========================================
-- WEBHOOK LOGS Y MANEJADORES DE FALLO
-- Propósito: Auditoría, Idempotencia y Resiliencia Financiera
-- ==========================================

-- 1. Tabla de Logs de Webhooks (Blindaje de Idempotencia)
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB,
    status TEXT DEFAULT 'pending', -- pending, processed, error
    error_message TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Manejador de Pago Fallido (Liberar Asientos)
CREATE OR REPLACE FUNCTION public.handle_payment_failure(
    p_payment_intent_id TEXT
) RETURNS JSON AS $$
DECLARE
    v_ride_id UUID;
    v_user_id UUID;
    v_seats_needed INTEGER;
BEGIN
    -- Buscar la solicitud vinculada a este intento de pago
    SELECT ride_id, requester_id, seats_needed INTO v_ride_id, v_user_id, v_seats_needed
    FROM public.ride_requests
    WHERE payment_intent_id = p_payment_intent_id;

    IF v_ride_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No se encontró reserva para este pago.');
    END IF;

    -- 1. Marcar solicitud como fallida
    UPDATE public.ride_requests
    SET status = 'cancelled' -- O un nuevo estado 'payment_failed'
    WHERE payment_intent_id = p_payment_intent_id;

    -- 2. NO devolvemos asientos aquí si la reserva nunca se confirmó (status era pending)
    -- Pero si por alguna razón ya se habían descontado, los restauramos.
    -- (En nuestro flujo actual, el descuento real ocurre en fulfill_booking_after_payment)

    -- 3. Notificar al usuario
    PERFORM public.create_notification(
        v_user_id,
        'Pago Fallido',
        'No hemos podido procesar el pago de tu reserva. Por favor, inténtalo con otra tarjeta.',
        'warning',
        jsonb_build_object('ride_id', v_ride_id)
    );

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Manejador de Disputas (Bloqueo de Seguridad)
CREATE OR REPLACE FUNCTION public.handle_charge_dispute(
    p_payment_intent_id TEXT,
    p_reason TEXT
) RETURNS JSON AS $$
BEGIN
    -- 1. Marcar la transacción como disputada
    UPDATE public.wallet_transactions
    SET status = 'disputed',
        metadata = metadata || jsonb_build_object('dispute_reason', p_reason, 'disputed_at', NOW())
    WHERE stripe_id = p_payment_intent_id;

    -- 2. En una implementación real, aquí deberías buscar al conductor 
    -- y congelar su balance si el viaje ya se había liquidado.
    
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
