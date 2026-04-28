-- ==========================================
-- 20260509_FIX_TRANSACTION_HISTORY.sql
-- Reparación del Historial de Transacciones (Cobros y Reservas)
-- ==========================================

-- 1. Actualizar confirm_trip_and_pay para registrar la transacción de reserva
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,
    p_num_seats INTEGER DEFAULT 1
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_val_price NUMERIC;
    v_val_seats INTEGER;
    v_pin TEXT;
    v_total_cost NUMERIC;
    v_origin_address TEXT;
    v_dest_address TEXT;
BEGIN
    -- Bloqueo de fila y obtención de datos del viaje
    SELECT price, seats_available, origin_address, destination_address
    INTO v_val_price, v_val_seats, v_origin_address, v_dest_address
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_val_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_val_seats < p_num_seats THEN RAISE EXCEPTION 'PLAZAS_INSUFICIENTES'; END IF;

    v_total_cost := COALESCE(p_price, v_val_price) * p_num_seats;
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Transacción financiera (Update Wallet)
    UPDATE public.wallets SET
        balance = balance - v_total_cost,
        held_balance = held_balance + v_total_cost
    WHERE user_id = v_me;

    -- REGISTRO EN HISTORIAL (Insert Transaction para el Pasajero)
    INSERT INTO public.transactions (
        user_id,
        amount,
        type,
        related_ride_id,
        description
    ) VALUES (
        v_me,
        -v_total_cost,
        'hold',
        p_ride_id,
        'Reserva viaje: ' || COALESCE(v_origin_address, 'Origen') || ' -> ' || COALESCE(v_dest_address, 'Destino')
    );

    -- Actualización de plazas y pasajeros
    UPDATE public.rides
    SET seats_available = seats_available - p_num_seats,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me,
            'status', 'confirmed',
            'pin', v_pin,
            'booked_price', COALESCE(p_price, v_val_price),
            'seats_booked', p_num_seats,
            'pickup_address', p_pickup_address
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin, 'total_paid', v_total_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Actualizar fulfill_ride_request para registrar la transacción cuando el conductor acepta
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
    p_request_id UUID,
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT NULL,
    p_overview_polyline TEXT DEFAULT NULL,
    p_waypoints JSONB DEFAULT '[]'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger_id UUID;
    v_ride_id UUID;
    v_ride_res JSON;
    v_passenger_obj JSONB;
BEGIN
    -- Verificar solicitud
    SELECT requester_id INTO v_passenger_id
    FROM public.ride_requests
    WHERE id = p_request_id AND status = 'pending' FOR UPDATE;

    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'Solicitud no disponible.'; END IF;

    -- Crear el viaje
    SELECT public.create_ride(
        p_origin, p_destination, p_departure_time, p_seats, p_price,
        p_details, p_distance, p_overview_polyline, p_waypoints
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN RETURN v_ride_res; END IF;
    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- Cobro y actualización del pasajero
    UPDATE public.wallets
    SET balance = balance - p_price,
        held_balance = held_balance + p_price
    WHERE user_id = v_passenger_id;

    -- REGISTRO EN HISTORIAL (Para el Pasajero)
    INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
    ) VALUES (
        v_passenger_id,
        -p_price,
        'hold',
        v_ride_id,
        'Reserva aceptada: ' || COALESCE(p_origin->>'address', 'Origen') || ' -> ' || COALESCE(p_destination->>'address', 'Destino')
    );

    -- Marcar solicitud como cumplida
    UPDATE public.ride_requests SET status = 'fulfilled', driver_id = v_driver_id, matched_ride_id = v_ride_id WHERE id = p_request_id;

    -- Añadir pasajero al viaje
    v_passenger_obj := jsonb_build_object(
        'id', v_passenger_id,
        'seats_booked', 1,
        'status', 'confirmed',
        'booked_price', p_price,
        'pin', LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0')
    );

    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::jsonb) || v_passenger_obj,
        seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_passenger_id)
    WHERE id = v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Asegurar que complete_ride use una descripción clara con ruta para el conductor
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_total_payout NUMERIC := 0;
    v_platform_fee_total NUMERIC := 0;
    v_ride_status TEXT;
    v_origin_address TEXT;
    v_dest_address TEXT;
BEGIN
    -- Bloqueo y obtención de ruta
    SELECT status, origin_address, destination_address
    INTO v_ride_status, v_origin_address, v_dest_address
    FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Viaje no encontrado o no eres el conductor');
    END IF;

    IF v_ride_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este viaje ya fue liquidado anteriormente');
    END IF;

    -- Procesamiento de pasajeros
    FOR v_passenger IN
        SELECT (p->>'id')::UUID as id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) as price,
               COALESCE((p->>'seats_booked')::INTEGER, 1) as seats,
               (p->>'status') as status
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE r.id = p_ride_id
    LOOP
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
        BEGIN
            IF v_passenger.status = 'verified' OR v_passenger.status = 'confirmed' THEN
                DECLARE
                    v_net_payout NUMERIC := v_subtotal * 0.90;
                BEGIN
                    UPDATE public.wallets SET balance = COALESCE(balance, 0.00) + v_net_payout WHERE user_id = v_driver_id;
                    UPDATE public.wallets SET held_balance = COALESCE(held_balance, 0.00) - v_subtotal WHERE user_id = v_passenger.id;

                    -- Registro para el CONDUCTOR (Cobro)
                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (
                        v_driver_id,
                        v_net_payout,
                        'payout',
                        p_ride_id,
                        'Cobro viaje: ' || COALESCE(v_origin_address, 'Origen') || ' -> ' || COALESCE(v_dest_address, 'Destino')
                    );

                    -- Registro para el PASAJERO (Finalización)
                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (
                        v_passenger.id,
                        0,
                        'payment_finalized',
                        p_ride_id,
                        'Viaje finalizado: ' || COALESCE(v_origin_address, 'Origen') || ' -> ' || COALESCE(v_dest_address, 'Destino')
                    );

                    v_total_payout := v_total_payout + v_net_payout;
                END;
            ELSE
                -- Devolución si no se verificó
                UPDATE public.wallets SET balance = balance + v_subtotal, held_balance = held_balance - v_subtotal WHERE user_id = v_passenger.id;

                INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                VALUES (v_passenger.id, v_subtotal, 'refund', p_ride_id, 'Reembolso: Pasajero no verificado');
            END IF;
        END;
    END LOOP;

    UPDATE public.rides SET status = 'completed', updated_at = NOW() WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Actualizar process_payout_elite para registrar la salida de dinero en el historial
CREATE OR REPLACE FUNCTION public.process_payout_elite(p_payout_id UUID, p_action TEXT, p_notes TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_amount DECIMAL;
BEGIN
    SELECT user_id, amount INTO v_user_id, v_amount FROM public.payout_requests WHERE id = p_payout_id;

    IF p_action = 'approve' THEN
        -- Restar de la wallet
        UPDATE public.wallets SET balance = balance - v_amount WHERE user_id = v_user_id;

        -- Registrar Transacción (Retiro) para el historial visible del usuario
        INSERT INTO public.transactions (user_id, amount, type, description)
        VALUES (v_user_id, -v_amount, 'withdrawal', 'Retiro aprobado: ' || COALESCE(p_notes, 'Transferencia bancaria'));

        -- Marcar como completado
        UPDATE public.payout_requests
        SET status = 'completed', admin_notes = p_notes, completed_at = now()
        WHERE id = p_payout_id;

    ELSIF p_action = 'reject' THEN
        UPDATE public.payout_requests SET status = 'rejected', admin_notes = p_notes WHERE id = p_payout_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
