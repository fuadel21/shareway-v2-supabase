-- SHAREWAY V2: WEBHOOK FULFILLMENT RPC
-- Objetivo: Ejecutar todo el proceso de reserva (Finanzas + Reserva de Asiento) en un solo paso tras el pago.
CREATE OR REPLACE FUNCTION public.fulfill_booking_after_payment(
        p_user_id UUID,
        p_ride_id UUID,
        p_amount DECIMAL,
        p_payment_intent_id TEXT
    ) RETURNS JSON AS $$
DECLARE v_passenger_name TEXT;
v_passenger_photo TEXT;
v_seats_to_book INTEGER := 1;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_ride_pin TEXT;
v_new_passenger JSONB;
BEGIN -- 1. REGISTRO FINANCIERO (Held Balance)
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
-- 2. LOGÍSTICA DE RESERVA
-- Buscar la solicitud pendiente para saber cuántos asientos pidió
SELECT seats_needed,
    pin INTO v_seats_to_book,
    v_ride_pin
FROM public.ride_requests
WHERE ride_id = p_ride_id
    AND passenger_id = p_user_id
    AND status = 'pending'
LIMIT 1;
v_seats_to_book := COALESCE(v_seats_to_book, 1);
-- Si no hay PIN (por alguna razón rara), generar uno
IF v_ride_pin IS NULL THEN v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
END IF;
-- Datos del pasajero
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = p_user_id;
-- Bloquear viaje y validar disponibilidad final
SELECT price,
    seats_available INTO v_ride_price,
    v_seats_available
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_seats_available < v_seats_to_book THEN -- CASO EDGE: Se quedó sin asientos entre el intento de pago y el éxito del webhook
-- En producción esto se manejaría con un reembolso automático, por ahora lanzamos error
-- para que el webhook se reintente o quede en logs.
RAISE EXCEPTION 'No hay asientos disponibles (Overbooking en Webhook)';
END IF;
v_new_passenger := json_build_object(
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
    p_amount,
    'seats_booked',
    v_seats_to_book,
    'booked_at',
    NOW()
)::JSONB;
-- Actualizar Viaje
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, p_user_id),
    seats_available = seats_available - v_seats_to_book
WHERE id = p_ride_id;
-- Marcar solicitud como aceptada
UPDATE public.ride_requests
SET status = 'accepted'
WHERE ride_id = p_ride_id
    AND passenger_id = p_user_id;
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;