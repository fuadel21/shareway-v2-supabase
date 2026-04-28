-- ==========================================
-- SHAREWAY ELITE: BLINDAJE DE CONCURRENCIA EN MATCHING
-- Propósito: Evitar "Double-Accept" en solicitudes mediante bloqueos FOR UPDATE.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
    p_request_id UUID,
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger_id UUID;
    v_ride_id UUID;
    v_ride_res JSON;
    v_passenger_obj JSONB;
    v_wallet_balance DECIMAL;
BEGIN
    -- 1. BLOQUEO SELECTIVO (Evita que otro conductor procese esta solicitud a la vez)
    SELECT requester_id INTO v_passenger_id
    FROM public.ride_requests
    WHERE id = p_request_id AND status = 'pending'
    FOR UPDATE SKIP LOCKED; -- Solo si está disponible y no bloqueada por otra tx

    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'La solicitud ya no está disponible o está siendo procesada por otro conductor.';
    END IF;

    -- 2. VERIFICACIÓN DE SALDO (Bloqueo de billetera para integridad financiera)
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id FOR UPDATE;

    IF v_wallet_balance < p_price THEN
        -- Si no tiene saldo, cancelamos la solicitud por falta de fondos
        UPDATE public.ride_requests SET status = 'failed_funds' WHERE id = p_request_id;
        RAISE EXCEPTION 'Integridad Financiera: El pasajero no dispone de saldo suficiente (%€).', p_price;
    END IF;

    -- 3. CREACIÓN DEL VIAJE (Aprovechando el nuevo esquema de 10 parámetros)
    -- Usamos el p_request_id como base para la idempotencia del match
    SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_waypoints,
        p_request_id -- Idempotency Key vinculada a la solicitud
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN
        RETURN v_ride_res;
    END IF;

    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- 4. MOVIMIENTO DE FONDOS (Escrow Atómico)
    UPDATE public.wallets
    SET balance = balance - p_price,
        held_balance = held_balance + p_price,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- Registrar Transacción
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -p_price, 'hold', 'Retención automática por Match aceptado', v_ride_id);

    -- 5. VINCULACIÓN DE PASAJERO
    v_passenger_obj := jsonb_build_object(
        'id', v_passenger_id,
        'status', 'confirmed',
        'pin', LPAD(FLOOR(RANDOM()*9000+1000)::text, 4, '0'),
        'booked_price', p_price,
        'joined_at', NOW()
    );

    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::jsonb) || v_passenger_obj,
        seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_passenger_id)
    WHERE id = v_ride_id;

    -- 6. FINALIZACIÓN DE SOLICITUD
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        updated_at = NOW()
    WHERE id = p_request_id;

    -- 7. AUDITORÍA ELITE
    PERFORM public.log_platform_audit(
        'Match',
        'REQUEST_FULFILLED',
        v_driver_id,
        jsonb_build_object('ride_id', v_ride_id, 'request_id', p_request_id, 'passenger_id', v_passenger_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'rideId', v_ride_id,
        'message', 'Match blindado ejecutado con éxito'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
