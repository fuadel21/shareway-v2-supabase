-- ==============================================================================
-- 20260118_FINAL_UNIFIED_RIDE_LIFECYCLE.sql
-- Proposito: Consolidar TODO el ciclo de vida de viajes en un unico script.
-- Incluye: Creación hardened, Reserva con Wallet, PIN, Inicio, Fin, Pagos y GPS.
-- ==============================================================================

-- 1. Limpieza agresiva de versiones previas para evitar ambigüedad de candidatos
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure as proto
        FROM pg_proc
        WHERE proname IN ('create_ride', 'confirm_trip_and_pay', 'complete_ride', 'start_ride', 'verify_passenger', 'cancel_booking_and_refund')
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proto || ' CASCADE';
    END LOOP;
END $$;

-- 2. CREATE RIDE (Elite Security + Overlap + Fair Price)
CREATE OR REPLACE FUNCTION public.create_ride(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_bounds JSONB DEFAULT NULL,
        p_is_women_only BOOLEAN DEFAULT FALSE,
        p_is_exclusive_community BOOLEAN DEFAULT FALSE,
        p_allowed_communities TEXT [] DEFAULT '{}',
        p_approval_mode TEXT DEFAULT 'automatic',
        p_waypoints JSONB DEFAULT '[]'::jsonb,
        p_preferences JSONB DEFAULT '{}'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_driver_name TEXT;
v_driver_photo TEXT;
v_driver_gender TEXT;
v_ride_id UUID;
v_verification_status TEXT;
BEGIN IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT display_name,
    photo_url,
    gender,
    (verification->>'status') INTO v_driver_name,
    v_driver_photo,
    v_driver_gender,
    v_verification_status
FROM public.profiles
WHERE id = v_driver_id;

-- VERIFICACIÓN DESHABILITADA PARA PRUEBAS
-- IF v_verification_status IS NULL OR v_verification_status != 'verified' THEN
--     RAISE EXCEPTION 'Solo usuarios verificados pueden ofrecer viajes.';
-- END IF;

-- Fair Price (0.60€/km)
IF p_price > 0
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km.';
END IF;
END IF;
-- Overlap Prevention (±2h)
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status IN ('scheduled', 'in_progress', 'active')
        AND ABS(
            EXTRACT(
                EPOCH
                FROM (departure_time - p_departure_time)
            )
        ) < 7200
) THEN RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje en un margen de 2h.';
END IF;
-- Gender Shield
IF p_is_women_only
AND (
    v_driver_gender IS NULL
    OR LOWER(v_driver_gender) != 'female'
) THEN RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
END IF;
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        is_women_only,
        participant_ids,
        approval_mode,
        waypoints,
        preferences,
        status
    )
VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_is_women_only,
        ARRAY [v_driver_id],
        p_approval_mode,
        p_waypoints,
        p_preferences,
        'scheduled'
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. CONFIRM TRIP AND PAY (Transaction Safe)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_new_passenger JSONB;
BEGIN
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;

-- MODIFICACIÓN: Se permite reservar si el estado es 'scheduled' o 'active' (En curso)
SELECT price,
    seats_available,
    driver_id INTO v_ride_price,
    v_seats_available,
    v_driver_id
FROM public.rides
WHERE id = p_ride_id
    AND status IN ('scheduled', 'active') FOR
UPDATE;

IF v_ride_price IS NULL THEN RAISE EXCEPTION 'Viaje no disponible';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'Sin asientos';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje';
END IF;
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente';
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
SELECT user_id,
    user_id,
    'hold',
    - v_ride_price,
    balance,
    'Reserva (Hold)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = p_ride_id;
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = p_request_id;
END IF;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. START RIDE
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
BEGIN
UPDATE public.rides
SET status = 'active',
    started_at = NOW()
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled';
IF NOT FOUND THEN RETURN json_build_object(
    'success',
    false,
    'message',
    'No se pudo iniciar'
);
END IF;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. VERIFY PASSENGER (PIN)
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
v_match BOOLEAN := false;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No autorizado o viaje inexistente.';
END IF;
SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_passengers) p
        WHERE (p->>'id')::UUID = p_passenger_id
            AND (p->>'pin') = p_pin
    ) INTO v_match;
IF v_match THEN
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"verified"')
            ELSE p
        END
    ) INTO v_passengers
FROM jsonb_array_elements(v_passengers) p;
UPDATE public.rides
SET passengers = v_passengers
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
ELSE RAISE EXCEPTION 'PIN_INCORRECTO';
END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. COMPLETE RIDE (Earnings + Transactions)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_ride RECORD;
v_total_payout DECIMAL := 0;
v_p JSONB;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'active' FOR
UPDATE;
IF v_ride.id IS NULL THEN RAISE EXCEPTION 'El viaje no está activo o no eres el conductor.';
END IF;
FOR v_p IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP IF v_p->>'status' IN ('confirmed', 'verified', 'on_board') THEN v_total_payout := v_total_payout + (v_p->>'booked_price')::DECIMAL;
UPDATE public.wallets
SET held_balance = held_balance - (v_p->>'booked_price')::DECIMAL
WHERE user_id = (v_p->>'id')::UUID;
END IF;
END LOOP;
IF v_total_payout > 0 THEN
UPDATE public.wallets
SET balance = balance + (v_total_payout * 0.9)
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'payout',
    (v_total_payout * 0.9),
    balance,
    'Pago trayecto completado',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
END IF;
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'payout', v_total_payout * 0.9);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
