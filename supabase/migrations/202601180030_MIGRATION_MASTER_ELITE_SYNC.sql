
-- ==============================================================================
-- MIGRATION_MASTER_ELITE_SYNC.sql
-- SINCRONIZACIÓN TOTAL: BASE DE DATOS <-> FRONTEND ELITE
-- ==============================================================================

-- 1. LIMPIEZA RADICAL (Anti-Bucle)
DO $$ 
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('confirm_trip_and_pay', 'cancel_ride', 'cancel_ride_by_driver', 'cancel_booking_and_refund', 'create_ride', 'get_ride_details_secure', 'start_ride', 'complete_ride', 'verify_passenger_boarding')
          AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION %I.%I(%s)', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 2. MASTER CREATOR (Soporta JSONB de Google Maps)
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::JSONB
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
BEGIN
    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time, 
        seats_available, price, details, distance, 
        overview_polyline, waypoints, status, participant_ids
    ) VALUES (
        v_driver_id, p_origin, p_destination, p_departure_time,
        p_seats, p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. MASTER BOOKING (Escrow y PIN Secreto)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID := auth.uid();
    v_ride_price DECIMAL;
    v_seats INTEGER;
    v_driver_id UUID;
    v_pin TEXT;
BEGIN 
    SELECT price, seats_available, driver_id INTO v_ride_price, v_seats, v_driver_id
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_seats <= 0 THEN RAISE EXCEPTION 'SIN_PLAZAS'; END IF;
    
    -- Evitar duplicados
    IF EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND v_passenger_id = ANY(participant_ids)) THEN
        RAISE EXCEPTION 'ALREADY_BOOKED';
    END IF;

    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Cobro y actualización
    UPDATE public.wallets SET balance = balance - v_ride_price, held_balance = held_balance + v_ride_price WHERE user_id = v_passenger_id;
    
    UPDATE public.rides SET 
        seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_passenger_id),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_passenger_id, 'status', 'confirmed', 'pin', v_pin, 'booked_price', v_ride_price, 'pickup_address', p_pickup_address, 'pickup_location', p_pickup_location
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. MASTER DETAILS (Seguridad Pro: PIN oculto al conductor)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passengers_redacted JSONB;
BEGIN
    SELECT r.*, p.display_name as driver_name, p.photo_url as driver_photo, p.is_verified as driver_verified, p.rating as driver_rating, p.vehicle_info as driver_vehicle
    INTO v_ride_record FROM public.rides r JOIN public.profiles p ON r.driver_id = p.id WHERE r.id = p_ride_id;

    IF v_ride_record.id IS NULL THEN RETURN NULL; END IF;

    -- Solo el dueño del PIN lo ve
    SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = v_user_id THEN p ELSE p - 'pin' END)
    INTO v_passengers_redacted FROM jsonb_array_elements(COALESCE(v_ride_record.passengers, '[]'::JSONB)) p;

    RETURN json_build_object(
        'id', v_ride_record.id,
        'driver_id', v_ride_record.driver_id,
        'driver_name', v_ride_record.driver_name,
        'driver_photo', v_ride_record.driver_photo,
        'driver_verified', v_ride_record.driver_verified,
        'driver_rating', v_ride_record.driver_rating,
        'driver_vehicle', v_ride_record.driver_vehicle,
        'origin', v_ride_record.origin,
        'destination', v_ride_record.destination,
        'departure_time', v_ride_record.departure_time,
        'seats_available', v_ride_record.seats_available,
        'price', v_ride_record.price,
        'status', v_ride_record.status,
        'passengers', v_passengers_redacted,
        'user_pin', (SELECT p->>'pin' FROM jsonb_array_elements(v_ride_record.passengers) p WHERE (p->>'id')::UUID = v_user_id)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 5. MASTER START (Regla de los 15 min en el núcleo)
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    
    IF v_ride_record.driver_id != auth.uid() THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
    
    -- BLOQUEO FÍSICO: No se puede iniciar antes de 15 min de la salida
    IF v_ride_record.departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RAISE EXCEPTION 'DEMASIADO_PRONTO_PARA_INICIAR';
    END IF;

    UPDATE public.rides SET status = 'active', updated_at = NOW() WHERE id = p_ride_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. MASTER VERIFY (Verificación ciega entre conductor y pasajero)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(p_ride_id UUID, p_pin TEXT)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
BEGIN
    -- Busca al pasajero que tiene ese PIN en ese viaje
    SELECT (p->>'id')::UUID INTO v_passenger_id 
    FROM public.rides, jsonb_array_elements(passengers) p 
    WHERE id = p_ride_id AND p->>'pin' = p_pin;

    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'PIN_INCORRECTO'; END IF;

    -- Marca como verificado
    UPDATE public.rides SET passengers = (
        SELECT jsonb_agg(CASE WHEN (p->>'pin' = p_pin) THEN p || '{"status": "verified"}'::jsonb ELSE p END)
        FROM jsonb_array_elements(passengers) p
    ) WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'passengerId', v_passenger_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
