-- ========================================================
-- FIX CRÍTICO: Race Conditions en confirm_trip_and_pay
-- Prevenir que múltiples pasajeros reserven la misma plaza
-- ========================================================

DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid);

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
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
    v_ride_status TEXT;
    v_request_exists BOOLEAN;
BEGIN
    -- Validación inicial
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Bloqueo atómico del ride para prevenir race conditions
    SELECT 
        price,
        seats_available,
        driver_id,
        participant_ids,
        is_women_only,
        approval_mode,
        status
    INTO 
        v_ride_price,
        v_seats_available,
        v_driver_id,
        v_participant_ids,
        v_is_women_only,
        v_approval_mode,
        v_ride_status
    FROM public.rides
    WHERE id = p_ride_id
        AND status = 'scheduled'
    FOR UPDATE; -- Bloqueo exclusivo

    -- Validaciones del ride
    IF v_ride_price IS NULL THEN
        RAISE EXCEPTION 'Viaje no disponible';
    END IF;

    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'Sin asientos disponibles';
    END IF;

    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes reservar tu propio viaje';
    END IF;

    -- Validación de género si aplica
    IF v_is_women_only THEN
        SELECT gender INTO v_passenger_gender
        FROM public.profiles
        WHERE id = v_passenger_id;
        
        IF v_passenger_gender IS NULL OR LOWER(v_passenger_gender) != 'female' THEN
            RAISE EXCEPTION 'Este viaje es exclusivo para mujeres';
        END IF;
    END IF;

    -- Verificar si el pasajero ya está en el ride
    IF v_passenger_id = ANY(v_participant_ids) THEN
        RAISE EXCEPTION 'Ya tienes una reserva en este viaje';
    END IF;

    -- Si hay request_id, verificar que existe y está pendiente
    IF p_request_id IS NOT NULL THEN
        SELECT EXISTS(
            SELECT 1 FROM public.ride_requests 
            WHERE id = p_request_id 
                AND requester_id = v_passenger_id 
                AND status IN ('accepted', 'fulfilled')
        ) INTO v_request_exists;
        
        IF NOT v_request_exists THEN
            RAISE EXCEPTION 'Solicitud no válida o expirada';
        END IF;
    END IF;

    -- Obtener datos del pasajero
    SELECT display_name, photo_url INTO v_passenger_name, v_passenger_photo
    FROM public.profiles
    WHERE id = v_passenger_id;

    -- Verificar saldo con bloqueo
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id
    FOR UPDATE;

    IF v_wallet_balance < v_ride_price THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    -- Generar PIN
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Crear objeto pasajero
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    )::JSONB;

    -- Actualizar wallet (hold)
    UPDATE public.wallets
    SET 
        balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- Registrar transacción de hold
    INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
    SELECT 
        id, 
        user_id, 
        'hold', 
        -v_ride_price, 
        balance, 
        'Reserva de viaje (Hold)', 
        p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;

    -- Actualizar ride con nueva atomicidad
    UPDATE public.rides
    SET 
        passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1,
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Actualizar request si aplica
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests
        SET 
            status = 'confirmed',
            updated_at = NOW()
        WHERE id = p_request_id;
    END IF;

    -- Retornar éxito con PIN
    RETURN json_build_object(
        'success', true, 
        'pin', v_ride_pin,
        'message', 'Reserva confirmada exitosamente'
    );

EXCEPTION
    WHEN OTHERS THEN
        -- Log del error para auditoría
        INSERT INTO public.rpc_error_logs (
            function_name,
            error_message,
            error_detail,
            user_id,
            params
        )
        VALUES (
            'confirm_trip_and_pay',
            SQLERRM,
            SQLSTATE,
            v_passenger_id,
            json_build_object(
                'ride_id', p_ride_id,
                'request_id', p_request_id
            )
        );
        
        RAISE EXCEPTION 'Error al confirmar reserva: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario para auditoría
COMMENT ON FUNCTION public.confirm_trip_and_pay IS 'V3 hardened con bloqueo atómico FOR UPDATE para prevenir race conditions en reservas simultáneas';
