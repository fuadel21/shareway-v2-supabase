-- ============================================================
-- 🛡️ SHAREWAY.ES · SECURITY FIXES V1
-- Arregla los 2 agujeros criticos de dinero + hardening de RPCs
-- Ejecutar en Supabase SQL Editor (proyecto de shareway.es)
-- ============================================================

-- ============================================================
-- FIX 1 (CRITICO): add_funds ya no es llamable por el cliente.
-- Dinero gratis: cualquier usuario autenticado podia llamar
-- add_funds(99999,'card') y crear saldo infinito.
-- Ahora: SOLO la Edge Function (service_role) puede recargar,
-- y solo tras verificar el pago real en Stripe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_method TEXT DEFAULT 'card')
RETURNS JSON AS $$
BEGIN
    -- Solo el service_role (Edge Functions) puede recargar saldo.
    -- auth.uid() es NULL cuando la llamada viene con la clave de servicio;
    -- los usuarios finales (anon/authenticated) SIEMPRE tienen auth.uid().
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'RECARGA_NO_PERMITIDA: usa el flujo de pago';
    END IF;

    RAISE EXCEPTION 'RECARGA_NO_PERMITIDA: add_funds requiere verificacion de pago via Edge Function';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Nueva version segura: solo el backend, con el user_id explicito,
-- tras verificar el PaymentIntent en Stripe.
CREATE OR REPLACE FUNCTION public.add_funds_verified(
    p_user_id UUID,
    p_amount NUMERIC,
    p_payment_intent_id TEXT
) RETURNS JSON AS $$
BEGIN
    -- Doble verificacion: sin usuario de sesion (service_role only)
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'NO_AUTORIZADO';
    END IF;
    -- Importe valido
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN
        RAISE EXCEPTION 'IMPORTE_INVALIDO';
    END IF;
    -- PaymentIntent obligatorio y no reutilizable
    IF p_payment_intent_id IS NULL OR p_payment_intent_id = '' THEN
        RAISE EXCEPTION 'PAGO_NO_VERIFICABLE';
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE description LIKE '%' || p_payment_intent_id || '%') THEN
        RAISE EXCEPTION 'PAGO_YA_PROCESADO';
    END IF;

    UPDATE public.wallets SET balance = balance + p_amount, updated_at = NOW() WHERE user_id = p_user_id;
    INSERT INTO public.transactions (user_id, amount, type, description)
    VALUES (p_user_id, p_amount, 'deposit', 'Recarga verificada Stripe: ' || p_payment_intent_id);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Permisos: add_funds_verified SOLO para service_role (no authenticated)
REVOKE EXECUTE ON FUNCTION public.add_funds(NUMERIC, TEXT) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.add_funds_verified(UUID, NUMERIC, TEXT) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.add_funds_verified(UUID, NUMERIC, TEXT) TO service_role;

-- ============================================================
-- FIX 2 (CRITICO): confirm_trip_and_pay ignora el precio del
-- cliente. Reservar por 0.01€ cuando el viaje cuesta 25€ era
-- posible pasando p_price. Ahora SIEMPRE cobra el precio real
-- del viaje guardado en la base de datos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,          -- ignorado: se mantiene por compatibilidad
    p_num_seats INTEGER DEFAULT 1,
    p_dropoff_address TEXT DEFAULT NULL,
    p_dropoff_location JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_ride RECORD;
    v_total_cost NUMERIC;
    v_pin TEXT;
    v_wallet RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;
    IF v_rIDE.id IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_ride.driver_id = v_me THEN RAISE EXCEPTION 'CONDUCTOR_NO_PUEDE_RESERVAR'; END IF;
    IF p_num_seats IS NULL OR p_num_seats < 1 OR p_num_seats > 8 THEN RAISE EXCEPTION 'PLAZAS_INVALIDAS'; END IF;
    IF v_ride.seats_available < p_num_seats THEN RAISE EXCEPTION 'SIN_PLAZAS'; END IF;

    -- PRECIO: SIEMPRE el de la base de datos. Nunca el del cliente.
    v_total_cost := v_ride.price * p_num_seats;

    -- Saldo suficiente
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_me FOR UPDATE;
    IF v_wallet.balance IS NULL OR v_wallet.balance < v_total_cost THEN
        RAISE EXCEPTION 'SALDO_INSUFICIENTE';
    END IF;

    -- No duplicar reserva del mismo usuario en el mismo viaje
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_ride.passengers,'[]'::JSONB)) p WHERE (p->>'id')::UUID = v_me AND (p->>'status') = 'confirmed') THEN
        RAISE EXCEPTION 'YA_RESERVADO';
    END IF;

    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    UPDATE public.wallets SET balance = balance - v_total_cost, held_balance = held_balance + v_total_cost
    WHERE user_id = v_me;

    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
    VALUES (v_me, -v_total_cost, 'hold', p_ride_id,
        'Reserva: ' || COALESCE(v_ride.origin_address, v_ride.origin) || ' -> ' || COALESCE(v_ride.destination_address, v_ride.destination));

    UPDATE public.rides SET
        seats_available = seats_available - p_num_seats,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me, 'status', 'confirmed', 'pin', v_pin,
            'booked_price', v_ride.price,
            'seats_booked', p_num_seats,
            'pickup_address', p_pickup_address, 'pickup_location', p_pickup_location,
            'dropoff_address', p_dropoff_address, 'dropoff_location', p_dropoff_location
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin, 'total_cost', v_total_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay(UUID, UUID, TEXT, JSONB, DECIMAL, INTEGER, TEXT, JSONB) TO authenticated;

-- ============================================================
-- FIX 3: create_ride valida precio y plazas del conductor
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin TEXT, p_destination TEXT, p_departure_time TIMESTAMPTZ,
    p_seats INTEGER, p_price DECIMAL, p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT NULL, p_overview_polyline TEXT DEFAULT NULL,
    p_waypoints JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_me UUID := auth.uid(); v_ride_id UUID;
BEGIN
    IF p_price IS NULL OR p_price <= 0 OR p_price > 1000 THEN RAISE EXCEPTION 'PRECIO_INVALIDO'; END IF;
    IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8 THEN RAISE EXCEPTION 'PLAZAS_INVALIDAS'; END IF;
    IF p_departure_time < NOW() - INTERVAL '2 hours' THEN RAISE EXCEPTION 'FECHA_INVALIDA'; END IF;

    INSERT INTO public.rides (driver_id, origin, destination, departure_time, seats, seats_available, price, details, distance, overview_polyline, waypoints, status, participant_ids)
    VALUES (v_me, p_origin, p_destination, p_departure_time, p_seats, p_seats, p_price, p_details, p_distance, p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_me])
    RETURNING id INTO v_ride_id;

    RETURN v_ride_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_ride(TEXT, TEXT, TIMESTAMPTZ, INTEGER, DECIMAL, TEXT, DECIMAL, TEXT, JSONB) TO authenticated;

-- ============================================================
-- FIX 4: search_path en todos los SECURITY DEFINER criticos
-- (evita secuestro de funciones via schema search path)
-- ============================================================

ALTER FUNCTION public.get_ride_details_secure(UUID) SET search_path = public;
ALTER FUNCTION public.complete_ride(UUID) SET search_path = public;
ALTER FUNCTION public.cancel_ride_unified(UUID) SET search_path = public;
ALTER FUNCTION public.handle_passenger_no_show(UUID) SET search_path = public;
ALTER FUNCTION public.fulfill_ride_request(UUID) SET search_path = public;

-- ============================================================
-- VERIFICACION
-- ============================================================
-- Despues de ejecutar, verifica:
-- 1. SELECT public.add_funds(100, 'card'); como usuario -> debe dar error RECARGA_NO_PERMITIDA
-- 2. Reservar un viaje con p_price=0.01 -> debe cobrar el precio real
-- 3. SELECT proname, prosecconfig FROM pg_proc WHERE proname IN
--      ('add_funds','confirm_trip_and_pay','create_ride'); -> todos con search_path
