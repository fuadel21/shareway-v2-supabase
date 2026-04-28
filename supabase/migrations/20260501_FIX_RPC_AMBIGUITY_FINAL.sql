
-- ==============================================================================
-- 20260501_FIX_RPC_AMBIGUITY_FINAL.sql
-- Propósito: Eliminar ambigüedad en confirm_trip_and_pay y unificar firma.
-- ==============================================================================

-- 1. Eliminar TODAS las versiones existentes de confirm_trip_and_pay para evitar el error "best candidate"
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

-- 2. Crear la versión ÚNICA y OFICIAL (UUID)
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
BEGIN
    -- Seguridad
    IF v_passenger_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión expirada');
    END IF;

    -- Evitar Doble Reserva
    IF EXISTS (
        SELECT 1 FROM public.rides
        WHERE id = p_ride_id AND v_passenger_id = ANY(participant_ids)
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Ya tienes una reserva activa en este viaje');
    END IF;

    -- Obtener y Bloquear Datos
    SELECT price, seats_available, driver_id INTO v_ride_price, v_seats_available, v_driver_id
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_ride_price IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'El viaje ya no está disponible');
    END IF;

    IF v_seats_available <= 0 THEN
        RETURN json_build_object('success', false, 'message', 'Lo sentimos, ya no quedan asientos');
    END IF;

    IF v_driver_id = v_passenger_id THEN
        RETURN json_build_object('success', false, 'message', 'No puedes reservar tu propio viaje');
    END IF;

    -- Usar precio dinámico si se proporciona, si no el del viaje
    v_ride_price := COALESCE(p_price, v_ride_price);

    -- Wallet
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;

    IF v_wallet_balance IS NULL OR v_wallet_balance < v_ride_price THEN
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente (Necesitas ' || v_ride_price || '€)');
    END IF;

    -- PIN y Perfil
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

    -- EJECUCIÓN
    UPDATE public.wallets SET balance = balance - v_ride_price, held_balance = held_balance + v_ride_price WHERE user_id = v_passenger_id;

    UPDATE public.rides SET
        passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;

    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -v_ride_price, 'booking', 'Reserva ShareWay', p_ride_id);

    RETURN json_build_object('success', true, 'pin', v_ride_pin, 'message', 'Reserva confirmada');

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay TO service_role;
