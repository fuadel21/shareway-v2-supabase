-- ========================================================
-- MIGRATION: REQUEST FLOW HARDENING V3 – ATOMIC FULFILL
-- Objetivo: Eliminar overbooking, doble hold y estados inconsistentes
-- ========================================================

-- 1. Limpiar versiones previas de fulfill_ride_request
DROP FUNCTION IF EXISTS public.fulfill_ride_request(
    uuid,
    jsonb,
    jsonb,
    timestamptz,
    integer,
    decimal,
    text,
    decimal,
    text,
    jsonb
);

-- 2. Crear fulfill_ride_request robusta y atómica
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
    v_requester_id UUID;
    v_requester_name TEXT;
    v_requester_photo TEXT;
    v_ride_id UUID;
    v_ride_res JSON;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_passenger_obj JSONB;
    v_payment_expires_at TIMESTAMPTZ;
BEGIN
    -- -------------------------------------------------
    -- Bloqueo atómico de la solicitud para prevenir race conditions
    -- -------------------------------------------------
    SELECT requester_id INTO v_requester_id
    FROM public.ride_requests
    WHERE id = p_request_id
        AND status = 'pending'
    FOR UPDATE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION 'La solicitud ya no está disponible o fue aceptada por otro conductor.';
    END IF;

    -- -------------------------------------------------
    -- Validar que el conductor no es el pasajero
    -- -------------------------------------------------
    IF v_driver_id = v_requester_id THEN
        RAISE EXCEPTION 'No puedes aceptar tu propia solicitud.';
    END IF;

    -- -------------------------------------------------
    -- Validar saldo del pasajero ANTES de crear el ride
    -- -------------------------------------------------
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_requester_id
    FOR UPDATE;

    IF v_wallet_balance < p_price THEN
        RAISE EXCEPTION 'El pasajero no tiene saldo suficiente para este viaje.';
    END IF;

    -- -------------------------------------------------
    -- Obtener datos del pasajero para el ride
    -- -------------------------------------------------
    SELECT display_name, photo_url INTO v_requester_name, v_requester_photo
    FROM public.profiles
    WHERE id = v_requester_id;

    -- -------------------------------------------------
    -- Crear el ride (reutilizando create_ride hardened)
    -- -------------------------------------------------
    SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        NULL,
        FALSE,
        FALSE,
        '{}',
        'automatic',
        p_waypoints,
        '{}'
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN
        -- Si create_ride falla, no modificamos nada más
        RETURN v_ride_res;
    END IF;

    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- -------------------------------------------------
    -- Generar PIN y timestamp de expiración de pago (15 min)
    -- -------------------------------------------------
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_payment_expires_at := NOW() + INTERVAL '15 minutes';

    -- -------------------------------------------------
    - Crear objeto pasajero con estado 'confirmed' (lista para pagar)
    -- -------------------------------------------------
    v_passenger_obj := json_build_object(
        'id', v_requester_id,
        'displayName', v_requester_name,
        'photoURL', v_requester_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', NOW()
    )::JSONB;

    -- -------------------------------------------------
    -- Actualizar ride con pasajero y plazas
    -- -------------------------------------------------
    UPDATE public.rides
    SET
        passengers = jsonb_build_array(v_passenger_obj),
        participant_ids = array_append(participant_ids, v_requester_id),
        seats_available = seats_available - 1
    WHERE id = v_ride_id;

    -- -------------------------------------------------
    -- Deducciones de wallet (hold) de forma atómica
    -- -------------------------------------------------
    UPDATE public.wallets
    SET
        balance = balance - p_price,
        held_balance = held_balance + p_price
    WHERE user_id = v_requester_id;

    -- -------------------------------------------------
    -- Registrar transacción de hold
    -- -------------------------------------------------
    INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
    SELECT id, user_id, 'hold', -p_price, balance, 'Reserva automática por Match', v_ride_id
    FROM public.wallets
    WHERE user_id = v_requester_id;

    -- -------------------------------------------------
    -- Actualizar solicitud a fulfilled CON timestamps y matched_ride_id
    -- -------------------------------------------------
    UPDATE public.ride_requests
    SET
        status = 'fulfilled',
        matched_ride_id = v_ride_id,
        payment_expires_at = v_payment_expires_at,
        updated_at = NOW()
    WHERE id = p_request_id;

    -- -------------------------------------------------
    -- Respuesta exitosa con datos relevantes para el frontend
    -- -------------------------------------------------
    RETURN json_build_object(
        'success', true,
        'rideId', v_ride_id,
        'pin', v_ride_pin,
        'payment_expires_at', v_payment_expires_at
    );

EXCEPTION
    WHEN OTHERS THEN
        -- Log de errores para auditoría
        INSERT INTO public.rpc_error_logs (
            function_name,
            error_message,
            error_detail,
            user_id,
            params
        )
        VALUES (
            'fulfill_ride_request',
            SQLERRM,
            SQLSTATE,
            v_driver_id,
            json_build_object('request_id', p_request_id)
        );
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Asegurar que la tabla rpc_error_logs existe
CREATE TABLE IF NOT EXISTS public.rpc_error_logs (
    id BIGSERIAL PRIMARY KEY,
    function_name TEXT,
    error_message TEXT,
    error_detail TEXT,
    user_id UUID,
    params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Comentarios para auditoría
COMMENT ON FUNCTION public.fulfill_ride_request IS 'V3 robusta: bloquea la solicitud, valida saldo, crea ride, actualiza todo atómicamente. Previene overbooking y doble hold.';
