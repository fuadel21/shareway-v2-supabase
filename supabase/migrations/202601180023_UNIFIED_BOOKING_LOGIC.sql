
-- ==============================================================================
-- 20260118_UNIFIED_BOOKING_LOGIC.sql
-- Propósito: Corregir error de "Function not found" añadiendo parámetros faltantes.
-- ==============================================================================

-- 1. Limpieza para evitar conflictos de sobrecarga
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, text, jsonb, decimal);

-- 2. Versión Robusta de CONFIRM TRIP AND PAY (Compatible con tu Frontend)
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
BEGIN 
    IF v_passenger_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Obtener datos del perfil
    SELECT full_name, photo_url INTO v_passenger_name, v_passenger_photo
    FROM public.profiles WHERE id = v_passenger_id;

    -- Obtener datos del viaje con bloqueo de fila
    SELECT price, seats_available, driver_id INTO v_ride_price, v_seats_available, v_driver_id
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN 
        RAISE EXCEPTION 'El viaje no está disponible para reserva';
    END IF;

    IF v_seats_available <= 0 THEN 
        RAISE EXCEPTION 'Lo sentimos, ya no quedan asientos disponibles';
    END IF;

    IF v_driver_id = v_passenger_id THEN 
        RAISE EXCEPTION 'No puedes reservar tu propio viaje';
    END IF;

    -- Verificar Saldo
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id;
    IF v_wallet_balance < v_ride_price THEN 
        RAISE EXCEPTION 'Saldo insuficiente en tu wallet';
    END IF;

    -- Generar PIN de seguridad de 4 dígitos
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Crear objeto de pasajero
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Usuario'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW(),
        'pickup_address', p_pickup_address
    )::JSONB;

    -- TRANSACCIÓN FINANCIERA (Escrow)
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

    -- Si venía de una solicitud previa, marcarla como completada
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    -- Registrar transacción informativa
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -v_ride_price, 'booking', 'Reserva de viaje (Saldo retenido)', p_ride_id);

    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
