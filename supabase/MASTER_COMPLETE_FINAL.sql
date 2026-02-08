-- ==========================================
-- CRITICAL FIX: Add waypoints column support
-- ==========================================
-- 1. Add waypoints column if not exists
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS waypoints JSONB DEFAULT '[]'::jsonb;
-- 2. Update create_ride to include waypoints in INSERT
-- This is already handled in MASTER_UNIFIED_RIDE_LIFECYCLE.sql parameter list,
-- but the INSERT statement needs to be updated.
-- Note: The INSERT in create_ride (lines 111-128) needs manual update to include:
-- - waypoints in column list (after approval_mode)
-- - p_waypoints in VALUES list (after p_approval_mode)
-- Example:
-- INSERT INTO public.rides (
--     ...
--     approval_mode,
--     waypoints,  -- ADD THIS
--     status,
--     ...
-- ) VALUES (
--     ...
--     p_approval_mode,
--     p_waypoints,  -- ADD THIS
--     'scheduled',
--     ...
-- );
-- ==============================================================================
-- MASTER_UNIFIED_RIDE_LIFECYCLE.sql
-- Proposito: Consolidar TODO el ciclo de vida de viajes en un unico script robusto.
-- Versión: 2.7.0 (Fixed integrity checks and auditing)
-- ==============================================================================
DO $$
DECLARE func_name TEXT;
funcs_to_drop TEXT [] := ARRAY [
        'create_ride', 
        'confirm_trip_and_pay', 
        'start_ride', 
        'verify_passenger', 
        'complete_ride', 
        'cancel_booking_and_refund', 
        'cancel_ride', 
        'get_my_ride_pin',
        'update_ride_location',
        'confirm_passenger_arrival',
        'search_rides',
        'get_user_rides',
        'create_payout_request'
    ];
BEGIN FOREACH func_name IN ARRAY funcs_to_drop LOOP BEGIN EXECUTE (
    SELECT string_agg(
            'DROP FUNCTION ' || oid::regprocedure || ' CASCADE;',
            ' '
        )
    FROM pg_proc
    WHERE proname = func_name
        AND pronamespace = 'public'::regnamespace
);
EXCEPTION
WHEN OTHERS THEN RAISE NOTICE 'Could not drop functions for %: %',
func_name,
SQLERRM;
END;
END LOOP;
END $$;
CREATE EXTENSION IF NOT EXISTS postgis;
-- 0.1. TABLES PARA AUDITORÍA AVANZADA
CREATE TABLE IF NOT EXISTS public.rpc_error_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    function_name TEXT,
    error_message TEXT,
    error_detail TEXT,
    user_id UUID,
    params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.ride_location_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);
-- 1. CREATE RIDE
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
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
BEGIN IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT display_name,
    photo_url,
    gender INTO v_driver_name,
    v_driver_photo,
    v_driver_gender
FROM public.profiles
WHERE id = v_driver_id;
IF p_price > 0
AND p_distance > 0
AND (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km.';
END IF;
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status IN ('scheduled', 'active')
        AND ABS(
            EXTRACT(
                EPOCH
                FROM (departure_time - p_departure_time)
            )
        ) < 7200
) THEN RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje en un margen de 2h.';
END IF;
IF p_is_women_only
AND (
    v_driver_gender IS NULL
    OR LOWER(v_driver_gender) != 'female'
) THEN RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
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
        details,
        distance,
        overview_polyline,
        is_women_only,
        participant_ids,
        approval_mode,
        waypoints,
        status,
        passengers
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
        p_details,
        p_distance,
        p_overview_polyline,
        p_is_women_only,
        ARRAY [v_driver_id],
        p_approval_mode,
        p_waypoints,
        'scheduled',
        '[]'::jsonb
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'create_ride',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('departure', p_departure_time, 'price', p_price)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. CONFIRM TRIP AND PAY
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
v_participant_ids UUID [];
BEGIN IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
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
    AND status = 'scheduled' FOR
UPDATE;
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'Viaje no disponible';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'Sin asientos';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya estás en este viaje';
END IF;
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance IS NULL THEN RAISE EXCEPTION 'Wallet no encontrada';
END IF;
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
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id,
        balance_after
    )
VALUES (
        v_passenger_id,
        v_passenger_id,
        - v_ride_price,
        'hold',
        'Reserva de viaje (Escrow)',
        p_ride_id,
        v_wallet_balance - v_ride_price
    );
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::jsonb) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = p_ride_id;
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = p_request_id;
END IF;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'confirm_trip_and_pay',
        SQLERRM,
        SQLSTATE,
        v_passenger_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. START RIDE
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
BEGIN
UPDATE public.rides
SET status = 'active',
    started_at = NOW()
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled';
IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo iniciar el viaje';
END IF;
RETURN json_build_object('success', true);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'start_ride',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. VERIFY PASSENGER
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No autorizado o viaje inexistente';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_passengers) p
    WHERE (p->>'id')::UUID = p_passenger_id
        AND TRIM(p->>'pin') = TRIM(p_pin)
) THEN RAISE EXCEPTION 'PIN_INCORRECTO';
END IF;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"verified"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(v_passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'verify_passenger',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object(
            'ride_id',
            p_ride_id,
            'passenger_id',
            p_passenger_id
        )
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. COMPLETE RIDE
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_ride RECORD;
v_total_payout DECIMAL := 0;
v_p JSONB;
v_d_wallet_balance DECIMAL;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'active' FOR
UPDATE;
IF v_ride.id IS NULL THEN RAISE EXCEPTION 'El viaje no está activo o no eres el conductor';
END IF;
FOR v_p IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP IF v_p->>'status' IN ('confirmed', 'verified') THEN v_total_payout := v_total_payout + (v_p->>'booked_price')::DECIMAL;
UPDATE public.wallets
SET held_balance = held_balance - (v_p->>'booked_price')::DECIMAL
WHERE user_id = (v_p->>'id')::UUID;
END IF;
END LOOP;
IF v_total_payout > 0 THEN
UPDATE public.wallets
SET balance = balance + (v_total_payout * 0.9)
WHERE user_id = v_driver_id
RETURNING balance INTO v_d_wallet_balance;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id,
        balance_after
    )
VALUES (
        v_driver_id,
        v_driver_id,
        v_total_payout * 0.9,
        'payout',
        'Ingreso por viaje completado',
        p_ride_id,
        v_d_wallet_balance
    );
END IF;
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'payout', v_total_payout * 0.9);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'complete_ride',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. UPDATE RIDE LOCATION
CREATE OR REPLACE FUNCTION public.update_ride_location(p_ride_id UUID, p_location JSONB) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_point GEOGRAPHY;
BEGIN IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
v_point := ST_SetSRID(
    ST_MakePoint(
        (p_location->>'lng')::FLOAT,
        (p_location->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
UPDATE public.rides
SET current_location = p_location
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'active';
IF FOUND THEN
INSERT INTO public.ride_location_history (ride_id, location)
VALUES (p_ride_id, v_point);
END IF;
RETURN json_build_object('success', FOUND);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'update_ride_location',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 7. UTILS
CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_pin TEXT;
BEGIN
SELECT p->>'pin' INTO v_pin
FROM public.rides r,
    jsonb_array_elements(r.passengers) p
WHERE r.id = p_ride_id
    AND (p->>'id')::UUID = v_user_id;
RETURN json_build_object('success', v_pin IS NOT NULL, 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 8. CANCEL RIDE (CONDUCTOR)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passenger RECORD;
v_passengers JSONB;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No puedes cancelar un viaje que ya está activo o completado. Contacta con soporte.';
END IF;
FOR v_passenger IN
SELECT (p->>'id')::UUID as pid,
    (p->>'booked_price')::DECIMAL as price
FROM jsonb_array_elements(v_passengers) p
WHERE p->>'status' IN ('confirmed', 'pending', 'verified') LOOP
UPDATE public.wallets
SET balance = balance + v_passenger.price,
    held_balance = held_balance - v_passenger.price
WHERE user_id = v_passenger.pid;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_passenger.pid,
        v_passenger.pid,
        v_passenger.price,
        'refund',
        'Viaje cancelado por el conductor',
        p_ride_id
    );
END LOOP;
UPDATE public.rides
SET status = 'cancelled',
    cancelled_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Viaje cancelado y pasajeros reembolsados.'
);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'cancel_ride',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 9. CREATE PAYOUT REQUEST
CREATE OR REPLACE FUNCTION public.create_payout_request(p_amount NUMERIC) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_current_balance NUMERIC;
v_payout_id UUID;
BEGIN IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_user_id FOR
UPDATE;
IF v_current_balance IS NULL
OR v_current_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente para el retiro.';
END IF;
IF p_amount < 5 THEN RAISE EXCEPTION 'El monto mínimo de retiro es de 5€.';
END IF;
UPDATE public.wallets
SET balance = balance - p_amount
WHERE user_id = v_user_id;
INSERT INTO public.payout_requests (user_id, amount, status)
VALUES (v_user_id, p_amount, 'pending')
RETURNING id INTO v_payout_id;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
SELECT v_user_id,
    v_user_id,
    - p_amount,
    balance,
    'withdrawal',
    'Retiro de fondos solicitado'
FROM public.wallets
WHERE user_id = v_user_id;
RETURN json_build_object('success', true, 'payoutId', v_payout_id);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'create_payout_request',
        SQLERRM,
        SQLSTATE,
        v_user_id,
        json_build_object('amount', p_amount)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 10. GET USER RIDES
CREATE OR REPLACE FUNCTION public.get_user_rides(p_user_id UUID, p_role TEXT DEFAULT 'all') RETURNS JSON AS $$ BEGIN RETURN (
        SELECT json_agg(r.*)
        FROM public.rides r
        WHERE (
                p_role = 'driver'
                AND r.driver_id = p_user_id
            )
            OR (
                p_role = 'passenger'
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(r.passengers) p
                    WHERE (p->>'id')::UUID = p_user_id
                )
            )
            OR (
                p_role = 'all'
                AND (
                    r.driver_id = p_user_id
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(r.passengers) p
                        WHERE (p->>'id')::UUID = p_user_id
                    )
                )
            )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 11. CANCEL BOOKING AND REFUND (PASAJERO)
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_booked_price NUMERIC;
v_departure_time TIMESTAMPTZ;
v_passengers JSONB;
v_new_passengers JSONB;
v_refund_amount NUMERIC;
v_refund_percentage INTEGER;
v_hours_until_departure FLOAT;
v_driver_id UUID;
v_penalty_amount NUMERIC;
v_driver_compensation NUMERIC := 0;
v_booked_at TIMESTAMPTZ;
v_minutes_since_booking FLOAT;
v_ride_status TEXT;
BEGIN IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT driver_id,
    departure_time,
    passengers,
    status INTO v_driver_id,
    v_departure_time,
    v_passengers,
    v_ride_status
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje ya ha iniciado o finalizado.';
END IF;
SELECT (p->>'booked_price')::NUMERIC,
    (p->>'booked_at')::TIMESTAMPTZ INTO v_booked_price,
    v_booked_at
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'id')::UUID = v_passenger_id
    AND p->>'status' = 'confirmed';
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'No tienes una reserva confirmada.';
END IF;
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_departure_time - NOW())
) / 3600;
v_minutes_since_booking := CASE
    WHEN v_booked_at IS NULL THEN 999
    ELSE EXTRACT(
        EPOCH
        FROM (NOW() - v_booked_at)
    ) / 60
END;
IF v_minutes_since_booking <= 15
AND v_hours_until_departure > 3 THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure > 24 THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure >= 2 THEN v_refund_percentage := 50;
v_refund_amount := ROUND(v_booked_price * 0.5, 2);
ELSE v_refund_percentage := 0;
v_refund_amount := 0;
END IF;
v_penalty_amount := v_booked_price - v_refund_amount;
SELECT json_agg(
        CASE
            WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
            ELSE p
        END
    ) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) p;
UPDATE public.wallets
SET balance = balance + v_refund_amount,
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
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
        v_refund_amount,
        'refund',
        'Reembolso (' || v_refund_percentage || '%) por cancelación',
        p_ride_id
    );
IF v_penalty_amount > 0 THEN v_driver_compensation := ROUND(v_penalty_amount * 0.8, 2);
UPDATE public.wallets
SET balance = balance + v_driver_compensation
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_driver_id,
        v_driver_id,
        v_driver_compensation,
        'cancellation_compensation',
        'Compensación por cancelación tardía',
        p_ride_id
    );
END IF;
UPDATE public.rides
SET passengers = v_new_passengers,
    participant_ids = array_remove(participant_ids, v_passenger_id),
    seats_available = seats_available + 1
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Cancelado. Reembolso: ' || v_refund_amount
);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'cancel_booking_and_refund',
        SQLERRM,
        SQLSTATE,
        v_passenger_id,
        json_build_object('ride_id', p_ride_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 12. SEARCH RIDES SECURE (Elite Matching Engine)
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_eco_tier TEXT,
        driver_verified TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL,
        is_women_only BOOLEAN,
        passengers_count INTEGER,
        match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID := auth.uid();
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
BEGIN IF v_searcher_id IS NOT NULL THEN
SELECT p.gender INTO v_searcher_gender
FROM public.profiles p
WHERE p.id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL AS driver_rating,
    p.eco_tier AS driver_eco_tier,
    (p.verification->>'status')::TEXT AS driver_verified,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0),
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT AS match_score
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active')
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price
    AND ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
    AND ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY match_score DESC,
    p.rating DESC,
    r.departure_time ASC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 13. FULFILL RIDE REQUEST (Driver accepts passenger request)
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passenger_id UUID;
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_ride_id UUID;
v_ride_res JSON;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_passenger_obj JSONB;
BEGIN IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT requester_id INTO v_passenger_id
FROM public.ride_requests
WHERE id = p_request_id
    AND status = 'pending';
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'La solicitud ya no está disponible.';
END IF;
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance < p_price THEN RAISE EXCEPTION 'El pasajero no tiene saldo suficiente.';
END IF;
SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        NULL,
        FALSE,
        FALSE,
        '{}',
        'automatic',
        p_waypoints,
        '{}'
    ) INTO v_ride_res;
IF NOT (v_ride_res->>'success')::BOOLEAN THEN RETURN v_ride_res;
END IF;
v_ride_id := (v_ride_res->>'rideId')::UUID;
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
UPDATE public.wallets
SET balance = balance - p_price,
    held_balance = held_balance + p_price
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
    - p_price,
    balance,
    'Reserva automática por Match',
    v_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
v_passenger_obj := json_build_object(
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
    p_price,
    'booked_at',
    NOW()
)::JSONB;
UPDATE public.rides
SET passengers = jsonb_build_array(v_passenger_obj),
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = v_ride_id;
UPDATE public.ride_requests
SET status = 'fulfilled',
    matched_ride_id = v_ride_id
WHERE id = p_request_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'fulfill_ride_request',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('request_id', p_request_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
