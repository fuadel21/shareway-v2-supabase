-- ==========================================
-- MIGRATION: HARDEN_BOOKING_FLOW
-- Fixes notifications, atomic operations, and data integrity
-- ==========================================
-- 1. Ensure notify_on_booking trigger/function exists for atomic notifications
CREATE OR REPLACE FUNCTION public.handle_booking_notification() RETURNS TRIGGER AS $$
DECLARE v_ride_record RECORD;
v_passenger_name TEXT;
BEGIN -- Get ride details for the message
SELECT driver_id,
    destination->>'name' as dest_name INTO v_ride_record
FROM public.rides
WHERE id = NEW.ride_id;
-- Get passenger name (author of the request)
SELECT display_name INTO v_passenger_name
FROM public.profiles
WHERE id = NEW.requester_id;
-- If it's confirmed, notify driver
IF NEW.status = 'confirmed' THEN PERFORM public.create_notification(
    v_ride_record.driver_id,
    'Nueva plaza reservada',
    '¡Genial! ' || COALESCE(v_passenger_name, 'Un pasajero') || ' ha reservado una plaza para tu viaje a ' || COALESCE(v_ride_record.dest_name, 'tu destino') || '.',
    'success',
    jsonb_build_object('ride_id', NEW.ride_id)
);
ELSIF NEW.status = 'pending' THEN PERFORM public.create_notification(
    v_ride_record.driver_id,
    'Nueva solicitud de plaza',
    '¡Interés detectado! ' || COALESCE(v_passenger_name, 'Un pasajero') || ' quiere unirse a tu viaje a ' || COALESCE(v_ride_record.dest_name, 'tu destino') || '.',
    'info',
    jsonb_build_object('ride_id', NEW.ride_id)
);
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. Redefine confirm_trip_and_pay to be even more robust
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_passenger_gender TEXT;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_is_women_only BOOLEAN;
v_approval_mode TEXT;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_booking_status TEXT;
v_departure_time TIMESTAMPTZ;
v_dest_name TEXT;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Bloquear fila del viaje para evitar Overbooking (Race Condition)
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    is_women_only,
    approval_mode,
    departure_time,
    destination->>'name' INTO v_ride_price,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_is_women_only,
    v_approval_mode,
    v_departure_time,
    v_dest_name
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'El viaje no existe o no está disponible';
END IF;
IF v_departure_time <= NOW() THEN RAISE EXCEPTION 'Este viaje ya ha salido.';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan plazas disponibles.';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje.';
END IF;
-- Validar si ya está participando (incluyendo pendientes)
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una solicitud o reserva en este viaje.';
END IF;
-- Validar Género (Women Only)
SELECT display_name,
    photo_url,
    gender INTO v_passenger_name,
    v_passenger_photo,
    v_passenger_gender
FROM public.profiles
WHERE id = v_passenger_id;
IF v_is_women_only
AND (
    v_passenger_gender IS NULL
    OR v_passenger_gender != 'female'
) THEN RAISE EXCEPTION 'Este viaje es exclusivo para mujeres.';
END IF;
-- Validar Balance
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.';
END IF;
-- Definir estado
v_booking_status := CASE
    WHEN v_approval_mode = 'manual' THEN 'pending'
    ELSE 'confirmed'
END;
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
v_new_passenger := json_build_object(
    'id',
    v_passenger_id,
    'displayName',
    v_passenger_name,
    'photoURL',
    v_passenger_photo,
    'status',
    v_booking_status,
    'pin',
    v_ride_pin,
    'booked_price',
    v_ride_price,
    'booked_at',
    NOW()
)::JSONB;
-- 1. Cobro/Retención Atómica
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
WHERE user_id = v_passenger_id;
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT id,
    user_id,
    'hold',
    - v_ride_price,
    balance,
    'Pago retenido para viaje: ' || v_dest_name,
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- 2. Actualizar Viaje
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = CASE
        WHEN v_booking_status = 'confirmed' THEN seats_available - 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
-- 3. Notificaciones Atómicas vía Server-side
-- Notificar al conductor
PERFORM public.create_notification(
    v_driver_id,
    CASE
        WHEN v_booking_status = 'confirmed' THEN 'Reserva confirmada'
        ELSE 'Nueva solicitud'
    END,
    v_passenger_name || CASE
        WHEN v_booking_status = 'confirmed' THEN ' ha reservado tu viaje a '
        ELSE ' quiere unirse a tu viaje a '
    END || v_dest_name,
    'booking',
    jsonb_build_object('ride_id', p_ride_id)
);
-- Notificar al pasajero
PERFORM public.create_notification(
    v_passenger_id,
    CASE
        WHEN v_booking_status = 'confirmed' THEN '¡Reserva exitosa!'
        ELSE 'Solicitud enviada'
    END,
    CASE
        WHEN v_booking_status = 'confirmed' THEN 'Has reservado tu plaza a '
        ELSE 'Tu solicitud para el viaje a '
    END || v_dest_name,
    'success',
    jsonb_build_object('ride_id', p_ride_id)
);
RETURN json_build_object(
    'success',
    true,
    'status',
    v_booking_status,
    'pin',
    v_ride_pin
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;