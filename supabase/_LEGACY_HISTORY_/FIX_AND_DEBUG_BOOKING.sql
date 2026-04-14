-- ==========================================
-- SCRIPT DE REPARACIÓN Y DIAGNÓSTICO DE PAGOS
-- ==========================================

-- 1. Eliminar versiones anteriores para evitar conflictos
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(UUID, UUID);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(UUID);

-- 2. Crear función limpia con logs de diagnóstico
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_ride_status TEXT;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID[];
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Obtener info del pasajero
    SELECT display_name, photo_url
    INTO v_passenger_name, v_passenger_photo
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- Bloquear y leer viaje
    SELECT price, seats_available, driver_id, participant_ids, status
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_ride_status
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE; -- Bloqueo crítico

    IF v_ride_price IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje no está programado (Estado: %)', v_ride_status; END IF;
    IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan plazas'; END IF;
    IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes auto-reservar'; END IF;
    IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya estás en el viaje'; END IF;

    -- Bloquear y leer wallet
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id
    FOR UPDATE;
    
    IF v_wallet_balance IS NULL THEN
        -- Auto-fix: Crear wallet si no existe y reintentar
        INSERT INTO public.wallets (user_id, balance) VALUES (v_passenger_id, 0.00);
        v_wallet_balance := 0.00;
    END IF;
    
    IF v_wallet_balance < v_ride_price THEN
        RAISE EXCEPTION 'Saldo insuficiente (Tienes: % €, Necesitas: % €)', v_wallet_balance, v_ride_price;
    END IF;
    
    -- Generar PIN y Objeto Pasajero
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_new_passenger := jsonb_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW()
    );
    
    -- 1. EJECUTAR COBRO
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -v_ride_price, balance, 'Pago retenido para viaje', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;

    -- 2. EJECUTAR RESERVA
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;
    
    -- Retornar éxito con datos debug
    RETURN json_build_object(
        'success', true, 
        'pin', v_ride_pin,
        'debug_wallet_before', v_wallet_balance,
        'debug_price', v_ride_price
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
