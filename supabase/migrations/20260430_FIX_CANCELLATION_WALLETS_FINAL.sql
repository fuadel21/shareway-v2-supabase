-- ==============================================================================
-- 20260430_FIX_CANCELLATION_WALLETS_FINAL.sql
-- Parche definitivo para errores de NULL en Wallets/Transactions y esquema de RIDES
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'No especificado')
RETURNS JSON AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_driver_id UUID;
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
    -- 1. Obtener datos del viaje con bloqueo
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    -- Usamos el ID del conductor del registro para mayor seguridad
    v_driver_id := v_ride_record.driver_id;

    -- Validar que quien cancela es el conductor (o tiene permisos)
    IF v_driver_id != v_caller_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'No autorizado para cancelar este viaje');
    END IF;

    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', true, 'message', 'El viaje ya estaba finalizado o cancelado');
    END IF;

    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- 2. CÁLCULO DE PENALIZACIONES
    IF v_hours_until_departure < 2 THEN
        v_penalty_score := 20; v_penalty_rating := 0.5; v_penalty_money := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
        v_penalty_score := 10; v_penalty_rating := 0.2;
    END IF;

    -- 3. REEMBOLSOS A PASAJEROS (Blindado contra NULLs)
    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            v_passenger_id := COALESCE(
                (v_passenger->>'id')::UUID,
                (v_passenger->>'user_id')::UUID
            );
            v_booked_price := COALESCE((v_passenger->>'booked_price')::DECIMAL, 0);

            IF v_passenger_id IS NOT NULL AND v_passenger->>'status' IN ('confirmed', 'verified') THEN
                -- Asegurar billetera del pasajero
                INSERT INTO public.wallets (user_id, balance, held_balance)
                VALUES (v_passenger_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;

                UPDATE public.wallets
                SET held_balance = GREATEST(0, held_balance - v_booked_price),
                    balance = balance + v_booked_price,
                    updated_at = NOW()
                WHERE user_id = v_passenger_id;

                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso por cancelación de viaje: ' || p_reason, p_ride_id);

                INSERT INTO public.notifications (user_id, type, title, body)
                VALUES (v_passenger_id, 'ride_cancelled', 'Viaje Cancelado', 'El conductor ha cancelado el viaje. Se ha devuelto tu dinero.');
            END IF;
        END LOOP;
    END IF;

    -- 4. PENALIZACIONES AL CONDUCTOR
    IF v_penalty_score > 0 OR v_penalty_rating > 0 THEN
        UPDATE public.profiles SET
            trust_score = GREATEST(0, trust_score - v_penalty_score),
            rating = GREATEST(1.0, rating - v_penalty_rating),
            updated_at = NOW()
        WHERE id = v_driver_id;
    END IF;

    IF v_penalty_money > 0 THEN
        -- Asegurar billetera conductor
        INSERT INTO public.wallets (user_id, balance, held_balance)
        VALUES (v_driver_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;

        -- Asegurar billetera tesorería
        INSERT INTO public.wallets (user_id, balance, held_balance)
        VALUES (v_treasury_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;

        UPDATE public.wallets SET balance = balance - v_penalty_money, updated_at = NOW() WHERE user_id = v_driver_id;
        UPDATE public.wallets SET balance = balance + v_penalty_money, updated_at = NOW() WHERE user_id = v_treasury_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, -v_penalty_money, 'penalty', 'Multa por cancelación tardía', p_ride_id);
    END IF;

    -- 5. FINALIZACIÓN
    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado correctamente');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'Error en motor de cancelación: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RE-VINCULACIÓN TOTAL
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$ BEGIN RETURN public.cancel_ride_unified(p_ride_id, 'Cancelación general'); END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID, p_reason TEXT)
RETURNS JSON AS $$ BEGIN RETURN public.cancel_ride_unified(p_ride_id, p_reason); END; $$ LANGUAGE plpgsql SECURITY DEFINER;
