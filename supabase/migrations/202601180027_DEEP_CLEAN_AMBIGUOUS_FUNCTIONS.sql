
-- ==============================================================================
-- 20260118_DEEP_CLEAN_AMBIGUOUS_FUNCTIONS.sql
-- Propósito: Consolidar todas las funciones críticas de Viajes (Reserva y Cancelación)
--            Resolviendo errores de ambigüedad, tipos UUID y "Function not found".
-- ==============================================================================

-- 1. LIMPIEZA RADICAL DE FUNCIONES DUPLICADAS O AMBIGUAS
DO $$ 
DECLARE
    _sql text;
BEGIN
    SELECT INTO _sql
        string_agg(format('DROP FUNCTION %s(%s);', n.nspname || '.' || p.proname, oidvectortypes(p.proargtypes)), E'\n')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('confirm_trip_and_pay', 'cancel_ride', 'cancel_booking_and_refund', 'cancel_ride_by_driver')
      AND n.nspname = 'public';

    IF _sql IS NOT NULL THEN
        EXECUTE _sql;
    END IF;
END $$;

-- 2. FUNCIÓN: RESERVAR Y PAGAR (confirm_trip_and_pay)
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
    v_already_booked BOOLEAN;
BEGIN 
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    SELECT price, seats_available, driver_id, (v_passenger_id = ANY(participant_ids))
    INTO v_ride_price, v_seats_available, v_driver_id, v_already_booked
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'El viaje no está disponible para reserva'; END IF;
    IF v_already_booked THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
    IF v_seats_available <= 0 THEN RAISE EXCEPTION 'SIN_PLAZAS_LIBRES'; END IF;

    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id;
    IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'SALDO_INSUFICIENTE'; END IF;

    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    SELECT full_name, photo_url INTO v_passenger_name, v_passenger_photo FROM public.profiles WHERE id = v_passenger_id;

    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Usuario'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW(),
        'pickup_address', p_pickup_address,
        'pickup_location', p_pickup_location
    )::JSONB;

    UPDATE public.wallets SET balance = balance - v_ride_price, held_balance = held_balance + v_ride_price WHERE user_id = v_passenger_id;
    UPDATE public.rides SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger, participant_ids = array_append(participant_ids, v_passenger_id), seats_available = seats_available - 1 WHERE id = p_ride_id;

    PERFORM public.create_notification(v_driver_id::UUID, 'ride_accepted'::TEXT, '¡Nueva plaza reservada!'::TEXT, (COALESCE(v_passenger_name, 'Un pasajero') || ' ha reservado una plaza.')::TEXT, json_build_object('ride_id', p_ride_id)::JSONB);
    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FUNCIÓN: CANCELAR VIAJE (cancel_ride - PARA EL CONDUCTOR)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'No autorizado'; END IF;

    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF v_passenger->>'status' = 'confirmed' THEN
            UPDATE public.wallets SET held_balance = held_balance - (v_passenger->>'booked_price')::DECIMAL, balance = balance + (v_passenger->>'booked_price')::DECIMAL WHERE user_id = (v_passenger->>'id')::UUID;
            PERFORM public.create_notification((v_passenger->>'id')::UUID, 'ride_cancelled'::TEXT, 'Viaje cancelado'::TEXT, 'El conductor ha cancelado el viaje. Dinero devuelto.'::TEXT, json_build_object('ride_id', p_ride_id)::JSONB);
        END IF;
    END LOOP;

    UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCIÓN: CANCELAR RESERVA (cancel_booking_and_refund - PARA EL PASAJERO)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    SELECT p INTO v_passenger_entry FROM jsonb_array_elements(v_ride_record.passengers) AS p WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' != 'cancelled';
    
    IF v_passenger_entry IS NULL THEN RAISE EXCEPTION 'Reserva no encontrada'; END IF;
    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;

    UPDATE public.wallets SET held_balance = held_balance - v_booked_price, balance = balance + v_booked_price WHERE user_id = v_passenger_id;
    UPDATE public.rides SET seats_available = seats_available + 1, participant_ids = array_remove(participant_ids, v_passenger_id), passengers = (SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = v_passenger_id THEN p || jsonb_build_object('status', 'cancelled') ELSE p END) FROM jsonb_array_elements(v_ride_record.passengers) p) WHERE id = p_ride_id;

    PERFORM public.create_notification(v_ride_record.driver_id::UUID, 'ride_cancelled'::TEXT, 'Plaza liberada'::TEXT, 'Un pasajero ha cancelado su reserva.'::TEXT, json_build_object('ride_id', p_ride_id)::JSONB);
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ALIAS DE COMPATIBILIDAD
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID) RETURNS JSON AS $$
BEGIN RETURN public.cancel_ride(p_ride_id); END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
