-- 1. LIMPIEZA TOTAL PARA EVITAR CONFLICTOS DE FIRMA
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,boolean,boolean,text[],text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb);

-- 2. CREACIÓN DE LA FUNCIÓN ELITE UNIFICADA
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT NULL,
    p_overview_polyline TEXT DEFAULT NULL,
    p_bounds JSONB DEFAULT NULL,
    p_is_women_only BOOLEAN DEFAULT FALSE,
    p_is_exclusive_community BOOLEAN DEFAULT FALSE,
    p_allowed_communities TEXT[] DEFAULT '{}',
    p_approval_mode TEXT DEFAULT 'automatic',
    p_waypoints JSONB DEFAULT '[]'::jsonb,
    p_preferences JSONB DEFAULT '{}'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
    v_profile RECORD;
BEGIN
    -- Seguridad
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- Obtener datos del conductor para desnormalización (Performance Elite)
    SELECT display_name, photo_url, gender INTO v_profile FROM public.profiles WHERE id = v_driver_id;

    -- Validación de Seguridad: Solo mujeres para viajes de mujeres
    IF p_is_women_only AND (v_profile.gender IS NULL OR LOWER(v_profile.gender) != 'female') THEN
        RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
    END IF;

    -- Insertar Viaje
    INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        waypoints,
        is_women_only,
        is_exclusive,
        allowed_communities,
        status,
        participant_ids
    ) VALUES (
        v_driver_id,
        v_profile.display_name,
        v_profile.photo_url,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_seats, -- Inicialmente todas disponibles
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_waypoints,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        'scheduled',
        ARRAY[v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Viaje creado con éxito',
        'rideId', v_ride_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. ACTUALIZAR FULFILL_RIDE_REQUEST PARA COINCIDIR EXACTAMENTE
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
    v_passenger_obj JSONB;
BEGIN
    SELECT requester_id INTO v_passenger_id FROM public.ride_requests WHERE id = p_request_id AND status = 'pending';
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'Solicitud no disponible.'; END IF;

    -- LLAMADA CORREGIDA A CREATE_RIDE (15 parámetros con tipos exactos)
    SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        NULL::jsonb,         -- p_bounds
        FALSE,               -- p_is_women_only
        FALSE,               -- p_is_exclusive_community
        '{}'::text[],        -- p_allowed_communities (CORREGIDO A TEXT[])
        'automatic'::text,   -- p_approval_mode
        p_waypoints,
        '{}'::jsonb          -- p_preferences
    ) INTO v_ride_res;

    IF NOT (v_ride_res->>'success')::BOOLEAN THEN RETURN v_ride_res; END IF;
    v_ride_id := (v_ride_res->>'rideId')::UUID;

    -- Cobro y actualización
    UPDATE public.wallets SET balance = balance - p_price, held_balance = held_balance + p_price WHERE user_id = v_passenger_id;
    UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;

    v_passenger_obj := jsonb_build_object('user_id', v_passenger_id, 'seats', 1, 'status', 'confirmed', 'joined_at', NOW());
    UPDATE public.rides SET passengers = COALESCE(passengers, '[]'::jsonb) || v_passenger_obj, seats_available = seats_available - 1 WHERE id = v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
