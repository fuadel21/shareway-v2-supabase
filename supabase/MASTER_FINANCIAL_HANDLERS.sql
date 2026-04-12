-- ==========================================
-- SHAREWAY V2: MASTER EXTERNAL PAYMENT HANDLERS
-- ==========================================
-- Sincroniza Stripe Webhook y Manual con la arquitectura unificada.
-- 1. HANDLER: Carga de Saldo (Wallet Topup)
CREATE OR REPLACE FUNCTION public.credit_wallet_on_success(
        p_user_id UUID,
        p_payment_intent_id TEXT,
        p_amount DECIMAL
    ) RETURNS JSON AS $$
DECLARE v_current_balance DECIMAL;
BEGIN -- Idempotencia: Verificar si ya existe esta transacción
IF EXISTS (
    SELECT 1
    FROM public.wallet_transactions
    WHERE description LIKE '%' || p_payment_intent_id || '%'
) THEN RETURN json_build_object('success', true, 'message', 'Pago ya procesado.');
END IF;
-- Upsert de wallet
INSERT INTO public.wallets (user_id, balance, held_balance, updated_at)
VALUES (p_user_id, p_amount, 0, NOW()) ON CONFLICT (user_id) DO
UPDATE
SET balance = public.wallets.balance + EXCLUDED.balance,
    updated_at = NOW()
RETURNING balance INTO v_current_balance;
-- Registrar en tabla UNIFICADA
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
VALUES (
        p_user_id,
        p_user_id,
        p_amount,
        v_current_balance,
        'deposit_stripe',
        'Recarga via Stripe (ID: ' || p_payment_intent_id || ')'
    );
RETURN json_build_object(
    'success',
    true,
    'new_balance',
    v_current_balance
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. HANDLER: Reserva de Viaje tras Pago (Ride Booking)
-- Reemplaza fulfill_booking_after_payment y se sincroniza con confirm_stripe_booking
CREATE OR REPLACE FUNCTION public.fulfill_booking_after_payment(
        p_user_id UUID,
        p_ride_id UUID,
        p_amount DECIMAL,
        p_payment_intent_id TEXT,
        p_wallet_deduction DECIMAL DEFAULT 0
    ) RETURNS JSON AS $$
DECLARE v_passenger_name TEXT;
v_passenger_photo TEXT;
v_seats_to_book INTEGER;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_seats_available INTEGER;
v_participant_ids UUID [];
v_request_id UUID;
v_pickup_location JSONB;
v_pickup_address TEXT;
BEGIN -- 1. Idempotencia: ¿Ya es pasajero?
SELECT participant_ids,
    seats_available INTO v_participant_ids,
    v_seats_available
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF p_user_id = ANY(v_participant_ids) THEN RETURN json_build_object('success', true, 'message', 'Ya es pasajero.');
END IF;
-- 2. Obtener detalles de la solicitud previa (guardados al iniciar el pago)
SELECT id,
    seats_needed,
    pin,
    pickup_location,
    pickup_address INTO v_request_id,
    v_seats_to_book,
    v_ride_pin,
    v_pickup_location,
    v_pickup_address
FROM public.ride_requests
WHERE ride_id = p_ride_id
    AND requester_id = p_user_id
    AND (
        payment_intent_id = p_payment_intent_id
        OR status = 'pending'
    )
LIMIT 1;
v_seats_to_book := COALESCE(v_seats_to_book, 1);
IF v_ride_pin IS NULL THEN v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
END IF;
-- 3. Validar disponibilidad
IF v_seats_available < v_seats_to_book THEN -- En este caso crítico, el dinero se queda en balance (reembolso interno automático)
PERFORM public.credit_wallet_on_success(
    p_user_id,
    p_payment_intent_id || '_refund',
    p_amount
);
RETURN json_build_object(
    'success',
    false,
    'error',
    'No hay asientos. Saldo reembolsado a Cartera.'
);
END IF;
-- 4. Perfil
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = p_user_id;
-- 5. TRANSACCIÓN FINANCIERA MIXTA (Held balance para auditoría)
-- Mueve el monto de Stripe y el monto retenido de la wallet directos al escrow del viaje
UPDATE public.wallets
SET held_balance = held_balance + p_amount + p_wallet_deduction,
    balance = balance - p_wallet_deduction,
    updated_at = NOW()
WHERE user_id = p_user_id;
INSERT INTO public.wallet_transactions (
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
        0.00,
        'stripe_booking_escrow',
        'Pago Stripe en garantía (ID: ' || p_payment_intent_id || ')',
        p_ride_id
    );
-- 6. Inserción en Viaje
v_new_passenger := jsonb_build_object(
    'id',
    p_user_id,
    'displayName',
    v_passenger_name,
    'photoURL',
    v_passenger_photo,
    'status',
    'confirmed',
    'pin',
    v_ride_pin,
    'booked_price',
    p_amount + p_wallet_deduction,
    'seats_booked',
    v_seats_to_book,
    'payment_method',
    'stripe',
    'payment_intent_id',
    p_payment_intent_id,
    'booked_at',
    NOW(),
    'pickup_location',
    v_pickup_location,
    'pickup_address',
    v_pickup_address
);
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, p_user_id),
    seats_available = seats_available - v_seats_to_book
WHERE id = p_ride_id;
-- 7. Limpieza de solicitudes
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = v_request_id;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;