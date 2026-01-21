-- ==========================================
-- ELITE_SEAT_SHIELD.sql
-- Integridad de Plazas y Blindaje Concurrente
-- ==========================================

-- 1. Actualizar confirm_trip_and_pay para soportar aprobación manual
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_passenger_verification TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_approval_mode TEXT;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID[];
    v_ride_departure TIMESTAMPTZ;
    v_booking_status TEXT;
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Info Pasajero
    SELECT display_name, photo_url, gender, (verification->>'status')
    INTO v_passenger_name, v_passenger_photo, v_passenger_gender, v_passenger_verification
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    IF FALSE THEN
        RAISE EXCEPTION 'Solo usuarios verificados pueden reservar.';
    END IF;

    -- BLOQUEO DE RILA (FOR UPDATE) - Clave para evitar Race Conditions
    SELECT price, seats_available, driver_id, participant_ids, is_women_only, departure_time, approval_mode
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_is_women_only, v_ride_departure, v_approval_mode
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled'
    FOR UPDATE;
    
    IF v_ride_price IS NULL THEN
        RAISE EXCEPTION 'El viaje no está disponible.';
    END IF;

    -- Validaciones
    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'No quedan asientos disponibles.';
    END IF;
    
    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes reservar tu propio viaje.';
    END IF;
    
    IF v_passenger_id = ANY(v_participant_ids) THEN
        RAISE EXCEPTION 'Ya tienes una solicitud o reserva en este viaje.';
    END IF;

    IF v_is_women_only AND (v_passenger_gender IS NULL OR v_passenger_gender != 'female') THEN
        RAISE EXCEPTION 'Este viaje es Solo Mujeres. Tu perfil no es elegible.';
    END IF;

    -- Determinamos status inicial según el modo del conductor
    v_booking_status := CASE WHEN v_approval_mode = 'manual' THEN 'pending' ELSE 'confirmed' END;
    
    -- Chequeo Financiero
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance < v_ride_price THEN
        RAISE EXCEPTION 'Saldo insuficiente.';
    END IF;
    
    -- PIN (Solo se genera si es confirmado, o se genera siempre para el snapshot)
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', v_booking_status,
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    )::JSONB;
    
    -- Retención de Fondos (Escrow)
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -v_ride_price, balance, 
           CASE WHEN v_booking_status = 'confirmed' THEN 'Reserva confirmada' ELSE 'Solicitud de plaza (Pago en garantía)' END, 
           p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;
    
    -- Actualizar Viaje
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        -- SOLO SE DESCUENTA SI ES CONFIRMADO
        seats_available = CASE WHEN v_booking_status = 'confirmed' THEN seats_available - 1 ELSE seats_available END
    WHERE id = p_ride_id;
    
    RETURN json_build_object(
        'success', true, 
        'status', v_booking_status,
        'message', CASE WHEN v_booking_status = 'confirmed' THEN '¡Reserva completada!' ELSE 'Solicitud enviada al conductor.' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. FUNCIÓN: accept_passenger
-- El conductor aprueba una solicitud pendiente
CREATE OR REPLACE FUNCTION public.accept_passenger(
    p_ride_id UUID,
    p_passenger_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_seats_available INTEGER;
    v_passengers JSONB;
    v_new_passengers JSONB;
    v_was_found BOOLEAN := false;
BEGIN
    v_driver_id := auth.uid();
    
    -- BLOQUEO PARANOICO
    SELECT seats_available, passengers
    INTO v_seats_available, v_passengers
    FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id
    FOR UPDATE;
    
    IF v_seats_available IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado o no autorizado.';
    END IF;
    
    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'Ya no tienes plazas libres para este viaje.';
    END IF;
    
    -- Actualizar el estado en el JSONB
    SELECT jsonb_agg(
        CASE 
            WHEN (p->>'id')::UUID = p_passenger_id AND p->>'status' = 'pending' THEN 
                (v_was_found := true) IS NOT NULL AND jsonb_set(p, '{status}', '"confirmed"')
            ELSE p 
        END
    )
    INTO v_new_passengers
    FROM jsonb_array_elements(v_passengers) AS p;
    
    IF NOT v_was_found THEN
        RAISE EXCEPTION 'Solicitud no encontrada o ya procesada.';
    END IF;
    
    -- Aplicar cambios
    UPDATE public.rides
    SET passengers = v_new_passengers,
        seats_available = seats_available - 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'message', 'Pasajero aceptado correctamente.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. FUNCIÓN: reject_passenger
-- El conductor rechaza una solicitud y devuelve el dinero
CREATE OR REPLACE FUNCTION public.reject_passenger(
    p_ride_id UUID,
    p_passenger_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_passengers JSONB;
    v_new_passengers JSONB;
    v_booked_price DECIMAL;
BEGIN
    v_driver_id := auth.uid();
    
    SELECT passengers INTO v_passengers
    FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id
    FOR UPDATE;
    
    -- Extraer el precio retenido
    SELECT (p->>'booked_price')::DECIMAL INTO v_booked_price
    FROM jsonb_array_elements(v_passengers) AS p
    WHERE (p->>'id')::UUID = p_passenger_id AND p->>'status' = 'pending';
    
    IF v_booked_price IS NULL THEN
        RAISE EXCEPTION 'Solicitud pendiente no encontrada.';
    END IF;
    
    -- Devolver dinero al pasajero
    UPDATE public.wallets
    SET balance = balance + v_booked_price,
        held_balance = held_balance - v_booked_price
    WHERE user_id = p_passenger_id;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'refund', v_booked_price, balance, 'Solicitud rechazada por el conductor', p_ride_id
    FROM public.wallets
    WHERE user_id = p_passenger_id;
    
    -- Marcar como rechazado y limpiar IDs
    UPDATE public.rides
    SET passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"rejected"')
                    ELSE p
                END
            )
            FROM jsonb_array_elements(passengers) AS p
        ),
        participant_ids = array_remove(participant_ids, p_passenger_id)
    WHERE id = p_ride_id;
    
    -- Notificar al pasajero
    PERFORM public.create_notification(
        p_passenger_id,
        'Solicitud rechazada',
        'El conductor ha rechazado tu solicitud. Se ha reembolsado el importe retenido.',
        'info',
        jsonb_build_object('ride_id', p_ride_id)
    );
    
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
