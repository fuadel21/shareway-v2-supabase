-- ========================================================
-- MIGRACIÓN: HARDEN BOOKING FLOW V2 (Principal Engineer Edition)
-- Objetivo: Resolver Overbooking de Escrow y Sincronización
-- ========================================================

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_approval_mode TEXT;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID [];
    v_booking_status TEXT;
    v_departure_time TIMESTAMPTZ;
    v_pending_count INTEGER;
BEGIN 
    v_passenger_id := auth.uid();
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. Obtener Info del Perfil con bloqueo defensivo
    SELECT display_name, photo_url, gender INTO v_passenger_name, v_passenger_photo, v_passenger_gender
    FROM public.profiles WHERE id = v_passenger_id;

    -- 2. Bloqueo de Fila del Viaje para evitar Race Conditions (Shadow Inventory)
    SELECT price, seats_available, driver_id, participant_ids, is_women_only, approval_mode, departure_time 
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_is_women_only, v_approval_mode, v_departure_time
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    -- 3. Validaciones de Disponibilidad y Reglas de Negocio
    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_departure_time <= NOW() THEN RAISE EXCEPTION 'VIAJE_EXPIRADO'; END IF;
    IF v_seats_available <= 0 THEN RAISE EXCEPTION 'SIN_PLAZAS_LIBRES'; END IF;
    IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'AUTORESERVA_PROHIBIDA'; END IF;
    IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'YA_EN_VIAJE'; END IF;

    -- 4. VALIDACIÓN DE GÉNERO (Fallo 3)
    IF v_is_women_only THEN
        IF v_passenger_gender IS NULL THEN
            RAISE EXCEPTION 'PERFIL_GENERO_INCOMPLETO';
        END IF;
        IF LOWER(v_passenger_gender) != 'female' THEN
            RAISE EXCEPTION 'SOLO_MUJERES_PERMITIDO';
        END IF;
    END IF;

    -- 5. CONTROL DE "ESTAMPIDA DE PENDIENTES" (Fallo 1)
    IF v_approval_mode = 'manual' THEN
        SELECT count(*) INTO v_pending_count 
        FROM jsonb_array_elements(COALESCE((SELECT passengers FROM public.rides WHERE id = p_ride_id), '[]'::jsonb)) p
        WHERE p->>'status' = 'pending';

        IF v_pending_count >= (v_seats_available * 2) THEN
            RAISE EXCEPTION 'VIAJE_SATURADO_SOLICITUDES';
        END IF;
    END IF;

    -- 6. Verificación de Saldo (Atomic Check)
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'SALDO_INSUFICIENTE'; END IF;

    -- 7. Preparar Datos de Reserva
    v_booking_status := CASE WHEN v_approval_mode = 'manual' THEN 'pending' ELSE 'confirmed' END;
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'display_name', v_passenger_name,
        'photo_url', v_passenger_photo,
        'status', v_booking_status,
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    )::JSONB;

    -- 8. OPERACIÓN FINANCIERA (Atomic Escrow)
    UPDATE public.wallets 
    SET balance = balance - v_ride_price, 
        held_balance = held_balance + v_ride_price 
    WHERE user_id = v_passenger_id;

    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -v_ride_price, balance, 
           'Reserva plaza: ' || v_booking_status, p_ride_id
    FROM public.wallets WHERE user_id = v_passenger_id;

    -- 9. ACTUALIZACIÓN DE VIAJE (Sincronización Fallo 4)
    UPDATE public.rides 
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = CASE WHEN v_booking_status = 'confirmed' THEN seats_available - 1 ELSE seats_available END
    WHERE id = p_ride_id;

    -- 10. Limpieza de Solicitudes Externas
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    RETURN json_build_object('success', true, 'status', v_booking_status, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
