-- ==========================================
-- FIX_DETOUR_PRICING.sql
-- Permite que confirm_trip_and_pay reciba un precio personalizado
-- (para casos de desvío o incorporación a recorrido)
-- ==========================================
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, jsonb, text);
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL,
        p_pickup_location JSONB DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL,
        p_price DECIMAL DEFAULT NULL
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
-- 3. AJUSTE DE PRECIO (Si se proporciona uno específico por desvío)
IF p_price IS NOT NULL
AND p_price > 0 THEN v_price_per_seat := p_price;
END IF;
-- 4. Info de perfil
SELECT photo_url INTO v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
-- 5. Asientos requeridos
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
-- 6. CÁLCULO TOTAL
v_total_price := v_price_per_seat * v_seats_to_book;
IF v_current_balance < v_total_price THEN RAISE EXCEPTION 'Saldo insuficiente (Faltan %€)',
(v_total_price - v_current_balance);
END IF;
-- 7. TRANSACCIÓN FINANCIERA ATÓMICA
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
        'Reserva de viaje (' || v_seats_to_book || ' plazas) ' || CASE
            WHEN p_price IS NOT NULL THEN '(Precio ajustado por desvío)'
            ELSE ''
        END,
        p_ride_id
    );
-- 8. LOGÍSTICA DE RESERVA
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
RETURN json_build_object(
    'success',
    true,
    'pin',
    v_ride_pin,
    'final_price',
    v_total_price
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;