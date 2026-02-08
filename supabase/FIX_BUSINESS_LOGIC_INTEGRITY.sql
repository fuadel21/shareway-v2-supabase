-- SHAREWAY V2: BUSINESS LOGIC INTEGRITY & TREASURY SYNC (HELD-BALANCE EDITION)
-- Objetivo: Asegurar que los pagos de Stripe vayan a held_balance y que las reservas NO toquen el balance (monedero) del pasajero.
-- 1. BASE: Tesorería
DO $$
DECLARE v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
INSERT INTO public.profiles (id, display_name, email, role, is_admin)
VALUES (
        v_platform_id,
        'ShareWay Treasury',
        'treasury@shareway.com',
        'admin',
        true
    ) ON CONFLICT (id) DO
UPDATE
SET is_admin = true;
INSERT INTO public.wallets (user_id, balance, held_balance)
VALUES (v_platform_id, 0.00, 0.00) ON CONFLICT (user_id) DO NOTHING;
END $$;
-- 2. NUEVA FUNCIÓN: hold_funds_on_booking_success (Llamada desde Webhook)
-- Registra el dinero que el usuario ha pagado en Stripe directamente en held_balance.
CREATE OR REPLACE FUNCTION public.hold_funds_on_booking_success(
        p_user_id UUID,
        p_ride_id UUID,
        p_amount DECIMAL,
        p_payment_intent_id TEXT
    ) RETURNS JSON AS $$ BEGIN
INSERT INTO public.wallets (user_id, balance, held_balance, updated_at)
VALUES (p_user_id, 0, p_amount, NOW()) ON CONFLICT (user_id) DO
UPDATE
SET held_balance = public.wallets.held_balance + EXCLUDED.held_balance,
    updated_at = NOW();
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        p_user_id,
        p_user_id,
        p_amount,
        'hold',
        'Retención por reserva Stripe: ' || p_payment_intent_id,
        p_ride_id
    );
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. CORRECCIÓN: confirm_trip_and_pay (Versión NO-MONEDERO)
-- Reserva el asiento físicamente en la BD. Ya NO resta saldo.
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_seats_to_book INTEGER := 1;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
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
IF p_request_id IS NOT NULL THEN
SELECT seats_needed INTO v_seats_to_book
FROM public.ride_requests
WHERE id = p_request_id;
END IF;
v_seats_to_book := COALESCE(v_seats_to_book, 1);
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
IF v_seats_available < v_seats_to_book THEN RAISE EXCEPTION 'No hay asientos suficientes';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una reserva';
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
    v_ride_price * v_seats_to_book,
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
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. NUEVA FUNCIÓN: verify_passenger_boarding (Check-in)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(p_ride_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
BEGIN IF NOT EXISTS (
    SELECT 1
    FROM public.rides
    WHERE id = p_ride_id
        AND driver_id = v_driver_id
        AND passengers @> jsonb_build_array(
            jsonb_build_object('pin', p_pin, 'status', 'confirmed')
        )
) THEN RAISE EXCEPTION 'PIN incorrecto o pasajero ya verificado.';
END IF;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'pin') = p_pin THEN jsonb_set(p, '{status}', '"verified"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = p_ride_id
    AND driver_id = v_driver_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. FINALIZACIÓN: complete_ride (Pagos netos y Tesorería)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_ride RECORD;
v_pax JSONB;
v_pax_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_net DECIMAL;
v_total_driver DECIMAL := 0;
v_total_platform DECIMAL := 0;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_ride.status = 'completed' THEN RAISE EXCEPTION 'Viaje ya completado';
END IF;
FOR v_pax IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP v_pax_price := (v_pax->>'booked_price')::DECIMAL;
IF v_pax->>'status' IN ('verified', 'no_show') THEN v_platform_fee := ROUND(v_pax_price * 0.15, 2);
v_driver_net := v_pax_price - v_platform_fee;
v_total_driver := v_total_driver + v_driver_net;
v_total_platform := v_total_platform + v_platform_fee;
-- Mover del Held del pasajero a la "invisibilidad" (ya se cobró)
UPDATE public.wallets
SET held_balance = held_balance - v_pax_price
WHERE user_id = (v_pax->>'id')::UUID;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        (v_pax->>'id')::UUID,
        (v_pax->>'id')::UUID,
        - v_pax_price,
        'ride_payment',
        'Pago viaje finalizado',
        p_ride_id
    );
ELSIF v_pax->>'status' = 'confirmed' THEN -- Reembolso automático si no subió
UPDATE public.wallets
SET balance = balance + v_pax_price,
    held_balance = held_balance - v_pax_price
WHERE user_id = (v_pax->>'id')::UUID;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        (v_pax->>'id')::UUID,
        (v_pax->>'id')::UUID,
        v_pax_price,
        'refund',
        'Reembolso: No subiste al coche',
        p_ride_id
    );
END IF;
END LOOP;
-- Liquidar
IF v_total_driver > 0 THEN
UPDATE public.wallets
SET balance = balance + v_total_driver
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
        v_total_driver,
        'ride_earning',
        'Ganancia viaje (Neto)',
        p_ride_id
    );
END IF;
IF v_total_platform > 0 THEN
UPDATE public.wallets
SET balance = balance + v_total_platform
WHERE user_id = v_platform_id;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_platform_id,
        v_platform_id,
        v_total_platform,
        'platform_fee',
        'Comisiones recaudadas',
        p_ride_id
    );
END IF;
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'driver_net',
    v_total_driver,
    'platform_fee',
    v_total_platform
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;