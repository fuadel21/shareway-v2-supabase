-- SHAREWAY V2: HYBRID BOOKING ENGINE (WALLET + STRIPE) - V2
-- Permite reservar usando el saldo de la cartera (wallet) moviéndolo a held_balance.
-- MEJORA: Permite unirse a viajes ya iniciados (status = 'active').
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_seats_to_book INTEGER := 1;
v_price_per_seat DECIMAL;
v_total_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_current_balance DECIMAL;
v_ride_status TEXT;
BEGIN IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Obtener datos del perfil
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
-- 2. Obtener datos del viaje y bloquear (Permitir 'scheduled' y 'active')
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    status INTO v_price_per_seat,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_ride_status
FROM public.rides
WHERE id = p_ride_id
    AND (
        status = 'scheduled'
        OR status = 'active'
    ) FOR
UPDATE;
IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado o ya finalizado';
END IF;
IF v_seats_available < 1 THEN RAISE EXCEPTION 'No hay asientos suficientes';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una reserva en este viaje';
END IF;
IF v_passenger_id = v_driver_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje';
END IF;
-- 3. Gestionar asientos y precio
IF p_request_id IS NOT NULL THEN
SELECT seats_needed INTO v_seats_to_book
FROM public.ride_requests
WHERE id = p_request_id;
END IF;
v_seats_to_book := COALESCE(v_seats_to_book, 1);
v_total_price := v_price_per_seat * v_seats_to_book;
-- 4. GESTIÓN FINANCIERA (Wallet -> Held)
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_current_balance < v_total_price THEN RAISE EXCEPTION 'Saldo insuficiente en tu cartera ShareWay.';
END IF;
-- Mover de balance a held_balance
UPDATE public.wallets
SET balance = balance - v_total_price,
    held_balance = held_balance + v_total_price,
    updated_at = NOW()
WHERE user_id = v_passenger_id;
-- Registrar transacción de retención
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_passenger_id,
        v_passenger_id,
        v_total_price,
        'hold',
        'Reserva con saldo de cartera',
        p_ride_id
    );
-- 5. LOGÍSTICA DE RESERVA
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
v_new_passenger := json_build_object(
    'id',
    v_passenger_id,
    'displayName',
    v_passenger_name,
    'photoURL',
    v_passenger_photo,
    'status',
    'confirmed',
    'pin',
    v_ride_pin,
    'booked_price',
    v_total_price,
    'seats_booked',
    v_seats_to_book,
    'booked_at',
    NOW()
)::JSONB;
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - v_seats_to_book
WHERE id = p_ride_id;
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'accepted'
WHERE id = p_request_id;
END IF;
-- Notificar al conductor si el viaje ya está en curso
IF v_ride_status = 'active' THEN PERFORM public.create_notification(
    v_driver_id,
    '¡Nuevo Pasajero en Ruta!',
    'Un pasajero se ha unido a tu viaje actual. Prepárate para recoger a ' || v_passenger_name,
    'match',
    jsonb_build_object(
        'ride_id',
        p_ride_id,
        'passenger_id',
        v_passenger_id
    )
);
END IF;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;