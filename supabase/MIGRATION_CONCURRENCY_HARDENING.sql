-- ==========================================
-- MIGRATION: CONCURRENCY_AND_ATOMICITY_HARDENING
-- Implementing "Strong Consistency" for Seat Management
-- ==========================================
-- 1. Database-Level Safety Nut (Physical constraint)
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS seats_not_negative;
ALTER TABLE public.rides
ADD CONSTRAINT seats_not_negative CHECK (seats_available >= 0);
-- 2. Helper Function: Recalculate seats (Internal only)
CREATE OR REPLACE FUNCTION public.recalculate_seats(p_ride_id UUID) RETURNS INTEGER AS $$
DECLARE v_seats_total INTEGER;
v_occupied_count INTEGER;
BEGIN
SELECT seats_total INTO v_seats_total
FROM public.rides
WHERE id = p_ride_id;
SELECT COUNT(*) INTO v_occupied_count
FROM public.rides,
    jsonb_array_elements(passengers) p
WHERE id = p_ride_id
    AND p->>'status' IN ('confirmed', 'on_board', 'completed', 'no_show');
RETURN v_seats_total - v_occupied_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Hardened confirm_trip_and_pay (Booking)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_approval_mode TEXT;
v_booking_status TEXT;
v_seats_total INTEGER;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 🔒 LOCK: Prevent any other transaction from touching this ride or the user's wallet
PERFORM 1
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
PERFORM 1
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
-- Fetch current state within the lock
SELECT price,
    seats_available,
    seats_total,
    driver_id,
    participant_ids,
    approval_mode INTO v_ride_price,
    v_seats_available,
    v_seats_total,
    v_driver_id,
    v_participant_ids,
    v_approval_mode
FROM public.rides
WHERE id = p_ride_id;
-- IDEMPOTENCY CHECK: Is the user already in the ride with an active status?
IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
            (
                SELECT passengers
                FROM public.rides
                WHERE id = p_ride_id
            )
        ) p
    WHERE (p->>'id')::UUID = v_passenger_id
        AND p->>'status' IN (
            'pending',
            'accepted',
            'confirmed',
            'on_board',
            'completed'
        )
) THEN RETURN json_build_object(
    'success',
    true,
    'message',
    'Ya tienes una solicitud o reserva activa.'
);
END IF;
-- RE-CALCULATE REAL AVAILABILITY (Consistency check)
v_seats_available := public.recalculate_seats(p_ride_id);
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'Lo sentimos, ya no quedan plazas disponibles.';
END IF;
-- [SECURITY] Verified Check
IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_passenger_id
        AND (verification->>'status') = 'verified'
) THEN RAISE EXCEPTION 'Tu cuenta no está verificada.';
END IF;
-- Wallet Check
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.';
END IF;
-- Determine status
v_booking_status := CASE
    WHEN v_approval_mode = 'manual' THEN 'pending'
    ELSE 'confirmed'
END;
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
v_new_passenger := json_build_object(
    'id',
    v_passenger_id,
    'status',
    v_booking_status,
    'pin',
    v_ride_pin,
    'booked_price',
    v_ride_price,
    'booked_at',
    NOW()
)::JSONB;
-- ATOMIC UPDATES
-- 1. Update Wallet
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
WHERE user_id = v_passenger_id;
-- 2. Update Ride
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id)
WHERE id = p_ride_id;
-- 3. FINAL SYNC: Set seats_available via calculation
UPDATE public.rides
SET seats_available = public.recalculate_seats(p_ride_id)
WHERE id = p_ride_id;
-- 4. Sync external request
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'confirmed'
WHERE id = p_request_id;
END IF;
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
-- 4. Hardened accept_passenger (Driver)
CREATE OR REPLACE FUNCTION public.accept_passenger(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_seats_available INTEGER;
BEGIN v_driver_id := auth.uid();
-- 🔒 LOCK
PERFORM 1
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
-- Recalculate before action
v_seats_available := public.recalculate_seats(p_ride_id);
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No hay plazas libres para aceptar más pasajeros.';
END IF;
-- Update status in JSON array
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id
                    AND p->>'status' = 'pending' THEN jsonb_set(p, '{status}', '"confirmed"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = p_ride_id;
-- SYNC SEATS
UPDATE public.rides
SET seats_available = public.recalculate_seats(p_ride_id)
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. Hardened cancel_booking_and_refund (Passenger)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_booked_price DECIMAL;
v_current_status TEXT;
BEGIN v_passenger_id := auth.uid();
-- 🔒 LOCK
PERFORM 1
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
PERFORM 1
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
-- Fetch info
SELECT (p->>'booked_price')::DECIMAL,
    (p->>'status') INTO v_booked_price,
    v_current_status
FROM public.rides,
    jsonb_array_elements(passengers) p
WHERE id = p_ride_id
    AND (p->>'id')::UUID = v_passenger_id;
IF v_current_status IS NULL
OR v_current_status IN ('cancelled', 'rejected') THEN RAISE EXCEPTION 'No tienes una reserva activa que cancelar.';
END IF;
-- ATOMIC REFUND (Simplified logic: always 100% for this hardening test)
UPDATE public.wallets
SET balance = balance + v_booked_price,
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
-- Update JSON
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    ),
    participant_ids = array_remove(participant_ids, v_passenger_id)
WHERE id = p_ride_id;
-- SYNC SEATS
UPDATE public.rides
SET seats_available = public.recalculate_seats(p_ride_id)
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;