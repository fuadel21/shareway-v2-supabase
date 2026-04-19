
-- ==============================================================================
-- 20260118_FINAL_INTEGRITY_PATCH.sql
-- Propósito: Blindaje total de la lógica de viajes, reservas y notificaciones.
--            Incluye: Prevención de duplicados, GPS de recogida y alertas real-time.
-- ==============================================================================

-- 1. CORRECCIÓN DE CONFIRM TRIP AND PAY (Reserva de plaza)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL,
        p_pickup_location JSONB DEFAULT NULL,
        p_price DECIMAL DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID := auth.uid();
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_already_booked BOOLEAN;
BEGIN 
    IF v_passenger_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- BLOQUEO DE FILA Y OBTENCIÓN DE DATOS
    SELECT price, seats_available, driver_id, (v_passenger_id = ANY(participant_ids))
    INTO v_ride_price, v_seats_available, v_driver_id, v_already_booked
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN 
        RAISE EXCEPTION 'El viaje no está disponible para reserva';
    END IF;

    -- EVITAR DUPLICADOS (Race Condition Shield)
    IF v_already_booked THEN
        RAISE EXCEPTION 'ALREADY_BOOKED: Ya tienes una reserva activa en este viaje';
    END IF;

    IF v_seats_available <= 0 THEN 
        RAISE EXCEPTION 'SIN_PLAZAS_LIBRES: Lo sentimos, ya no quedan asientos disponibles';
    END IF;

    IF v_driver_id = v_passenger_id THEN 
        RAISE EXCEPTION 'PROPIO_VIAJE: No puedes reservar tu propio viaje';
    END IF;

    -- Verificar Saldo
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id;
    IF v_wallet_balance < v_ride_price THEN 
        RAISE EXCEPTION 'SALDO_INSUFICIENTE: Saldo insuficiente en tu wallet';
    END IF;

    -- Generar PIN
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Obtener datos del perfil del pasajero
    SELECT full_name, photo_url INTO v_passenger_name, v_passenger_photo
    FROM public.profiles WHERE id = v_passenger_id;

    -- Crear objeto de pasajero con COORDENADAS GPS
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Usuario'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW(),
        'pickup_address', p_pickup_address,
        'pickup_location', p_pickup_location
    )::JSONB;

    -- TRANSACCIÓN FINANCIERA
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;

    -- ACTUALIZAR VIAJE
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;

    -- Si venía de una solicitud previa
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    -- Auditoría
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -v_ride_price, 'booking', 'Reserva de viaje (Saldo retenido)', p_ride_id);

    -- NOTIFICACIÓN AL CONDUCTOR
    PERFORM public.create_notification(
        v_driver_id,
        'ride_accepted', -- Usamos este tipo para indicar reserva confirmada
        '¡Nueva plaza reservada!',
        COALESCE(v_passenger_name, 'Un pasajero') || ' ha reservado una plaza en tu viaje.',
        json_build_object('ride_id', p_ride_id, 'passenger_id', v_passenger_id)
    );

    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. CANCELACIÓN DE RESERVA POR EL PASAJERO (Con Reembolso y Notificación)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
    v_refund_amount DECIMAL;
    v_penalty_amount DECIMAL;
    v_refund_percent DECIMAL;
    v_hours_until_departure DECIMAL;
    v_status_msg TEXT;
    v_passenger_name TEXT;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;

    SELECT p INTO v_passenger_entry 
    FROM jsonb_array_elements(v_ride_record.passengers) AS p 
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' != 'cancelled';

    IF v_passenger_entry IS NULL THEN
        RAISE EXCEPTION 'No tienes una reserva activa en este viaje';
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    v_passenger_name := v_passenger_entry->>'displayName';
    
    -- Lógica de tiempos para reembolso
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    IF v_hours_until_departure < 0 OR v_hours_until_departure > 24 THEN
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total';
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_percent := 0.5;
        v_status_msg := 'Reembolso del 50%';
    ELSE
        v_refund_percent := 0.0;
        v_status_msg := 'Sin reembolso (menos de 2h)';
    END IF;

    v_refund_amount := v_booked_price * v_refund_percent;
    v_penalty_amount := v_booked_price - v_refund_amount;

    -- Wallet
    UPDATE public.wallets
    SET held_balance = held_balance - v_booked_price,
        balance = balance + v_refund_amount
    WHERE user_id = v_passenger_id;

    -- Transacciones
    IF v_refund_amount > 0 THEN
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_passenger_id, v_refund_amount, 'refund', v_status_msg, p_ride_id);
    END IF;

    -- Actualizar Viaje
    UPDATE public.rides
    SET seats_available = seats_available + 1,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(
                CASE WHEN (p->>'id')::UUID = v_passenger_id THEN p || jsonb_build_object('status', 'cancelled', 'cancelled_at', NOW()) ELSE p END
            ) FROM jsonb_array_elements(v_ride_record.passengers) p
        )
    WHERE id = p_ride_id;

    -- NOTIFICACIÓN AL CONDUCTOR
    PERFORM public.create_notification(
        v_ride_record.driver_id,
        'ride_cancelled',
        'Plaza liberada',
        v_passenger_name || ' ha cancelado su reserva. Tu plaza vuelve a estar disponible.',
        json_build_object('ride_id', p_ride_id)
    );

    RETURN json_build_object('success', true, 'refunded', v_refund_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. CANCELACIÓN DE VIAJE POR EL CONDUCTOR (Con Reembolsos y Alertas a todos)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'No autorizado'; END IF;

    -- Reembolsar a todos
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_booked_price := (v_passenger->>'booked_price')::DECIMAL;

        IF v_passenger->>'status' = 'confirmed' THEN
            UPDATE public.wallets 
            SET held_balance = held_balance - v_booked_price,
                balance = balance + v_booked_price
            WHERE user_id = v_passenger_id;

            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, v_booked_price, 'refund', 'Viaje cancelado por conductor', p_ride_id);

            -- NOTIFICACIÓN A CADA PASAJERO
            PERFORM public.create_notification(
                v_passenger_id,
                'ride_cancelled',
                'Viaje cancelado por el conductor',
                'El conductor ha cancelado el viaje. Se te ha devuelto el importe íntegro a tu saldo.',
                json_build_object('ride_id', p_ride_id)
            );
        END IF;
    END LOOP;

    UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alias de compatibilidad
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID) RETURNS JSON AS $$
BEGIN RETURN public.cancel_ride(p_ride_id); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
