-- ==============================================================================
-- 20260512_ELITE_ULTIMATE_INTEGRITY_CONSOLIDATION.sql
-- Escaneo Profundo y Blindaje Final: Cartera, Cancelaciones, Matching y Seguridad.
-- ==============================================================================

-- 1. SEGURIDAD: Restringir create_notification a uso interno/RPC únicamente
-- Evita que los usuarios puedan spamear notificaciones vía RPC directa.
REVOKE EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM public;
-- Solo permitimos al service_role (backend) y a las funciones Security Definer (esta misma)
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- 2. CARTERA: Permitir balances negativos para penalizaciones (Deuda)
-- Es preferible que un conductor deba dinero a que no pueda cancelar un viaje por falta de saldo.
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallet_balance_non_negative;

-- 3. SEGURIDAD: Blindar complete_passenger_dropoff
-- Solo el conductor del viaje puede marcar una parada como completada.
CREATE OR REPLACE FUNCTION public.complete_passenger_dropoff(
    p_ride_id UUID,
    p_passenger_id UUID
) RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_new_passengers JSONB := '[]'::JSONB;
    v_found BOOLEAN := FALSE;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10;
    v_driver_id UUID;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- 1. Validar existencia y propiedad
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.driver_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'error', 'No autorizado: No eres el conductor');
    END IF;

    IF v_ride_record.status != 'active' THEN
        RETURN json_build_object('success', false, 'error', 'Solo se pueden finalizar paradas en viajes activos (Estado actual: ' || v_ride_record.status || ')');
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- 2. Procesar pasajero
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF (v_passenger->>'id')::UUID = p_passenger_id THEN
            IF v_passenger->>'status' != 'completed' THEN
                v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
                v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);
                v_platform_fee := v_booked_price - v_payout_amount;

                -- A. Liberar Held del pasajero
                UPDATE public.wallets
                SET held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_booked_price),
                    updated_at = NOW()
                WHERE user_id = p_passenger_id;

                -- B. Pagar al conductor (90%)
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0) + v_payout_amount,
                    updated_at = NOW()
                WHERE user_id = v_driver_id;

                -- C. Comisión a Tesorería (10%)
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0) + v_platform_fee,
                    updated_at = NOW()
                WHERE user_id = v_treasury_id;

                -- D. Historial
                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (p_passenger_id, -v_booked_price, 'payment', 'Pago trayecto finalizado', p_ride_id);

                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_driver_id, v_payout_amount, 'payout', 'Ingreso pasajero entregado', p_ride_id);

                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_treasury_id, v_platform_fee, 'fee', 'Comisión servicio: ' || p_ride_id, p_ride_id);

                v_passenger := v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW());
                v_found := TRUE;
            END IF;
        END IF;
        v_new_passengers := v_new_passengers || v_passenger;
    END LOOP;

    IF v_found THEN
        UPDATE public.rides SET passengers = v_new_passengers, updated_at = NOW() WHERE id = p_ride_id;

        -- Auto-cierre del viaje
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_new_passengers) AS p
            WHERE p->>'status' NOT IN ('completed', 'cancelled')
        ) THEN
            UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;
        END IF;

        RETURN json_build_object('success', true, 'message', 'Entrega procesada y fondos liberados');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Pasajero no encontrado o ya entregado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FINANZAS: Corregir fuga de comisiones en complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_total_payout NUMERIC := 0;
    v_platform_fee_total NUMERIC := 0;
    v_ride_status TEXT;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    SELECT status INTO v_ride_status FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autorizado o viaje no encontrado');
    END IF;

    IF v_ride_status NOT IN ('active', 'scheduled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'El viaje ya no puede ser liquidado (Estado: ' || v_ride_status || ')');
    END IF;

    FOR v_passenger IN
        SELECT (p->>'id')::UUID as id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) as price,
               COALESCE((p->>'seats_booked')::INTEGER, (p->>'num_seats')::INTEGER, 1) as seats,
               (p->>'status') as status
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE r.id = p_ride_id
    LOOP
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
        BEGIN
            IF v_passenger.status = 'verified' THEN
                DECLARE
                    v_net_payout NUMERIC := v_subtotal * 0.90;
                    v_fee NUMERIC := v_subtotal * 0.10;
                BEGIN
                    -- A. Pagar al conductor
                    UPDATE public.wallets
                    SET balance = COALESCE(balance, 0.00) + v_net_payout, updated_at = NOW()
                    WHERE user_id = v_driver_id;

                    -- B. Liberar del pasajero
                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, COALESCE(held_balance, 0.00) - v_subtotal), updated_at = NOW()
                    WHERE user_id = v_passenger.id;

                    -- C. Pagar a Tesorería
                    UPDATE public.wallets
                    SET balance = COALESCE(balance, 0.00) + v_fee, updated_at = NOW()
                    WHERE user_id = v_treasury_id;

                    -- Historial
                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso finalización viaje');

                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_treasury_id, v_fee, 'fee', p_ride_id, 'Comisión servicio trayecto');

                    v_total_payout := v_total_payout + v_net_payout;
                    v_platform_fee_total := v_platform_fee_total + v_fee;
                END;
            ELSIF v_passenger.status = 'confirmed' THEN
                -- REEMBOLSO: No subió
                UPDATE public.wallets
                SET balance = balance + v_subtotal,
                    held_balance = GREATEST(0, held_balance - v_subtotal),
                    updated_at = NOW()
                WHERE user_id = v_passenger.id;
            END IF;
        END;
    END LOOP;

    UPDATE public.rides
    SET status = 'completed', updated_at = NOW(), completed_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'payout', v_total_payout, 'fee', v_platform_fee_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CANCELACIÓN: Restaurar penalizaciones al conductor con blindajeUUID
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
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado'); END IF;
    IF v_ride_record.driver_id != v_driver_id THEN RETURN jsonb_build_object('success', false, 'message', 'No autorizado'); END IF;
    IF v_ride_record.status NOT IN ('scheduled', 'active') THEN
        RETURN jsonb_build_object('success', false, 'message', 'No se puede cancelar en estado ' || v_ride_record.status);
    END IF;

    -- A. Cálculos de penalización Fair Play
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;
    IF v_hours_until_departure < 2 THEN
        v_penalty_score := 20; v_penalty_rating := 0.5; v_penalty_money := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
        v_penalty_score := 10; v_penalty_rating := 0.2;
    END IF;

    -- B. Reembolso a pasajeros
    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            v_p_id_str := COALESCE(v_passenger->>'id', v_passenger->>'user_id');
            IF v_p_id_str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                v_passenger_id := v_p_id_str::UUID;
                v_booked_price := COALESCE((v_passenger->>'booked_price')::NUMERIC, 0) * COALESCE((v_passenger->>'seats_booked')::INTEGER, 1);

                IF v_passenger->>'status' IN ('confirmed', 'verified') THEN
                    UPDATE public.wallets SET held_balance = GREATEST(0, held_balance - v_booked_price), balance = balance + v_booked_price, updated_at = NOW() WHERE user_id = v_passenger_id;
                    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id) VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso: Conductor canceló', p_ride_id);
                    PERFORM public.create_notification(v_passenger_id, 'ride_cancelled', 'Viaje Cancelado', 'El conductor canceló el trayecto. Dinero devuelto.', jsonb_build_object('ride_id', p_ride_id));
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- C. Aplicar penalización al conductor
    IF v_penalty_money > 0 THEN
        UPDATE public.wallets SET balance = balance - v_penalty_money, updated_at = NOW() WHERE user_id = v_driver_id;
        UPDATE public.wallets SET balance = balance + v_penalty_money, updated_at = NOW() WHERE user_id = v_treasury_id;
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id) VALUES (v_driver_id, -v_penalty_money, 'penalty', 'Cargo por cancelación tardía', p_ride_id);
    END IF;

    IF v_penalty_score > 0 OR v_penalty_rating > 0 THEN
        UPDATE public.profiles SET trust_score = GREATEST(0, trust_score - v_penalty_score), rating = GREATEST(1.0, rating - v_penalty_rating), updated_at = NOW() WHERE id = v_driver_id;
        PERFORM public.log_reputation_change(v_driver_id, 'trust_score', -v_penalty_score, 0, 'Cancelación tardía', p_ride_id);
    END IF;

    UPDATE public.rides SET status = 'cancelled', updated_at = NOW(), cancellation_reason = p_reason WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado', 'penalty', v_penalty_money);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. ACTIVIDAD: Corregir fetch_my_activity_v2 para incluir cancelados del pasajero
CREATE OR REPLACE FUNCTION public.fetch_my_activity_v2(p_user_id UUID)
RETURNS SETOF JSONB AS $$
BEGIN
RETURN QUERY
-- 1. CONDUCTOR
SELECT jsonb_build_object('id',r.id,'driver_id',r.driver_id,'origin',r.origin,'destination',r.destination,'departure_time',r.departure_time,'status',r.status,'price',r.price,'seats_available',r.seats_available,'role','driver','created_at',r.created_at)
FROM public.rides r WHERE r.driver_id = p_user_id
UNION ALL
-- 2. PASAJERO (Confirmados o Cancelados que estuvieron dentro)
SELECT jsonb_build_object('id',r.id,'driver_id',r.driver_id,'origin',r.origin,'destination',r.destination,'departure_time',r.departure_time,'status',r.status,'price',r.price,'seats_available',r.seats_available,'role','passenger','created_at',r.created_at)
FROM public.rides r WHERE r.driver_id != p_user_id AND (
    (r.participant_ids @> ARRAY [p_user_id]) OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) p WHERE (p->>'id')::UUID = p_user_id)
)
UNION ALL
-- 3. SOLICITANTE (Solo pendientes)
SELECT jsonb_build_object('id',r.id,'driver_id',r.driver_id,'origin',r.origin,'destination',r.destination,'departure_time',r.departure_time,'status','requested','price',r.price,'role','requester','request_id',rr.id,'created_at',r.created_at)
FROM public.ride_requests rr JOIN public.rides r ON r.id = rr.ride_id
WHERE rr.passenger_id = p_user_id AND rr.status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
