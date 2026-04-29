-- ============================================================
-- 🛡️ SHAREWAY ELITE: AUDITORÍA FINANCIERA TOTAL (HISTORIAL 100%)
-- Asegura que CUALQUIER movimiento deje rastro en transactions
-- ============================================================

-- 1. LIMPIEZA DE FUNCIONES
DO $$
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('confirm_trip_and_pay', 'fulfill_ride_request', 'complete_ride', 'cancel_ride_unified', 'handle_passenger_no_show', 'add_funds')
          AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 2. FUNCIÓN: RESERVA (confirm_trip_and_pay)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,
    p_num_seats INTEGER DEFAULT 1,
    p_dropoff_address TEXT DEFAULT NULL,
    p_dropoff_location JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_ride RECORD;
    v_total_cost NUMERIC;
    v_pin TEXT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;
    IF v_ride.id IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;

    v_total_cost := COALESCE(p_price, v_ride.price) * p_num_seats;
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Dinero
    UPDATE public.wallets SET balance = balance - v_total_cost, held_balance = held_balance + v_total_cost WHERE user_id = v_me;

    -- HISTORIAL (Pasajero)
    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
    VALUES (v_me, -v_total_cost, 'hold', p_ride_id, 'Reserva: ' || COALESCE(v_ride.origin_address, 'Origen') || ' -> ' || COALESCE(v_ride.destination_address, 'Destino'));

    UPDATE public.rides SET
        seats_available = seats_available - p_num_seats,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me, 'status', 'confirmed', 'pin', v_pin, 'booked_price', COALESCE(p_price, v_ride.price),
            'seats_booked', p_num_seats, 'pickup_address', p_pickup_address, 'pickup_location', p_pickup_location,
            'dropoff_address', p_dropoff_address, 'dropoff_location', p_dropoff_location
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FUNCIÓN: LIQUIDACIÓN (complete_ride)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_p JSONB;
    v_p_id UUID;
    v_p_price NUMERIC;
    v_total_payout NUMERIC := 0;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;
    IF v_ride.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No autorizado'); END IF;

    FOR v_p IN SELECT * FROM jsonb_array_elements(v_ride.passengers) LOOP
        v_p_id := (v_p->>'id')::UUID;
        v_p_price := COALESCE((v_p->>'booked_price')::NUMERIC, 0) * COALESCE((v_p->>'seats_booked')::INT, 1);

        IF v_p->>'status' IN ('confirmed', 'verified') THEN
            UPDATE public.wallets SET held_balance = GREATEST(0, held_balance - v_p_price) WHERE user_id = v_p_id;

            -- HISTORIAL (Pasajero: Viaje cerrado)
            INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
            VALUES (v_p_id, 0, 'payment_finalized', p_ride_id, 'Viaje completado: ' || v_ride.destination_address);

            v_total_payout := v_total_payout + (v_p_price * 0.90);
        END IF;
    END LOOP;

    IF v_total_payout > 0 THEN
        UPDATE public.wallets SET balance = balance + v_total_payout WHERE user_id = v_driver_id;
        -- HISTORIAL (Conductor: Cobro)
        INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
        VALUES (v_driver_id, v_total_payout, 'payout', p_ride_id, 'Cobro viaje: ' || v_ride.origin_address || ' -> ' || v_ride.destination_address);
    END IF;

    UPDATE public.rides SET status = 'completed', updated_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCIÓN: CANCELACIÓN (cancel_ride_unified)
CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'Cancelación')
RETURNS JSONB AS $$
DECLARE
    v_ride RECORD;
    v_p JSONB;
    v_p_id UUID;
    v_p_price NUMERIC;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride.id IS NULL THEN RETURN jsonb_build_object('success', false); END IF;

    FOR v_p IN SELECT * FROM jsonb_array_elements(v_ride.passengers) LOOP
        v_p_id := (v_p->>'id')::UUID;
        v_p_price := COALESCE((v_p->>'booked_price')::NUMERIC, 0) * COALESCE((v_p->>'seats_booked')::INT, 1);

        IF v_p->>'status' != 'cancelled' THEN
            UPDATE public.wallets SET balance = balance + v_p_price, held_balance = GREATEST(0, held_balance - v_p_price) WHERE user_id = v_p_id;

            -- HISTORIAL (Pasajero: Reembolso)
            INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
            VALUES (v_p_id, v_p_price, 'refund', p_ride_id, 'Reembolso por cancelación: ' || p_reason);
        END IF;
    END LOOP;

    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. FUNCIÓN: NO-SHOW (handle_passenger_no_show)
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(p_ride_id UUID, p_passenger_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_ride RECORD;
    v_p_price NUMERIC;
    v_penalty NUMERIC;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- Supongamos una penalización del 50% para el pasajero y 50% reembolso
    SELECT COALESCE((p->>'booked_price')::NUMERIC, 0) INTO v_p_price
    FROM jsonb_array_elements(v_ride.passengers) p WHERE (p->>'id')::UUID = p_passenger_id;

    v_penalty := v_p_price * 0.50;

    -- Pasajero pierde el 50%
    UPDATE public.wallets SET held_balance = held_balance - v_p_price, balance = balance + (v_p_price - v_penalty) WHERE user_id = p_passenger_id;

    -- HISTORIAL (Pasajero: Multa)
    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
    VALUES (p_passenger_id, -v_penalty, 'penalty', p_ride_id, 'Multa por no presentarse al viaje');

    -- Conductor cobra el 50% de ese asiento como compensación
    UPDATE public.wallets SET balance = balance + v_penalty WHERE user_id = v_ride.driver_id;

    -- HISTORIAL (Conductor: Compensación)
    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
    VALUES (v_ride.driver_id, v_penalty, 'payout', p_ride_id, 'Compensación: Pasajero no se presentó');

    RETURN json_build_object('success', true, 'penalty', v_penalty);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. FUNCIÓN: RECARGA (add_funds)
CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_method TEXT DEFAULT 'card')
RETURNS JSON AS $$
BEGIN
    UPDATE public.wallets SET balance = balance + p_amount, updated_at = NOW() WHERE user_id = auth.uid();
    -- HISTORIAL (Recarga)
    INSERT INTO public.transactions (user_id, amount, type, description)
    VALUES (auth.uid(), p_amount, 'deposit', 'Recarga de saldo vía ' || p_method);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. PERMISOS
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ride TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride_unified TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_passenger_no_show TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds TO authenticated;
