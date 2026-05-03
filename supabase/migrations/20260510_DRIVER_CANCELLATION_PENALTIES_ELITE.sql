-- ==========================================
-- 20260510_DRIVER_CANCELLATION_PENALTIES_ELITE.sql
-- Restaura penalizaciones económicas y de reputación al conductor por cancelaciones tardías.
-- Mantiene el blindaje UUID contra datos corruptos.
-- ==========================================

-- 0. Limpieza para cambio de JSON a JSONB
DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'Cancelación operativa')
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price NUMERIC;
    v_p_id_str TEXT;
    v_hours_until_departure NUMERIC;
    -- Penalizaciones
    v_penalty_score INTEGER := 0;
    v_penalty_rating NUMERIC := 0;
    v_penalty_money NUMERIC := 0;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- 1. Bloqueo y obtención de datos
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'No autorizado: No eres el conductor');
    END IF;

    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', true, 'message', 'El viaje ya estaba finalizado o cancelado');
    END IF;

    -- 2. CÁLCULO DE PENALIZACIONES (Fair Play)
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    -- Si cancela con menos de 2h: -20 puntos Trust, -0.5 estrellas y multa de $5.00
    IF v_hours_until_departure < 2 THEN
        v_penalty_score := 20;
        v_penalty_rating := 0.5;
        v_penalty_money := 5.00;
    -- Si cancela entre 2h y 24h: -10 puntos Trust y -0.2 estrellas
    ELSIF v_hours_until_departure < 24 THEN
        v_penalty_score := 10;
        v_penalty_rating := 0.2;
    END IF;

    -- 3. REEMBOLSO A PASAJEROS (Held -> Balance)
    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            v_p_id_str := COALESCE(v_passenger->>'id', v_passenger->>'user_id');

            -- Blindaje UUID
            IF v_p_id_str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                v_passenger_id := v_p_id_str::UUID;
                v_booked_price := COALESCE((v_passenger->>'booked_price')::NUMERIC, 0) * COALESCE((v_passenger->>'seats_booked')::INTEGER, 1);

                IF v_passenger->>'status' != 'cancelled' AND v_passenger_id IS NOT NULL THEN
                    -- Devolución al pasajero
                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, held_balance - v_booked_price),
                        balance = balance + v_booked_price
                    WHERE user_id = v_passenger_id;

                    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                    VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso total: Conductor canceló (' || v_status_msg || ')', p_ride_id);

                    PERFORM public.create_notification(
                        v_passenger_id,
                        'ride_cancelled',
                        'Viaje Cancelado',
                        'El conductor ha cancelado el viaje: ' || p_reason || '. Se ha devuelto tu dinero.',
                        jsonb_build_object('ride_id', p_ride_id)
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 4. APLICAR PENALIZACIONES AL CONDUCTOR
    -- A. Reputación
    IF v_penalty_score > 0 OR v_penalty_rating > 0 THEN
        DECLARE
            v_new_trust INTEGER;
            v_new_rating NUMERIC;
        BEGIN
            UPDATE public.profiles SET
                trust_score = GREATEST(0, trust_score - v_penalty_score),
                rating = GREATEST(1.0, rating - v_penalty_rating),
                updated_at = NOW()
            WHERE id = v_driver_id
            RETURNING trust_score, rating INTO v_new_trust, v_new_rating;

            -- Registrar en historial
            IF v_penalty_score > 0 THEN
                PERFORM public.log_reputation_change(v_driver_id, 'trust_score', -v_penalty_score, v_new_trust, 'Cancelación tardía de viaje (<' ||
                    CASE WHEN v_hours_until_departure < 2 THEN '2' ELSE '24' END || 'h)', p_ride_id);
            END IF;
            IF v_penalty_rating > 0 THEN
                PERFORM public.log_reputation_change(v_driver_id, 'rating', -v_penalty_rating, v_new_rating, 'Penalización de estrellas por cancelación tardía', p_ride_id);
            END IF;
        END;
    END IF;

    -- B. Multa económica (Hacia Tesorería)
    IF v_penalty_money > 0 THEN
        -- Descontar al conductor (CHECK en balance >= 0 actuará si es necesario)
        UPDATE public.wallets SET
            balance = balance - v_penalty_money,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Sumar a Tesorería
        UPDATE public.wallets SET
            balance = balance + v_penalty_money,
            updated_at = NOW()
        WHERE user_id = v_treasury_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, -v_penalty_money, 'penalty', 'Multa por cancelación tardía conductor', p_ride_id);

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_treasury_id, v_penalty_money, 'fee', 'Multa recaudada: Conductor ' || v_driver_id, p_ride_id);
    END IF;

    -- 5. CIERRE DE VIAJE
    UPDATE public.rides SET
        status = 'cancelled',
        updated_at = NOW(),
        cancellation_reason = p_reason
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Viaje cancelado correctamente',
        'penalty_applied', v_penalty_money > 0,
        'trust_points_lost', v_penalty_score,
        'money_lost', v_penalty_money
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
