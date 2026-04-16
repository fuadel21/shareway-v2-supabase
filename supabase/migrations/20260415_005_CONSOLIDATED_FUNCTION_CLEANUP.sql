
-- 20260415_005_CONSOLIDATED_FUNCTION_CLEANUP.sql
-- Propósito: Eliminar ambigüedades en las funciones (Overloading) y añadir validación de duplicaods.

-- 1. Limpieza de confirm_trip_and_pay
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure as proto
        FROM pg_proc
        WHERE proname = 'confirm_trip_and_pay'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proto || ' CASCADE';
    END LOOP;
END $$;

-- 2. Limpieza de complete_ride
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure as proto
        FROM pg_proc
        WHERE proname = 'complete_ride'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proto || ' CASCADE';
    END LOOP;
END $$;

-- 3. Única versión oficial de confirm_trip_and_pay
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_pickup_lat NUMERIC DEFAULT NULL,
    p_pickup_lng NUMERIC DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_price NUMERIC;
    v_seats INTEGER;
    v_is_women_only BOOLEAN;
    v_user_gender TEXT;
    v_driver_id UUID;
    v_pin TEXT;
    v_passengers JSONB;
BEGIN
    PERFORM public.ensure_wallet_exists(v_user_id);

    -- Bloqueo pesimista
    SELECT price, seats_available, is_women_only, driver_id, passengers
    INTO v_price, v_seats, v_is_women_only, v_driver_id, v_passengers
    FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- Validaciones Básicas
    IF v_price IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado'); END IF;
    IF v_seats <= 0 THEN RETURN jsonb_build_object('success', false, 'message', 'No hay plazas disponibles'); END IF;
    IF v_driver_id = v_user_id THEN RETURN jsonb_build_object('success', false, 'message', 'No puedes reservar tu propio viaje'); END IF;

    -- Validación de Duplicados (NUEVO)
    IF v_passengers IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_passengers) p 
        WHERE (p->>'id')::UUID = v_user_id AND p->>'status' != 'cancelled'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ya tienes una reserva activa en este viaje');
    END IF;

    -- Género
    SELECT gender INTO v_user_gender FROM public.profiles WHERE id = v_user_id;
    IF v_is_women_only AND (v_user_gender IS NULL OR v_user_gender = 'male') THEN 
        RETURN jsonb_build_object('success', false, 'message', 'Viaje restringido a mujeres'); 
    END IF;

    -- Saldo
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_user_id AND balance >= v_price) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Saldo insuficiente');
    END IF;

    -- Ejecutar Pago (Escrow)
    UPDATE public.wallets 
    SET balance = balance - v_price, 
        held_balance = COALESCE(held_balance, 0) + v_price,
        updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Log Transacción
    INSERT INTO public.transactions (user_id, wallet_id, type, amount, balance_after, description, related_ride_id)
    SELECT user_id, user_id, 'hold', -v_price, balance, 'Reserva (Bloqueo)', p_ride_id
    FROM public.wallets WHERE user_id = v_user_id;

    -- Actualizar Viaje
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    UPDATE public.rides SET 
        seats_available = seats_available - 1,
        passengers = COALESCE(passengers, '[]'::jsonb) || jsonb_build_object(
            'id', v_user_id, 'status', 'confirmed', 'pin', v_pin, 'booked_price', v_price, 'booked_at', NOW()
        ),
        participant_ids = array_append(COALESCE(participant_ids, '{}'), v_user_id)
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Reserva completada', 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Única versión oficial de complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10;
    v_total_driver_payout DECIMAL := 0;
    v_driver_id UUID;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride_record.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'No encontrado'); END IF;
    IF v_ride_record.status = 'completed' THEN RETURN json_build_object('success', true, 'payout', 0); END IF;

    v_driver_id := v_ride_record.driver_id;
    PERFORM public.ensure_wallet_exists(v_driver_id);

    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF v_passenger->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin', 'completed') THEN
            v_passenger_id := (v_passenger->>'id')::UUID;
            v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
            v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);

            UPDATE public.wallets
            SET held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_booked_price),
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            UPDATE public.wallets
            SET balance = COALESCE(balance, 0) + v_payout_amount,
                updated_at = NOW()
            WHERE user_id = v_driver_id;

            INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id, balance_after)
            SELECT user_id, user_id, -v_booked_price, 'payment_complete', 'Viaje finalizado', p_ride_id, balance 
            FROM public.wallets WHERE user_id = v_passenger_id;

            INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id, balance_after)
            SELECT user_id, user_id, v_payout_amount, 'payout', 'Ingreso por viaje', p_ride_id, balance 
            FROM public.wallets WHERE user_id = v_driver_id;

            v_total_driver_payout := v_total_driver_payout + v_payout_amount;
        END IF;
    END LOOP;

    UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;
    RETURN json_build_object('success', true, 'payout', v_total_driver_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
