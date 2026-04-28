-- ==============================================================================
-- 20260430_FIX_CANCELLATION_NULL_TRANSACTION.sql
-- Propósito: Corregir el error de user_id nulo en transacciones durante la cancelación.
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

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    -- Validar que el conductor es quien cancela (o un admin, pero aquí usamos v_driver_id)
    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'No autorizado para cancelar este viaje');
    END IF;

    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', true, 'message', 'El viaje ya estaba finalizado o cancelado');
    END IF;

    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- 2. CÁLCULO DE PENALIZACIONES (Fair Play)
    IF v_hours_until_departure < 2 THEN
        v_penalty_score := 20;
        v_penalty_rating := 0.5;
        v_penalty_money := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
        v_penalty_score := 10;
        v_penalty_rating := 0.2;
    END IF;

    -- 3. PROCESO FINANCIERO: Reembolso 100% a todos los pasajeros
    IF v_ride_record.passengers IS NOT NULL AND jsonb_array_length(v_ride_record.passengers) > 0 THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            -- Intentar obtener el ID del pasajero de varias formas por compatibilidad
            v_passenger_id := COALESCE(
                (v_passenger->>'id')::UUID,
                (v_passenger->>'user_id')::UUID,
                (v_passenger->>'passenger_id')::UUID
            );

            v_booked_price := COALESCE((v_passenger->>'booked_price')::DECIMAL, 0);

            -- Solo procesar si tenemos un ID válido y el estado es correcto
            IF v_passenger_id IS NOT NULL AND v_passenger->>'status' IN ('confirmed', 'verified') THEN
                -- Reembolsar billetera
                UPDATE public.wallets
                SET held_balance = GREATEST(0, held_balance - v_booked_price),
                    balance = balance + v_booked_price,
                    updated_at = NOW()
                WHERE user_id = v_passenger_id;

                -- Registrar transacción (Aquí es donde fallaba si v_passenger_id era null)
                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso total: Viaje cancelado por conductor. Motivo: ' || p_reason, p_ride_id);

                -- Notificar
                INSERT INTO public.notifications (user_id, type, title, body)
                VALUES (v_passenger_id, 'ride_cancelled', 'Viaje Cancelado: ' || COALESCE(v_ride_record.origin_address, 'Tu viaje'),
                       'El conductor ha cancelado por: ' || p_reason || '. Tu dinero ha sido devuelto al balance.');
            END IF;
        END LOOP;
    END IF;

    -- 4. APLICAR PENALIZACIONES AL CONDUCTOR
    IF v_penalty_score > 0 OR v_penalty_rating > 0 THEN
        UPDATE public.profiles SET
            trust_score = GREATEST(0, trust_score - v_penalty_score),
            rating = GREATEST(1.0, rating - v_penalty_rating),
            updated_at = NOW()
        WHERE id = v_driver_id;
    END IF;

    -- B. Multa económica (si aplica)
    IF v_penalty_money > 0 AND v_driver_id IS NOT NULL THEN
        -- Verificar si el conductor tiene billetera
        PERFORM 1 FROM public.wallets WHERE user_id = v_driver_id;
        IF NOT FOUND THEN
            INSERT INTO public.wallets (user_id, balance, held_balance)
            VALUES (v_driver_id, 0, 0)
            ON CONFLICT (user_id) DO NOTHING;
        END IF;

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

    -- 5. MENSAJE FINAL EN CHAT
    SELECT id INTO v_chat_id FROM public.chats WHERE ride_id = p_ride_id AND type = 'group' LIMIT 1;
    IF v_chat_id IS NOT NULL THEN
        INSERT INTO public.messages (chat_id, sender_id, content)
        VALUES (v_chat_id, v_driver_id, 'SISTEMA: Viaje cancelado. Motivo: ' || p_reason);
    END IF;

    -- 6. CIERRE DE VIAJE
    UPDATE public.rides SET
        status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'penalty_applied', v_penalty_score > 0,
        'trust_points_lost', v_penalty_score,
        'rating_lost', v_penalty_rating
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
