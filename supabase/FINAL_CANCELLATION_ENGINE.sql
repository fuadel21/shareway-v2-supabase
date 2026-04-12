-- ==========================================
-- SHAREWAY V2: UNIFIED CANCELLATION ENGINE (V3.0)
-- ==========================================
-- Sincroniza las cancelaciones con la tabla wallet_transactions
-- y asegura que la tesorería reciba las penalizaciones.
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_ride RECORD;
v_passenger JSONB;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_hours_until_departure FLOAT;
v_driver_penalty DECIMAL := 0;
v_pax_compensation DECIMAL := 0;
v_platform_cut DECIMAL := 0;
v_confirmed_pax_count INTEGER := 0;
BEGIN -- Bloqueo y obtener datos
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride.driver_id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
IF v_ride.driver_id != v_driver_id THEN RAISE EXCEPTION 'No autorizado';
END IF;
IF v_ride.status = 'cancelled' THEN RAISE EXCEPTION 'El viaje ya está cancelado';
END IF;
-- Calcular penalización según urgencia
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_ride.departure_time - NOW())
) / 3600;
IF v_hours_until_departure < 2 THEN v_driver_penalty := 5.00;
ELSIF v_hours_until_departure < 24 THEN v_driver_penalty := 2.00;
END IF;
-- Contar pasajeros confirmados para compensación
SELECT COUNT(*) INTO v_confirmed_pax_count
FROM jsonb_array_elements(v_ride.passengers) p
WHERE p->>'status' = 'confirmed';
-- Aplicar penalización al conductor
IF v_driver_penalty > 0 THEN
UPDATE public.wallets
SET balance = balance - v_driver_penalty
WHERE user_id = v_driver_id;
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
        - v_driver_penalty,
        'cancellation_fee',
        'Penalización por cancelación tardía',
        p_ride_id
    );
-- Reparto de la penalización
IF v_confirmed_pax_count > 0 THEN v_pax_compensation := ROUND(
    (v_driver_penalty * 0.50) / v_confirmed_pax_count,
    2
);
v_platform_cut := v_driver_penalty - (v_pax_compensation * v_confirmed_pax_count);
ELSE v_platform_cut := v_driver_penalty;
END IF;
-- Enviar a Tesorería
IF v_platform_cut > 0 THEN
UPDATE public.wallets
SET balance = balance + v_platform_cut
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
        v_platform_cut,
        'platform_fee',
        'Recaudación por cancelación de conductor',
        p_ride_id
    );
END IF;
END IF;
-- Procesar reembolsos y compensaciones a pasajeros
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP v_passenger_id := (v_passenger->>'id')::UUID;
v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
IF (v_passenger->>'status') IN ('confirmed', 'verified', 'confirmed_by_pin') THEN -- Reembolso del 100% + Compensación
UPDATE public.wallets
SET balance = balance + v_booked_price + v_pax_compensation,
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
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
        v_booked_price + v_pax_compensation,
        'refund',
        'Reembolso + Compensación por cancelación del conductor',
        p_ride_id
    );
PERFORM public.create_notification(
    v_passenger_id,
    '⚠️ Viaje Cancelado por Conductor',
    'El conductor ha cancelado el viaje. Se te ha reembolsado el 100% más ' || v_pax_compensation || '€ de compensación.',
    'warning',
    jsonb_build_object('ride_id', p_ride_id)
);
END IF;
END LOOP;
-- Actualizar Viaje
UPDATE public.rides
SET status = 'cancelled',
    cancelled_at = NOW(),
    passengers = (
        SELECT jsonb_agg(jsonb_set(p, '{status}', '"cancelled"'))
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'penalty_applied',
    v_driver_penalty
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(
    p_ride_id UUID,
    p_stripe_refunded DECIMAL DEFAULT 0
) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_ride RECORD;
v_pax JSONB;
v_booked_price DECIMAL;
v_booked_at TIMESTAMPTZ;
v_hours_until_departure FLOAT;
v_refund_amount DECIMAL;
v_penalty_amount DECIMAL;
v_driver_comp DECIMAL;
v_platform_comp DECIMAL;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
-- Encontrar al pasajero en el array
SELECT p INTO v_pax
FROM jsonb_array_elements(v_ride.passengers) p
WHERE (p->>'id')::UUID = v_passenger_id
    AND p->>'status' IN ('confirmed', 'verified', 'confirmed_by_pin')
LIMIT 1;
IF v_pax IS NULL THEN RAISE EXCEPTION 'No tienes una reserva confirmada en este viaje';
END IF;
v_booked_price := (v_pax->>'booked_price')::DECIMAL;
v_booked_at := (v_pax->>'booked_at')::TIMESTAMPTZ;
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_ride.departure_time - NOW())
) / 3600;
-- Lógica de Reembolso personalizada
IF v_hours_until_departure > 24
OR (
    EXTRACT(
        EPOCH
        FROM (NOW() - v_booked_at)
    ) / 60 <= 15
    AND v_hours_until_departure > 3
) THEN v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure >= 2 THEN v_refund_amount := ROUND(v_booked_price * 0.5, 2);
ELSE v_refund_amount := 0;
END IF;
v_penalty_amount := v_booked_price - v_refund_amount;
-- 1. Devolución al Pasajero
-- Si se procesó un reembolso por Stripe, no lo volvemos a meter en el wallet (evitamos doble devolución)
DECLARE 
    v_wallet_refund DECIMAL := GREATEST(0, v_refund_amount - p_stripe_refunded);
BEGIN
    UPDATE public.wallets
    SET balance = balance + v_wallet_refund,
        held_balance = held_balance - v_booked_price
    WHERE user_id = v_passenger_id;
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
        v_wallet_refund,
        'refund',
        'Reembolso por cancelación (Wallet)',
        p_ride_id
    );
END;
-- 2. Reparto de penalización (80% Conductor, 20% Plataforma)
IF v_penalty_amount > 0 THEN v_driver_comp := ROUND(v_penalty_amount * 0.8, 2);
v_platform_comp := v_penalty_amount - v_driver_comp;
UPDATE public.wallets
SET balance = balance + v_driver_comp
WHERE user_id = v_ride.driver_id;
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_ride.driver_id,
        v_ride.driver_id,
        v_driver_comp,
        'cancellation_compensation',
        'Compensación: Pasajero canceló tarde',
        p_ride_id
    );
UPDATE public.wallets
SET balance = balance + v_platform_comp
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
        v_platform_comp,
        'platform_fee',
        'Gestión de cancelación (20%)',
        p_ride_id
    );
END IF;
-- 3. Liberar asiento y actualizar JSON
UPDATE public.rides
SET seats_available = seats_available + COALESCE((v_pax->>'seats_booked')::INTEGER, 1),
    participant_ids = array_remove(participant_ids, v_passenger_id),
    passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'refund',
    v_refund_amount,
    'penalty',
    v_penalty_amount
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;