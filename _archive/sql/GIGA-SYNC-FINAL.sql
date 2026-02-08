-- ==========================================
-- GIGA-SYNC-FINAL: TOTAL RESILIENCE UPGRADE
-- ==========================================
-- Versión: 3.0.7 (Chaos Resilience)
-- Propósito: Blindar la lógica de reserva contra ataques de concurrencia y latencia.
-- ==========================================
-- 1. LIMPIEZA DINÁMICA
DO $$
DECLARE r RECORD;
BEGIN FOR r IN (
    SELECT oid::regprocedure as name
    FROM pg_proc
    WHERE proname IN (
            'confirm_trip_and_pay',
            'accept_passenger',
            'reject_passenger'
        )
) LOOP EXECUTE 'DROP FUNCTION ' || r.name || ' CASCADE';
END LOOP;
END $$;
-- 2. CONFIRM TRIP AND PAY (ELITE VERSION)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_participant_ids UUID [];
v_departure_time TIMESTAMPTZ;
v_booking_status TEXT;
v_approval_mode TEXT;
v_wallet_balance DECIMAL;
v_passenger_name TEXT;
v_passenger_photo TEXT;
BEGIN IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- BLOQUEO CRÍTICO: FOR UPDATE garantiza que nadie más toque este viaje mientras procesamos
SELECT price,
    seats_available,
    participant_ids,
    departure_time,
    approval_mode INTO v_ride_price,
    v_seats_available,
    v_participant_ids,
    v_departure_time,
    v_approval_mode
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'Viaje no disponible.';
END IF;
IF v_seats_available <= 0
AND v_approval_mode = 'automatic' THEN RAISE EXCEPTION 'No quedan asientos.';
END IF;
-- PREVENCIÓN DE DOBLE RESERVA (Race condition shield)
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una plaza confirmada o solicitud en este viaje.';
END IF;
-- VERIFICACIÓN FINANCIERA
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.';
END IF;
v_booking_status := CASE
    WHEN v_approval_mode = 'manual' THEN 'pending'
    ELSE 'confirmed'
END;
-- Datos del perfil
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
-- PROCESAR PAGO (Escrow)
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
WHERE user_id = v_passenger_id;
-- REGISTRAR TRANSACCIÓN
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
        'Escrow para viaje ShareWay',
        p_ride_id
    );
-- ACTUALIZAR RIDE
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::jsonb) || jsonb_build_object(
        'id',
        v_passenger_id,
        'display_name',
        v_passenger_name,
        'photo_url',
        v_passenger_photo,
        'status',
        v_booking_status,
        'booked_at',
        NOW(),
        'booked_price',
        v_ride_price,
        'pin',
        LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0')
    ),
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = CASE
        WHEN v_booking_status = 'confirmed' THEN seats_available - 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'status', v_booking_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. PERMISOS
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay TO authenticated;