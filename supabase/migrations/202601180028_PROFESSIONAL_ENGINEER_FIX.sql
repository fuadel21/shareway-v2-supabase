
-- ==============================================================================
-- 20260118_PROFESSIONAL_ENGINEER_FIX.sql
-- LEAD ENGINEER SHIELD: UNIFICACIÓN TOTAL DE FLUJOS CRÍTICOS (PRO VERSION)
-- ==============================================================================

-- 1. LIMPIEZA RADICAL DE FUNCIONES SOBRECARGADAS (Evita errores de ambigüedad)
DO $$ 
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('confirm_trip_and_pay', 'cancel_ride', 'cancel_ride_by_driver', 'cancel_booking_and_refund', 'create_ride')
          AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION %I.%I(%s)', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 2. MASTER CREATOR: CREACIÓN DE VIAJES (STRICT UUID)
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
    v_vehicle JSONB;
BEGIN
    -- Validación de Seguridad Pro: Comprobar vehículo
    SELECT vehicle_info INTO v_vehicle FROM public.profiles WHERE id = v_driver_id;
    IF v_vehicle IS NULL OR v_vehicle = '{}'::JSONB THEN
        RAISE EXCEPTION 'DEBES_CONFIGURAR_VEHICULO';
    END IF;

    INSERT INTO public.rides (
        id, driver_id, origin, destination, departure_time, 
        seats_available, price, details, distance, 
        overview_polyline, waypoints, status, participant_ids
    ) VALUES (
        gen_random_uuid(), -- ID Imposible de hackear
        v_driver_id, p_origin, p_destination, p_departure_time,
        p_seats, p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_driver_id]
    ) RETURNING id INTO v_ride_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. MASTER BOOKING: RESERVA Y PAGO (ANTI-DUPLICADOS)
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
    -- Bloqueo de fila para evitar Race Conditions
    SELECT price, seats_available, driver_id INTO v_ride_price, v_seats, v_driver_id
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_seats <= 0 THEN RAISE EXCEPTION 'SIN_PLAZAS'; END IF;
    
    -- Verificar si ya reservó (Evita el doble cobro)
    IF EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND v_passenger_id = ANY(participant_ids)) THEN
        RAISE EXCEPTION 'ALREADY_BOOKED';
    END IF;

    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Transacción Financiera
    UPDATE public.wallets SET balance = balance - v_ride_price, held_balance = held_balance + v_ride_price WHERE user_id = v_passenger_id;
    
    UPDATE public.rides SET 
        seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_passenger_id),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_passenger_id, 'status', 'confirmed', 'pin', v_pin, 'booked_price', v_ride_price, 'pickup_address', p_pickup_address
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. MASTER CANCEL: CONDUCTOR (Reembolsos Automáticos)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger JSONB;
BEGIN
    -- Solo el dueño puede cancelar
    IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND driver_id = auth.uid()) THEN
        RAISE EXCEPTION 'NO_AUTORIZADO';
    END IF;

    -- Procesar reembolsos de todos los pasajeros
    FOR v_passenger IN SELECT jsonb_array_elements(passengers) FROM public.rides WHERE id = p_ride_id
    LOOP
        IF v_passenger->>'status' = 'confirmed' THEN
            UPDATE public.wallets 
            SET held_balance = held_balance - (v_passenger->>'booked_price')::DECIMAL,
                balance = balance + (v_passenger->>'booked_price')::DECIMAL
            WHERE user_id = (v_passenger->>'id')::UUID;
        END IF;
    END LOOP;

    UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ALIAS Y COMPATIBILIDAD
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID) RETURNS JSON AS $$
BEGIN RETURN public.cancel_ride(p_ride_id); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
