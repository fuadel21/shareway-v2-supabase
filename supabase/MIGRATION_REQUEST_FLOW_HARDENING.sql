-- ==========================================
-- MIGRATION: RIDE_REQUEST_FLOW_HARDENING
-- Hardening 'Pedir' flow (Ride Requests) and syncing with State Machine
-- ==========================================
-- 1. Update Constraints for ride_requests
ALTER TABLE public.ride_requests DROP CONSTRAINT IF EXISTS ride_requests_status_check;
ALTER TABLE public.ride_requests
ADD CONSTRAINT ride_requests_status_check CHECK (
        status IN (
            'pending',
            'accepted',
            'confirmed',
            'rejected',
            'cancelled',
            'on_board',
            'completed',
            'expired'
        )
    );
-- 2. Hardened create_ride_request with Atomic Notification
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
v_request_id UUID;
v_verification_status TEXT;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Basic validations
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'La fecha debe ser en el futuro.';
END IF;
IF p_seats_needed < 1
OR p_seats_needed > 8 THEN RAISE EXCEPTION 'Asientos inválidos.';
END IF;
v_origin_point := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_destination_point := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
INSERT INTO public.ride_requests (
        requester_id,
        -- Note: column name might vary depending on schema (passenger_id or requester_id)
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only,
        status
    )
VALUES (
        v_requester_id,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only,
        'pending'
    )
RETURNING id INTO v_request_id;
-- Notification to User (Confirmation)
PERFORM public.create_notification(
    v_requester_id,
    'Pedido publicado',
    'Tu solicitud de viaje ha sido publicada. Los conductores podrán verla ahora.',
    'info',
    jsonb_build_object('request_id', v_request_id)
);
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Hardened accept_request (Driver accepting a request)
CREATE OR REPLACE FUNCTION public.accept_request(p_request_id UUID, p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_seats_available INTEGER;
v_passenger_id UUID;
v_origin_name TEXT;
v_dest_name TEXT;
BEGIN v_driver_id := auth.uid();
-- Lock both
SELECT driver_id,
    seats_available,
    (origin->>'name'),
    (destination->>'name') INTO v_ride_driver,
    v_seats_available,
    v_origin_name,
    v_dest_name
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
SELECT requester_id INTO v_passenger_id
FROM public.ride_requests
WHERE id = p_request_id
    AND status = 'pending' FOR
UPDATE;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'Viaje no disponible.';
END IF;
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'Solicitud no disponible.';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'No autorizado.';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'Sin asientos.';
END IF;
UPDATE public.ride_requests
SET status = 'accepted',
    matched_ride_id = p_ride_id,
    payment_expires_at = NOW() + INTERVAL '2 hours'
WHERE id = p_request_id;
PERFORM public.create_notification(
    v_passenger_id,
    '¡Solicitud Aceptada!',
    'Un conductor ha aceptado tu solicitud. Tienes 2 horas para pagar y asegurar tu plaza.',
    'success',
    jsonb_build_object(
        'ride_id',
        p_ride_id,
        'request_id',
        p_request_id,
        'expires_at',
        NOW() + INTERVAL '2 hours'
    )
);
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Update confirm_trip_and_pay to use 'confirmed' status for requests
-- We only redefine the part that updates ride_requests if it exists
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
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_ride_departure TIMESTAMPTZ;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT display_name,
    photo_url,
    gender INTO v_passenger_name,
    v_passenger_photo,
    v_passenger_gender
FROM public.profiles
WHERE id = v_passenger_id;
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    is_women_only,
    departure_time INTO v_ride_price,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_is_women_only,
    v_ride_departure
FROM public.rides
WHERE id = p_ride_id
    AND status IN ('scheduled', 'active') FOR
UPDATE;
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'Viaje no disponible.';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'Sin asientos.';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje.';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya estás en este viaje.';
END IF;
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.';
END IF;
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
    v_ride_price,
    'booked_at',
    NOW()
)::JSONB;
-- Payments
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
WHERE user_id = v_passenger_id;
INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        description,
        related_ride_id
    )
VALUES (
        v_passenger_id,
        'hold',
        - v_ride_price,
        'Reserva confirmada (Retención)',
        p_ride_id
    );
-- Update Request if it exists
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'confirmed'
WHERE id = p_request_id
    AND requester_id = v_passenger_id;
END IF;
-- Update Ride
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = p_ride_id;
-- Notifications
PERFORM public.handle_booking_notification(p_ride_id, v_passenger_id, v_driver_id);
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;