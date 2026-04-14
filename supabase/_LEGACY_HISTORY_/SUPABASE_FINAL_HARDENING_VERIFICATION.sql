-- ==========================================
-- MIGRATION: FINAL_HARDENING_VERIFICATION
-- 1. Identity Verification Checks
-- 2. State Machine Sync (Include 'active' status in lookups)
-- 3. Security (PIN Protection & PII)
-- ==========================================
-- A. Helper: Identity Check
CREATE OR REPLACE FUNCTION public.is_user_verified(p_user_id UUID) RETURNS BOOLEAN AS $$
DECLARE v_verification JSONB;
BEGIN
SELECT verification INTO v_verification
FROM public.profiles
WHERE id = p_user_id;
RETURN (v_verification->>'status') = 'verified';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- B. Force Drop to avoid conflicts
DROP FUNCTION IF EXISTS public.search_rides_secure(JSONB, JSONB, DATE);
DROP FUNCTION IF EXISTS public.get_ride_details_secure(UUID);
-- 1. search_rides_secure: Sync with State Machine
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL,
        is_women_only BOOLEAN,
        passengers_count INTEGER
    ) AS $$ BEGIN RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0)
FROM public.rides r
WHERE r.status IN ('scheduled', 'active') -- SYNC: Including active rides
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    ) -- Points within reasonable distance (fallback logic)
    AND ST_Distance(
        r.origin_location,
        ST_SetSRID(
            ST_MakePoint(
                (p_origin->>'lng')::FLOAT,
                (p_origin->>'lat')::FLOAT
            ),
            4326
        )::geography
    ) < 20000
    AND ST_Distance(
        r.destination_location,
        ST_SetSRID(
            ST_MakePoint(
                (p_destination->>'lng')::FLOAT,
                (p_destination->>'lat')::FLOAT
            ),
            4326
        )::geography
    ) < 20000;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 2. get_ride_details_secure: JSON version with PIN PROTECTION
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_ride JSONB;
v_driver JSONB;
v_passengers JSONB;
BEGIN
SELECT to_jsonb(r) INTO v_ride
FROM public.rides r
WHERE r.id = p_ride_id;
IF v_ride IS NULL THEN RETURN NULL;
END IF;
-- Get driver info
SELECT to_jsonb(p) INTO v_driver
FROM public.profiles p
WHERE p.id = (v_ride->>'driver_id')::UUID;
-- PIN PROTECTION: Remove PINs from the public array
-- The user must use get_my_ride_pin() or verify_passenger() to see/use PINs
IF v_ride ? 'passengers' THEN
SELECT jsonb_agg(p - 'pin') INTO v_passengers
FROM jsonb_array_elements(v_ride->'passengers') p;
v_ride := jsonb_set(
    v_ride,
    '{passengers}',
    COALESCE(v_passengers, '[]'::jsonb)
);
END IF;
v_ride := jsonb_set(
    v_ride,
    '{driver}',
    COALESCE(v_driver, '{}'::jsonb)
);
RETURN v_ride;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 3. create_ride (Driver Verification)
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
DECLARE v_driver_id UUID;
v_driver_name TEXT;
v_driver_photo TEXT;
v_ride_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- IDENTITY VERIFICATION CHECK
IF NOT public.is_user_verified(v_driver_id) THEN RAISE EXCEPTION 'Para ofrecer viajes, debes validar tu identidad en Ajustes > Verificación.';
END IF;
-- Policy Check
IF p_distance IS NOT NULL
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'El precio máximo permitido es 0.60€/km.';
END IF;
END IF;
SELECT display_name,
    photo_url INTO v_driver_name,
    v_driver_photo
FROM public.profiles
WHERE id = v_driver_id;
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
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_total,
        seats_available,
        price,
        initial_price,
        details,
        distance,
        overview_polyline,
        is_women_only,
        approval_mode,
        participant_ids,
        waypoints,
        preferences
    )
VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_is_women_only,
        COALESCE(p_approval_mode, 'automatic'),
        ARRAY [v_driver_id],
        p_waypoints,
        p_preferences
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. create_ride_request (Passenger Verification)
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
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- IDENTITY VERIFICATION CHECK
IF NOT public.is_user_verified(v_requester_id) THEN RAISE EXCEPTION 'Para solicitar viajes, debes validar tu identidad.';
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
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. confirm_trip_and_pay (Booking Verification)
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
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- IDENTITY VERIFICATION CHECK
IF NOT public.is_user_verified(v_passenger_id) THEN RAISE EXCEPTION 'Para confirmar reservas y proceder al pago, debes estar verificado.';
END IF;
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
SELECT price,
    seats_available,
    driver_id,
    participant_ids INTO v_ride_price,
    v_seats_available,
    v_driver_id,
    v_participant_ids
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
WHERE user_id = v_passenger_id FOR
UPDATE;
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
-- Atomic Payments
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
-- Sync Request
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'confirmed'
WHERE id = p_request_id;
END IF;
-- Update Ride
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;