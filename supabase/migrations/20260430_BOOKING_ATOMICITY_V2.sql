-- ==============================================================================
-- 20260430_BOOKING_ATOMICITY_V2.sql
-- Propósito: Garantizar integridad financiera total y evitar doble cobro.
-- ==============================================================================

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
    v_wallet_exists BOOLEAN;
BEGIN
    -- 1. Seguridad Básica
    IF v_passenger_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión expirada');
    END IF;

    -- 2. Evitar Doble Reserva (Crucial para Mobile)
    IF EXISTS (
        SELECT 1 FROM public.rides
        WHERE id = p_ride_id AND v_passenger_id = ANY(participant_ids)
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Ya tienes una reserva activa en este viaje');
    END IF;

    -- 3. Obtener y Bloquear Datos del Viaje
    SELECT price, seats_available, driver_id INTO v_ride_price, v_seats_available, v_driver_id
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'El viaje ya no está disponible');
    END IF;

    IF v_seats_available <= 0 THEN
        RETURN json_build_object('success', false, 'message', 'Lo sentimos, ya no quedan asientos');
    END IF;

    IF v_driver_id = v_passenger_id THEN
        RETURN json_build_object('success', false, 'message', 'No puedes reservar tu propio viaje');
    END IF;

    -- 4. Asegurar que la Wallet existe y tiene saldo
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;

    IF v_wallet_balance IS NULL THEN
        -- Inicializar wallet si no existe (fall-safe)
        INSERT INTO public.wallets (user_id, balance, held_balance)
        VALUES (v_passenger_id, 0, 0)
        RETURNING balance INTO v_wallet_balance;
    END IF;

    IF v_wallet_balance < v_ride_price THEN
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente. Recarga tu cuenta para continuar.');
    END IF;

    -- 5. Preparar Reserva
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    SELECT full_name, photo_url INTO v_passenger_name, v_passenger_photo
    FROM public.profiles WHERE id = v_passenger_id;

    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Usuario Elite'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW(),
        'pickup_address', p_pickup_address
    )::JSONB;

    -- 6. EJECUCIÓN ATÓMICA

    -- Retener dinero (Escrow)
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;

    -- Actualizar plazas y lista de pasajeros
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;

    -- Marcar solicitud como cumplida
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    -- Historial
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -v_ride_price, 'booking', 'Reserva ShareWay: Saldo en garantía', p_ride_id);

    RETURN json_build_object(
        'success', true,
        'pin', v_ride_pin,
        'message', 'Reserva confirmada con éxito'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error crítico: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
