-- ==============================================================================
-- SHAREWAY ELITE: MOTOR UNIFICADO DE CANCELACIONES (DRIVER SIDE)
-- Implementa penalizaciones dinámicas de Trust Score y notificaciones con motivo.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'No especificado')
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_chat_id UUID;
    v_hours_until_departure DECIMAL;
    v_penalty_score INTEGER := 0;
    v_penalty_rating DECIMAL := 0;
    v_penalty_money DECIMAL := 0;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- 1. Bloqueo de seguridad y obtención de datos
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_ENCONTRADO'; END IF;
    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', true, 'message', 'El viaje ya estaba finalizado o cancelado');
    END IF;

    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- 2. CÁLCULO DE PENALIZACIONES (Fair Play)
    -- Si cancela con menos de 2h: -20 puntos, -0.5 estrellas y multa de $5.00
    -- Si cancela entre 2h y 24h: -10 puntos y -0.2 estrellas
    IF v_hours_until_departure < 2 THEN
        v_penalty_score := 20;
        v_penalty_rating := 0.5;
        v_penalty_money := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
        v_penalty_score := 10;
        v_penalty_rating := 0.2;
    END IF;

    -- 3. PROCESO FINANCIERO: Reembolso 100% a todos los pasajeros
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_booked_price := (v_passenger->>'booked_price')::DECIMAL;

        IF v_passenger->>'status' IN ('confirmed', 'verified') THEN
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_booked_price),
                balance = balance + v_booked_price,
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso total: Viaje cancelado por conductor. Motivo: ' || p_reason, p_ride_id);

            INSERT INTO public.notifications (user_id, type, title, body)
            VALUES (v_passenger_id, 'ride_cancelled', 'Viaje Cancelado: ' || v_ride_record.origin->>'name',
                   'El conductor ha cancelado por: ' || p_reason || '. Tu dinero ha sido devuelto al balance.');
        END IF;
    END LOOP;

    -- 4. APLICAR PENALIZACIONES AL CONDUCTOR
    -- A. Reputación
    IF v_penalty_score > 0 OR v_penalty_rating > 0 THEN
        UPDATE public.profiles SET
            trust_score = GREATEST(0, trust_score - v_penalty_score),
            rating = GREATEST(1.0, rating - v_penalty_rating),
            updated_at = NOW()
        WHERE id = v_driver_id;
    END IF;

    -- B. Multa económica (si aplica)
    IF v_penalty_money > 0 THEN
        UPDATE public.wallets SET
            balance = balance - v_penalty_money,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Recaudación en Tesorería
        UPDATE public.wallets SET
            balance = balance + v_penalty_money,
            updated_at = NOW()
        WHERE user_id = v_treasury_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, -v_penalty_money, 'penalty', 'Multa por cancelación tardía (<2h)', p_ride_id);

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_treasury_id, v_penalty_money, 'fee', 'Recaudación multa: Conductor ' || v_driver_id, p_ride_id);
    END IF;

    -- 5. MENSAJE FINAL EN CHAT (Con prefijo SISTEMA para saltar el trigger)
    SELECT id INTO v_chat_id FROM public.chats WHERE ride_id = p_ride_id AND type = 'group' LIMIT 1;
    IF v_chat_id IS NOT NULL THEN
        INSERT INTO public.messages (chat_id, sender_id, content)
        VALUES (v_chat_id, v_driver_id, 'SISTEMA: Viaje cancelado. Motivo: ' || p_reason);
    END IF;

    -- 6. CIERRE DE VIAJE
    UPDATE public.rides SET
        status = 'cancelled',
        updated_at = NOW(),
        cancellation_reason = p_reason -- Asegúrate de tener esta columna o guardarla en un log
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'penalty_applied', v_penalty_score > 0,
        'trust_points_lost', v_penalty_score,
        'rating_lost', v_penalty_rating
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Redireccionar funciones antiguas para mantener compatibilidad con el Frontend
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$ BEGIN RETURN public.cancel_ride_unified(p_ride_id, 'Cancelación general'); END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID, p_reason TEXT)
RETURNS JSON AS $$ BEGIN RETURN public.cancel_ride_unified(p_ride_id, p_reason); END; $$ LANGUAGE plpgsql;
