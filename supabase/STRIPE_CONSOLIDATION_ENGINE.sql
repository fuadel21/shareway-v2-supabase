-- ==========================================
-- SHAREWAY V2: STRIPE CONSOLIDATION ENGINE
-- ==========================================
-- Permite que los pagos externos (Stripe) se consoliden en el viaje
-- oficial de forma segura y atómica.
CREATE OR REPLACE FUNCTION public.confirm_stripe_booking(
        p_ride_id UUID,
        p_payment_intent_id TEXT,
        p_pickup_location JSONB DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_request_id UUID;
v_seats_needed INTEGER;
BEGIN IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Verificar la solicitud de Stripe previa
SELECT id,
    pin,
    amount,
    seats_needed INTO v_request_id,
    v_ride_pin,
    v_ride_price,
    v_seats_needed
FROM public.ride_requests
WHERE ride_id = p_ride_id
    AND requester_id = v_passenger_id
    AND payment_intent_id = p_payment_intent_id
    AND status = 'pending';
IF v_request_id IS NULL THEN RAISE EXCEPTION 'Solicitud de pago no encontrada o ya procesada';
END IF;
-- 2. Bloqueo de VIAJE para evitar sobreventa en el último segundo
SELECT seats_available,
    driver_id,
    participant_ids,
    display_name INTO v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_passenger_name
FROM public.rides r
    JOIN public.profiles p ON p.id = v_passenger_id
WHERE r.id = p_ride_id FOR
UPDATE;
IF v_seats_available < v_seats_needed THEN RAISE EXCEPTION 'Lamentablemente, ya no quedan asientos. Tu pago será reembolsado automáticamente.';
END IF;
-- 3. Info de perfil extendida
SELECT photo_url INTO v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
-- 4. Marcado de solicitud como FULFILLED
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = v_request_id;
-- 5. Inserción oficial en el viaje (CONSOLIDACIÓN)
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
    v_ride_price,
    'seats_booked',
    v_seats_needed,
    'payment_method',
    'stripe',
    'payment_intent_id',
    p_payment_intent_id,
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
    seats_available = seats_available - v_seats_needed
WHERE id = p_ride_id;
-- 6. Auditoría: Registrar la transacción externa (Amount 0 en wallet porque fue por Stripe, pero logueamos)
INSERT INTO public.wallet_transactions (
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
        0.00,
        'stripe_booking',
        'Reserva pagada vía Tarjeta (ID: ' || p_payment_intent_id || ')',
        p_ride_id
    );
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;