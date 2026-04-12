-- ==========================================
-- SHAREWAY V2: RISK MITIGATION PHASE 3
-- ANTIFRAUDE EXTERNO (STRIPE CHARGEBACKS)
-- ==========================================

-- Si un pasajero llama a su banco para solicitar la devolución 
-- ilegal de un cobro que se ejecutó correctamente (Chargeback), 
-- Stripe nos cobra los fondos retirados + 15$ de sanción corporativa.
-- Esta función localiza al pasajero, le transfiere el agujero 
-- financiero directamente a su monedero cerrándolo en negativo 
-- y veta su cuenta de la plataforma.

CREATE OR REPLACE FUNCTION public.handle_stripe_dispute(
    p_payment_intent_id TEXT, 
    p_dispute_amount DECIMAL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_ride_id UUID;
    v_penalty DECIMAL := p_dispute_amount + 15.00; -- Monto retirado + Tasa de castigo de Stripe
BEGIN
    -- 1. Localizar al usuario defraudador
    -- Primero buscamos en los registros de promesas de pago (ride_requests)
    SELECT requester_id, ride_id INTO v_user_id, v_ride_id
    FROM public.ride_requests
    WHERE payment_intent_id = p_payment_intent_id
    LIMIT 1;

    -- Si no está ahí (borrado o directo), buscamos directamente por el billete de pasajero montado
    IF v_user_id IS NULL THEN
        SELECT r.id, (p->>'id')::UUID INTO v_ride_id, v_user_id
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE p->>'payment_intent_id' = p_payment_intent_id
        LIMIT 1;
    END IF;

    IF v_user_id IS NOT NULL THEN
        -- 2. Perforar su balance con multas (Permitiendo negativo)
        UPDATE public.wallets 
        SET balance = balance - v_penalty 
        WHERE user_id = v_user_id;

        INSERT INTO public.wallet_transactions (
            user_id, wallet_id, amount, type, description, related_ride_id
        )
        VALUES (
            v_user_id, v_user_id, -v_penalty, 
            'chargeback_penalty', 
            'FRAUDE: Disputa bancaria Stripe (Chargeback) + Gastos de gestión',
            v_ride_id
        );

        -- 3. Suspender perfil preventivamente. Queda bloqueado en el ecosistema.
        UPDATE public.profiles 
        SET status = 'suspended' 
        WHERE id = v_user_id;
        
        -- Si este pasajero era a su vez un conductor reputado, la Fase 1 "Deuda Negativa"
        -- le cancelará implícitamente de publicar viajes automáticamente gracias al balance.
        
        RETURN json_build_object(
            'success', true, 
            'penalized_user', v_user_id, 
            'debt_applied', -v_penalty
        );
    END IF;

    -- Si no encontramos nada, simplemente logueamos la derrota (No debería pasar)
    RETURN json_build_object('success', false, 'error', 'Usuario fantasma en disputa');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
