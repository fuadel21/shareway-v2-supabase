-- ========================================================
-- MIGRACIÓN: STATE MACHINE REFACTOR V3 (Fase 1)
-- Objetivo: Fulfillment Atómico (Match de Solicitudes) con Escrow Automático
-- ========================================================

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
    v_driver_id UUID;
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_ride_id UUID;
    v_ride_res JSON;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_passenger_obj JSONB;
BEGIN 
    v_driver_id := auth.uid();
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. Obtener datos de la solicitud y del pasajero
    SELECT requester_id INTO v_passenger_id FROM public.ride_requests WHERE id = p_request_id AND status = 'pending';
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'La solicitud ya no está disponible o no existe.'; END IF;

    SELECT display_name, photo_url, gender INTO v_passenger_name, v_passenger_photo, v_passenger_gender
    FROM public.profiles WHERE id = v_passenger_id;

    -- 2. Verificación Financiera del Pasajero (Atomic Check)
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance < p_price THEN 
        RAISE EXCEPTION 'El pasajero no tiene saldo suficiente para cubrir este viaje.'; 
    END IF;

    -- 3. Crear el viaje (usando create_ride para heredar validaciones de solapamiento y precio)
    SELECT public.create_ride(
        p_origin, p_destination, p_departure_time, p_seats, p_price, p_details,
        p_distance, p_overview_polyline, NULL, FALSE, FALSE, '{}', 'automatic', p_waypoints, '{}'
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN 
        RETURN v_ride_res; 
    END IF;

    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- 4. ESCROW: Retener fondos del pasajero y vincularlo al viaje
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    UPDATE public.wallets 
    SET balance = balance - p_price, held_balance = held_balance + p_price 
    WHERE user_id = v_passenger_id;

    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -p_price, balance, 'Reserva automática por Match de Solicitud', v_ride_id
    FROM public.wallets WHERE user_id = v_passenger_id;

    -- 5. Insertar pasajero confirmado en el viaje
    v_passenger_obj := json_build_object(
        'id', v_passenger_id,
        'display_name', v_passenger_name,
        'photo_url', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', NOW()
    )::JSONB;

    UPDATE public.rides 
    SET passengers = jsonb_build_array(v_passenger_obj),
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = v_ride_id;

    -- 6. Cerrar solicitud
    UPDATE public.ride_requests 
    SET status = 'fulfilled', matched_ride_id = v_ride_id 
    WHERE id = p_request_id;

    -- 7. Notificar al pasajero (El trigger tr_ride_notifications se encargará del resto)
    PERFORM public.create_notification(
        v_passenger_id,
        '¡Un conductor ha aceptado tu solicitud!',
        'Se ha creado un viaje nuevo. Tu PIN de abordaje es ' || v_ride_pin,
        'success',
        jsonb_build_object('ride_id', v_ride_id, 'pin', v_ride_pin)
    );

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
