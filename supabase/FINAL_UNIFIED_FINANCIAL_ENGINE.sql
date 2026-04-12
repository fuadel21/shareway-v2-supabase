-- ==========================================
-- SHAREWAY V2: UNIFIED TREASURY & FINANCIAL ENGINE
-- ==========================================
-- Unifica wallet_transactions y transactions, asegura 
-- que las comisiones fluyan a la tesorería y protege contra overbooking.
-- 1. UNIFICACIÓN DE ESQUEMA
DO $$ BEGIN -- Asegurar que la tabla definitiva sea wallet_transactions
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'wallet_transactions'
) THEN CREATE TABLE public.wallet_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    wallet_id UUID REFERENCES public.wallets(user_id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    balance_after NUMERIC(10, 2),
    type TEXT,
    description TEXT,
    related_ride_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
END IF;
-- Si existe la tabla antigua 'transactions', migramos datos y la borramos (o la dejamos como vista)
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'transactions'
) THEN
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description,
        related_ride_id,
        created_at
    )
SELECT user_id,
    wallet_id,
    amount,
    balance_after,
    type,
    description,
    related_ride_id,
    created_at
FROM public.transactions ON CONFLICT DO NOTHING;
DROP TABLE public.transactions CASCADE;
END IF;
END $$;
-- Crear vista para compatibilidad con el código que aún busque 'transactions'
CREATE OR REPLACE VIEW public.transactions AS
SELECT *
FROM public.wallet_transactions;
-- 2. FUNCIÓN MAESTRA: confirm_trip_and_pay (V3.0)
-- Combina: Atomicidad + Multi-plaza + Recogidas Personalizadas + Auditoría
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL,
        p_pickup_location JSONB DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL
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
-- 1. Bloqueo de WALLET primero (Evita doble gasto)
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_current_balance IS NULL THEN RAISE EXCEPTION 'Wallet no inicializada';
END IF;
-- 2. Bloqueo de VIAJE (Evita overbooking)
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    status,
    display_name INTO v_price_per_seat,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_ride_status,
    v_passenger_name
FROM public.rides r
    JOIN public.profiles p ON p.id = v_passenger_id
WHERE r.id = p_ride_id FOR
UPDATE;
IF v_ride_status NOT IN ('scheduled', 'active') THEN RAISE EXCEPTION 'El viaje ya no acepta reservas (Estado: %)',
v_ride_status;
END IF;
-- 3. Info de perfil (Photo separately to avoid join issues if null)
SELECT photo_url INTO v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
-- 4. Asientos requeridos
IF p_request_id IS NOT NULL THEN
SELECT seats_needed INTO v_seats_to_book
FROM public.ride_requests
WHERE id = p_request_id;
END IF;
v_seats_to_book := COALESCE(v_seats_to_book, 1);
IF v_seats_available < v_seats_to_book THEN RAISE EXCEPTION 'Asientos insuficientes (Disponibles: %, Pedidos: %)',
v_seats_available,
v_seats_to_book;
END IF;
IF v_passenger_id = v_driver_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una reserva en este viaje';
END IF;
v_total_price := v_price_per_seat * v_seats_to_book;
IF v_current_balance < v_total_price THEN RAISE EXCEPTION 'Saldo insuficiente (Faltan %€)',
(v_total_price - v_current_balance);
END IF;
-- 5. TRANSACCIÓN FINANCIERA ATÓMICA
UPDATE public.wallets
SET balance = balance - v_total_price,
    held_balance = held_balance + v_total_price,
    updated_at = NOW()
WHERE user_id = v_passenger_id;
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_passenger_id,
        v_passenger_id,
        - v_total_price,
        v_current_balance - v_total_price,
        'hold',
        'Reserva de viaje (' || v_seats_to_book || ' plazas)',
        p_ride_id
    );
-- 6. LOGÍSTICA DE RESERVA
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
v_new_passenger := jsonb_build_object(
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
    NOW(),
    'pickup_location',
    p_pickup_location,
    'pickup_address',
    p_pickup_address
);
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
-- 3. FUNCIÓN MAESTRA: complete_ride (V3.0)
-- Corrige el flujo de dinero a TESORERÍA e Idempotencia
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_ride RECORD;
v_passenger JSONB;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_earning DECIMAL;
v_total_platform_fee DECIMAL := 0;
v_passengers_final JSONB := '[]'::JSONB;
BEGIN -- Bloqueo de seguridad
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride.driver_id != v_driver_id THEN RAISE EXCEPTION 'No autorizado';
END IF;
IF v_ride.status = 'completed' THEN RAISE EXCEPTION 'El viaje ya ha sido completado';
END IF;
-- Procesar cada pasajero
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP IF (v_passenger->>'status') IN ('confirmed', 'verified', 'confirmed_by_pin') THEN v_passenger_id := (v_passenger->>'id')::UUID;
v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
v_platform_fee := ROUND(v_booked_price * 0.15, 2);
v_driver_earning := v_booked_price - v_platform_fee;
v_total_platform_fee := v_total_platform_fee + v_platform_fee;
-- Descontar de Held Pasajero
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
-- Pagar al Conductor
UPDATE public.wallets
SET balance = balance + v_driver_earning
WHERE user_id = v_driver_id;
-- Registrar ganancia conductor
INSERT INTO public.wallet_transactions (
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
        v_driver_earning,
        'trip_earning',
        'Ganancia por viaje (Pasajero: ' || (v_passenger->>'displayName') || ')',
        p_ride_id
    );
v_passengers_final := v_passengers_final || jsonb_set(v_passenger, '{status}', '"completed"');
ELSE v_passengers_final := v_passengers_final || v_passenger;
END IF;
END LOOP;
-- Pagar a la Plataforma (Tesorería)
IF v_total_platform_fee > 0 THEN
UPDATE public.wallets
SET balance = balance + v_total_platform_fee
WHERE user_id = v_platform_id;
INSERT INTO public.wallet_transactions (
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
        v_total_platform_fee,
        'platform_fee',
        'Comisión 15% viaje ID: ' || p_ride_id,
        p_ride_id
    );
END IF;
-- Cerrar Viaje
UPDATE public.rides
SET status = 'completed',
    passengers = v_passengers_final,
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'platform_fee',
    v_total_platform_fee
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;