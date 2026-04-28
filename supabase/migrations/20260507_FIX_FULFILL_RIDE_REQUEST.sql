-- ELIMINAR SI EXISTE PARA EVITAR CONFLICTOS DE FIRMA
DROP FUNCTION IF EXISTS public.fulfill_ride_request(uuid,jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb);

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
    v_wallet_balance DECIMAL;
    v_passenger_obj JSONB;
BEGIN
    -- 1. Verificación de Seguridad
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Sesión no válida';
    END IF;

    -- 2. Obtener datos de la solicitud
    SELECT requester_id INTO v_passenger_id
    FROM public.ride_requests
    WHERE id = p_request_id AND status = 'pending';

    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'La solicitud ya no está disponible o ya fue aceptada.';
    END IF;

    -- 3. Verificar saldo del pasajero (Integridad Financiera Elite)
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id FOR UPDATE;

    IF v_wallet_balance < p_price THEN
        RAISE EXCEPTION 'El pasajero no tiene saldo suficiente para este viaje.';
    END IF;

    -- 4. Crear el viaje (usando la lógica unificada)
    SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        NULL, -- community_id (opcional)
        FALSE, -- is_recurring
        FALSE, -- is_exclusive
        '{}'::jsonb, -- recurrence_data
        'automatic', -- match_type
        p_waypoints,
        '{}'::jsonb -- metadata
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN
        RETURN v_ride_res;
    END IF;

    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- 5. Procesar Pago y Bloqueo de Fondos (Garantía ShareWay)
    UPDATE public.wallets
    SET balance = balance - p_price,
        held_balance = held_balance + p_price
    WHERE user_id = v_passenger_id;

    -- Registrar Transacción de Retención
    INSERT INTO public.transactions (
        wallet_id, user_id, type, amount, balance_after, description, related_ride_id
    )
    SELECT id, user_id, 'hold', -p_price, balance, 'Reserva automática por Aceptación de Solicitud', v_ride_id
    FROM public.wallets WHERE user_id = v_passenger_id;

    -- 6. Actualizar Estado de la Solicitud y crear el Booking
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        updated_at = NOW()
    WHERE id = p_request_id;

    -- Añadir al pasajero directamente al viaje
    v_passenger_obj := jsonb_build_object(
        'user_id', v_passenger_id,
        'seats', 1,
        'status', 'confirmed',
        'joined_at', NOW(),
        'payment_status', 'held'
    );

    UPDATE public.rides
    SET passengers = passengers || v_passenger_obj
    WHERE id = v_ride_id;

    -- 7. Log de Auditoría Forense
    PERFORM public.log_platform_audit(
        'Mantenimiento',
        'MATCH_FULFILLED',
        v_driver_id,
        jsonb_build_object(
            'request_id', p_request_id,
            'ride_id', v_ride_id,
            'passenger_id', v_passenger_id,
            'price', p_price
        )
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Viaje creado y pasajero vinculado con éxito',
        'rideId', v_ride_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO service_role;
