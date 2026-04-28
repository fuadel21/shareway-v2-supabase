-- 1. LIMPIEZA DE FIRMAS PARA EVITAR DUPLICADOS
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,boolean,boolean,text[],text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb);

-- 2. FUNCIÓN CREATE_RIDE (Ajustada a tu esquema real)
CREATE OR REPLACE FUNCTION public.create_ride(
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
    v_ride_id UUID;
BEGIN
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    INSERT INTO public.rides (
        driver_id,
        origin,
        destination,
        departure_time,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        waypoints,
        status,
        participant_ids
    ) VALUES (
        v_driver_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_waypoints,
        'scheduled',
        ARRAY[v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FUNCIÓN FULFILL_RIDE_REQUEST (Sincronizada con el esquema real)
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
BEGIN
    -- Verificar solicitud
    SELECT requester_id INTO v_passenger_id
    FROM public.ride_requests
    WHERE id = p_request_id AND status = 'pending';

    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'La solicitud ya no está disponible.';
    END IF;

    -- Llamar a la creación del viaje (9 parámetros según tu esquema)
    SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_waypoints
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN
        RETURN v_ride_res;
    END IF;

    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- Lógica Financiera: Cobrar al pasajero y retener saldo
    UPDATE public.wallets
    SET balance = balance - p_price,
        held_balance = held_balance + p_price
    WHERE user_id = v_passenger_id;

    -- Registrar en el viaje
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

    -- Marcar solicitud como cumplida
    UPDATE public.ride_requests
    SET status = 'fulfilled'
    WHERE id = p_request_id;

    RETURN json_build_object(
        'success', true,
        'rideId', v_ride_id,
        'message', 'Match realizado con éxito'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permisos
GRANT EXECUTE ON FUNCTION public.create_ride TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO authenticated;
