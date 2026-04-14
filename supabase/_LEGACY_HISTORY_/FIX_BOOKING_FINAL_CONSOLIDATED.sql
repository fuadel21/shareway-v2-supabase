-- ==========================================
-- FIX_BOOKING_FINAL_CONSOLIDATED.sql
-- Versión: 3.2 (Atomic & Validated)
-- Repara: Nombres de tablas y parámetros de reserva
-- ==========================================

-- 1. Eliminar versiones anteriores para evitar conflictos de firma
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, jsonb, text, decimal);

-- 2. Crear la función definitiva con 5 parámetros
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
v_wallet_id UUID;
BEGIN 
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;

-- 1. Bloqueo de WALLET (Evita race conditions de saldo)
SELECT id, balance INTO v_wallet_id, v_current_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR UPDATE;

IF v_current_balance IS NULL THEN RAISE EXCEPTION 'Wallet no inicializada';
END IF;

-- 2. Bloqueo de VIAJE (Evita overbooking)
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    status INTO v_price_per_seat,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_ride_status
FROM public.rides
WHERE id = p_ride_id FOR UPDATE;

IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;

IF v_ride_status NOT IN ('scheduled', 'active', 'in_progress') THEN 
    RAISE EXCEPTION 'El viaje ya no acepta reservas (Estado: %)', v_ride_status;
END IF;

-- 3. Info de perfil del pasajero
SELECT display_name, photo_url INTO v_passenger_name, v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;

-- 4. AJUSTE DE PRECIO (Si el frontend envía uno por desvío calculado)
IF p_price IS NOT NULL AND p_price > 0 THEN 
    v_price_per_seat := p_price;
END IF;

-- 5. Calcular asientos requeridos (Si viene de una solicitud previa)
IF p_request_id IS NOT NULL THEN
    SELECT seats_needed INTO v_seats_to_book
    FROM public.ride_requests
    WHERE id = p_request_id;
END IF;

v_seats_to_book := COALESCE(v_seats_to_book, 1);

-- 6. VALIDACIONES FINALES
IF v_seats_available < v_seats_to_book THEN 
    RAISE EXCEPTION 'SIN_PLAZAS_LIBRES: Disponibles %, Pedidas %', v_seats_available, v_seats_to_book;
END IF;

IF v_passenger_id = v_driver_id THEN 
    RAISE EXCEPTION 'PROPIO_VIAJE: No puedes reservar en tu propio trayecto.';
END IF;

IF v_passenger_id = ANY(v_participant_ids) THEN 
    RAISE EXCEPTION 'ALREADY_BOOKED: Ya tienes una reserva activa.';
END IF;

-- 7. CÁLCULO TOTAL Y PAGO
v_total_price := v_price_per_seat * v_seats_to_book;

IF v_current_balance < v_total_price THEN 
    RAISE EXCEPTION 'SALDO_INSUFICIENTE: Tienes %€, necesitas %€', v_current_balance, v_total_price;
END IF;

-- Mover dinero a retención (Held)
UPDATE public.wallets
SET balance = balance - v_total_price,
    held_balance = held_balance + v_total_price,
    updated_at = NOW()
WHERE user_id = v_passenger_id;

-- Registrar transacción (IMPORTANTE: Nombre de tabla 'transactions' según schema.sql)
INSERT INTO public.transactions (
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
        v_passenger_id, -- En este esquema wallet_id es el id de la wallet (FK a profiles.id)
        - v_total_price,
        v_current_balance - v_total_price,
        'hold',
        'Reserva de plaza ' || CASE WHEN p_price IS NOT NULL THEN '(Precio dinámico)' ELSE '' END,
        p_ride_id
    );

-- 8. GENERACIÓN DE PIN Y REGISTRO DE PASAJERO
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

v_new_passenger := jsonb_build_object(
    'id', v_passenger_id,
    'displayName', v_passenger_name,
    'photoURL', v_passenger_photo,
    'status', 'confirmed',
    'pin', v_ride_pin,
    'booked_price', v_total_price,
    'seats_booked', v_seats_to_book,
    'booked_at', NOW(),
    'pickup_location', p_pickup_location,
    'pickup_address', p_pickup_address
);

-- Actualizar asientos y lista de participantes
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - v_seats_to_book
WHERE id = p_ride_id;

-- Cerrar solicitud si existía
IF p_request_id IS NOT NULL THEN
    UPDATE public.ride_requests
    SET status = 'fulfilled'
    WHERE id = p_request_id;
END IF;

-- Notificar éxito (vía tabla de notificaciones)
PERFORM public.create_notification(
    v_driver_id,
    '¡Nueva reserva!',
    'Un pasajero ha reservado asiento en tu viaje.',
    'match',
    jsonb_build_object('ride_id', p_ride_id, 'passenger_name', v_passenger_name)
);

RETURN json_build_object(
    'success', true,
    'pin', v_ride_pin,
    'final_price', v_total_price
);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
