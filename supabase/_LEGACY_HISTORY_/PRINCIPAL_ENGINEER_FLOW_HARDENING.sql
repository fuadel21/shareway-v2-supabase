-- ==========================================
-- 0. EXTENSIÓN DE ESQUEMA (Paranoia Fixes)
-- ==========================================
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rides'
        AND column_name = 'waypoints'
) THEN
ALTER TABLE public.rides
ADD COLUMN waypoints JSONB DEFAULT '[]'::jsonb;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rides'
        AND column_name = 'preferences'
) THEN
ALTER TABLE public.rides
ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb;
END IF;
END $$;
-- 1. CREACIÓN DE VIAJE (create_ride)
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
DECLARE v_driver_id UUID;
v_driver_name TEXT;
v_driver_photo TEXT;
v_is_suspended BOOLEAN;
v_is_verified TEXT;
v_ride_id UUID;
v_price_per_km DECIMAL;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Validaciones de Perfil (Fallo 4 y 9)
SELECT display_name,
    photo_url,
    is_suspended,
    (verification->>'status') INTO v_driver_name,
    v_driver_photo,
    v_is_suspended,
    v_is_verified
FROM public.profiles
WHERE id = v_driver_id;
IF v_is_suspended THEN RAISE EXCEPTION 'Tu cuenta está suspendida. Contacta con soporte.';
END IF;

-- VERIFICACIÓN DESHABILITADA TEMPORALMENTE PARA PRUEBAS
-- IF v_is_verified != 'verified' THEN RAISE EXCEPTION 'Solo usuarios verificados pueden ofrecer viajes.';
-- END IF;

-- Validaciones de Ruta (Fallo 8)
IF (p_origin->>'lat')::DECIMAL = (p_destination->>'lat')::DECIMAL
AND (p_origin->>'lng')::DECIMAL = (p_destination->>'lng')::DECIMAL THEN RAISE EXCEPTION 'El origen y el destino no pueden ser el mismo lugar.';
END IF;
-- Validación de Precio Blindada (Fallo 3)
IF p_distance > 0 THEN v_price_per_km := p_price / p_distance;
IF v_price_per_km > 0.60 THEN RAISE EXCEPTION 'El precio supera el límite permitido de 0.60€/km por el Ministerio de Transportes.';
END IF;
END IF;
-- Validaciones Básicas
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'Fecha de salida en el pasado.';
END IF;
IF p_price < 0.5
OR p_price > 200 THEN RAISE EXCEPTION 'Precio fuera de rango (0.5€ - 200€).';
END IF;
IF p_seats < 1
OR p_seats > 8 THEN RAISE EXCEPTION 'Asientos fuera de rango (1-8).';
END IF;
-- Evitar Overlap
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
) THEN RAISE EXCEPTION 'Ya tienes un viaje cerca de esa hora (±2h).';
END IF;
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        bounds,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        participant_ids,
        approval_mode,
        waypoints,
        preferences
    )
VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        ARRAY [v_driver_id],
        p_approval_mode,
        p_waypoints,
        p_preferences
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. CREACIÓN DE SOLICITUD (create_ride_request)
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_request_id UUID;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'Fecha en el pasado.';
END IF;
INSERT INTO public.ride_requests (
        requester_id,
        origin,
        destination,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only
    )
VALUES (
        v_requester_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only
    )
RETURNING id INTO v_request_id;
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_request_id UUID;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'Fecha en el pasado.';
END IF;
INSERT INTO public.ride_requests (
        requester_id,
        origin,
        destination,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only
    )
VALUES (
        v_requester_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only
    )
RETURNING id INTO v_request_id;
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. UNIFICACIÓN Y BLINDAJE DE RESERVA (confirm_trip_and_pay)
-- Soporta aprobación automática y manual (escrow) con prevención de overbooking.
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_passenger_gender TEXT;
v_ride_price DECIMAL;
v_seats_available INTEGER;
v_driver_id UUID;
v_is_women_only BOOLEAN;
v_approval_mode TEXT;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_new_passenger JSONB;
v_participant_ids UUID [];
v_booking_status TEXT;
v_departure_time TIMESTAMPTZ;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Info Pasajero
SELECT display_name,
    photo_url,
    gender INTO v_passenger_name,
    v_passenger_photo,
    v_passenger_gender
FROM public.profiles
WHERE id = v_passenger_id;
-- Bloqueo de Concurrencia (FOR UPDATE)
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    is_women_only,
    approval_mode,
    departure_time INTO v_ride_price,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_is_women_only,
    v_approval_mode,
    v_departure_time
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'El viaje no está disponible.';
END IF;
IF v_departure_time <= NOW() THEN RAISE EXCEPTION 'El viaje ya ha salido.';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan asientos disponibles.';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje.';
END IF;
-- BLINDAJE (Fallo 6): Evitar solapamientos para el PASAJERO
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE participant_ids @> ARRAY [v_passenger_id]
        AND status IN ('scheduled', 'active')
        AND ABS(
            EXTRACT(
                EPOCH
                FROM (departure_time - v_departure_time)
            )
        ) < 3600 -- ±1h de margen
        AND id != p_ride_id
) THEN RAISE EXCEPTION 'Ya tienes otro viaje confirmado o solicitado en un horario similar.';
END IF;
-- BLINDAJE (Fallo 1): Limitar solicitudes pendientes para evitar "Ghost Passengers" masivos
IF v_approval_mode = 'manual'
AND (
    SELECT count(*)
    FROM jsonb_array_elements(passengers) p
    WHERE p->>'status' = 'pending'
) >= (v_seats_available * 2) THEN RAISE EXCEPTION 'Este viaje tiene demasiadas solicitudes pendientes. Inténtalo más tarde.';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una plaza confirmada o solicitud en este viaje.';
END IF;
-- Validación Género
IF v_is_women_only
AND (
    v_passenger_gender IS NULL
    OR v_passenger_gender != 'female'
) THEN RAISE EXCEPTION 'Exclusivo para mujeres.';
END IF;
-- Verificación Financiera
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente.';
END IF;
-- Lógica de Aprobación
v_booking_status := CASE
    WHEN v_approval_mode = 'manual' THEN 'pending'
    ELSE 'confirmed'
END;
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
v_new_passenger := json_build_object(
    'id',
    v_passenger_id,
    'display_name',
    v_passenger_name,
    'photo_url',
    v_passenger_photo,
    'status',
    v_booking_status,
    'pin',
    v_ride_pin,
    'booked_price',
    v_ride_price,
    'booked_at',
    NOW()
)::JSONB;
-- Escrow (Retención de Fondos)
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
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
    - v_ride_price,
    balance,
    CASE
        WHEN v_booking_status = 'confirmed' THEN 'Reserva de plaza (Confirmada)'
        ELSE 'Solicitud de plaza (Pago en garantía)'
    END,
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- Actualizar Ride
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = CASE
        WHEN v_booking_status = 'confirmed' THEN seats_available - 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
-- Cerrar solicitud externa si existe
IF p_request_id IS NOT NULL THEN
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = p_request_id
    AND requester_id = v_passenger_id;
END IF;
RETURN json_build_object(
    'success',
    true,
    'status',
    v_booking_status,
    'pin',
    v_ride_pin
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. ACEPTACIÓN ROBUSTA CON AUTO-REJECT (accept_passenger)
-- Cuando el conductor acepta y se llena el viaje, rechazamos automáticamente a los demás para liberar su dinero.
CREATE OR REPLACE FUNCTION public.accept_passenger(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_seats_available INTEGER;
v_passengers JSONB;
v_new_passengers JSONB;
v_was_found BOOLEAN := false;
v_other_pending RECORD;
BEGIN v_driver_id := auth.uid();
SELECT seats_available,
    passengers INTO v_seats_available,
    v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_seats_available IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado.';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No hay plazas libres.';
END IF;
-- Verificar que el pasajero existe y está pendiente
IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_passengers) p
    WHERE (p->>'id')::UUID = p_passenger_id
        AND p->>'status' = 'pending'
) THEN RAISE EXCEPTION 'Solicitud no encontrada o ya procesada.';
END IF;
-- 1. Aceptar al pasajero seleccionado
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = p_passenger_id
            AND p->>'status' = 'pending' THEN jsonb_set(p, '{status}', '"confirmed"')
            ELSE p
        END
    ) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) AS p;
v_seats_available := v_seats_available - 1;
-- 2. AUTO-REJECT si el viaje se ha llenado
IF v_seats_available = 0 THEN FOR v_other_pending IN
SELECT (p->>'id')::UUID as pid,
    (p->>'booked_price')::DECIMAL as price
FROM jsonb_array_elements(v_new_passengers) p
WHERE p->>'status' = 'pending' LOOP -- Devolver dinero
UPDATE public.wallets
SET balance = balance + v_other_pending.price,
    held_balance = held_balance - v_other_pending.price
WHERE user_id = v_other_pending.pid;
-- Registrar transacción
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
    'refund',
    v_other_pending.price,
    balance,
    'Viaje completado por otros pasajeros (Reembolso automático)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_other_pending.pid;
-- Notificar
PERFORM public.create_notification(
    v_other_pending.pid,
    'Plaza No Disponible',
    'El viaje se ha llenado. Se ha reembolsado tu pago en garantía.',
    'info',
    jsonb_build_object('ride_id', p_ride_id)
);
-- Marcar como rechazado en el JSON final
v_new_passengers := (
    SELECT jsonb_agg(
            CASE
                WHEN (p->>'id')::UUID = v_other_pending.pid THEN jsonb_set(p, '{status}', '"rejected"')
                ELSE p
            END
        )
    FROM jsonb_array_elements(v_new_passengers) p
);
END LOOP;
END IF;
UPDATE public.rides
SET passengers = v_new_passengers,
    seats_available = v_seats_available
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'message', 'Pasajero aceptado.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. RECHAZO DE PASAJERO (reject_passenger)
-- El conductor rechaza una solicitud pendiente. Se reembolsa el 100%.
CREATE OR REPLACE FUNCTION public.reject_passenger(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_passengers JSONB;
v_new_passengers JSONB;
v_booked_price DECIMAL;
BEGIN v_driver_id := auth.uid();
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado.';
END IF;
-- Devolver dinero al pasajero
SELECT (p->>'booked_price')::DECIMAL INTO v_booked_price
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'id')::UUID = p_passenger_id
    AND p->>'status' = 'pending';
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'Solicitud pendiente no encontrada.';
END IF;
UPDATE public.wallets
SET balance = balance + v_booked_price,
    held_balance = held_balance - v_booked_price
WHERE user_id = p_passenger_id;
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
    'refund',
    v_booked_price,
    balance,
    'Solicitud rechazada por el conductor (Reembolso íntegro)',
    p_ride_id
FROM public.wallets
WHERE user_id = p_passenger_id;
-- Actualizar JSON
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"rejected"')
            ELSE p
        END
    ) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) p;
UPDATE public.rides
SET passengers = v_new_passengers,
    participant_ids = array_remove(participant_ids, p_passenger_id)
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Solicitud rechazada y fondos devueltos.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. CANCELACIÓN JUSTA (cancel_booking_and_refund)
-- Permite cancelar tanto 'confirmed' como 'pending', con reembolso 100% para pendientes.
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_booked_price DECIMAL;
v_status TEXT;
v_departure_time TIMESTAMPTZ;
v_passengers JSONB;
v_new_passengers JSONB;
v_refund_amount DECIMAL;
v_refund_percentage INTEGER;
v_hours_until_departure FLOAT;
v_driver_id UUID;
v_penalty_amount DECIMAL;
v_booked_at TIMESTAMPTZ;
BEGIN v_passenger_id := auth.uid();
SELECT driver_id,
    departure_time,
    passengers,
    status INTO v_driver_id,
    v_departure_time,
    v_passengers,
    v_status
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje ya no está disponible para cancelación.';
END IF;
-- Buscar info de la plaza
SELECT (p->>'booked_price')::DECIMAL,
    (p->>'status'),
    (p->>'booked_at')::TIMESTAMPTZ INTO v_booked_price,
    v_status,
    v_booked_at
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'id')::UUID = v_passenger_id;
IF v_booked_price IS NULL
OR v_status IN ('cancelled', 'rejected') THEN RAISE EXCEPTION 'No tienes una reserva activa.';
END IF;
-- Lógica de Reembolso
IF v_status = 'pending' THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSE -- Lógica de tiempo para confirmados
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_departure_time - NOW())
) / 3600;
IF v_hours_until_departure > 24
OR (
    EXTRACT(
        EPOCH
        FROM (NOW() - v_booked_at)
    ) / 60 <= 15
    AND v_hours_until_departure > 3
) THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure >= 2 THEN v_refund_percentage := 50;
v_refund_amount := ROUND(v_booked_price * 0.5, 2);
ELSE v_refund_percentage := 0;
v_refund_amount := 0;
END IF;
END IF;
v_penalty_amount := v_booked_price - v_refund_amount;
-- Actualizar JSON
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
            ELSE p
        END
    ) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) p;
-- Devoluciones y Penalizaciones
UPDATE public.wallets
SET balance = balance + v_refund_amount,
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
IF v_penalty_amount > 0 THEN
UPDATE public.wallets
SET balance = balance + ROUND(v_penalty_amount * 0.8, 2)
WHERE user_id = v_driver_id;
END IF;
UPDATE public.rides
SET passengers = v_new_passengers,
    participant_ids = array_remove(participant_ids, v_passenger_id),
    seats_available = CASE
        WHEN v_status = 'confirmed' THEN seats_available + 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'refundPercentage',
    v_refund_percentage,
    'refundAmount',
    v_refund_amount
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 7. CANCELACIÓN DE VIAJE POR CONDUCTOR (cancel_ride - Fallo 4)
-- El conductor desiste. Reembolso INTEGRAL a todos los pasajeros (confirmed y pending).
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_passenger RECORD;
v_passengers JSONB;
BEGIN v_driver_id := auth.uid();
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado o no eres el conductor.';
END IF;
-- Iterar y reembolsar a cada uno
FOR v_passenger IN
SELECT (p->>'id')::UUID as pid,
    (p->>'booked_price')::DECIMAL as price,
    (p->>'status') as stat
FROM jsonb_array_elements(v_passengers) p
WHERE p->>'status' IN ('confirmed', 'pending') LOOP
UPDATE public.wallets
SET balance = balance + v_passenger.price,
    held_balance = held_balance - v_passenger.price
WHERE user_id = v_passenger.pid;
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
    'refund',
    v_passenger.price,
    balance,
    'Viaje cancelado por el conductor (Reembolso TOTAL)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger.pid;
END LOOP;
UPDATE public.rides
SET status = 'cancelled',
    passengers = (
        SELECT jsonb_agg(jsonb_set(p, '{status}', '"cancelled"'))
        FROM jsonb_array_elements(v_passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Viaje cancelado y todos los pasajeros reembolsados.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 8. INICIO Y FIN DE TRAYECTO (start_ride / complete_ride - Fallo 3)
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
BEGIN v_driver_id := auth.uid();
UPDATE public.rides
SET status = 'active'
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled';
IF NOT FOUND THEN RAISE EXCEPTION 'No se puede iniciar el viaje (estado inválido o no eres el dueño).';
END IF;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_passenger RECORD;
v_passengers JSONB;
v_total_payout DECIMAL := 0;
BEGIN v_driver_id := auth.uid();
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'active' FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'Viaje no activo o no autorizado.';
END IF;
-- Traspasar fondos del escrow al conductor para los confirmados/verificados Y no-shows
FOR v_passenger IN
SELECT (p->>'id')::UUID as pid,
    (p->>'booked_price')::DECIMAL as price
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'status') IN (
        'confirmed',
        'verified',
        'confirmed_by_pin',
        'no_show'
    ) LOOP -- Quitar del held_balance del pasajero
UPDATE public.wallets
SET held_balance = held_balance - v_passenger.price
WHERE user_id = v_passenger.pid;
v_total_payout := v_total_payout + v_passenger.price;
END LOOP;
-- Pago al conductor
UPDATE public.wallets
SET balance = balance + v_total_payout
WHERE user_id = v_driver_id;
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
    'payout',
    v_total_payout,
    balance,
    'Pago recibido por viaje completado',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
UPDATE public.rides
SET status = 'completed'
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 9. SEGURIDAD DE PINS (get_ride_details_secure / get_my_ride_pin)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_ride_data RECORD;
v_viewer_id UUID := auth.uid();
BEGIN
SELECT r.*,
    p.full_name as driver_name,
    p.photo_url as driver_photo,
    (
        SELECT jsonb_agg(
                jsonb_set(pax, '{pin}', '"****"') -- Ocultar PINs por defecto
            )
        FROM jsonb_array_elements(r.passengers) pax
    ) as safe_passengers INTO v_ride_data
FROM public.rides r
    LEFT JOIN public.profiles p ON r.driver_id = p.id
WHERE r.id = p_ride_id;
IF v_ride_data IS NULL THEN RETURN json_build_object('success', false, 'error', 'No encontrado');
END IF;
RETURN json_build_object(
    'success',
    true,
    'data',
    row_to_json(v_ride_data)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_pin TEXT;
BEGIN
SELECT p->>'pin' INTO v_pin
FROM public.rides,
    jsonb_array_elements(passengers) p
WHERE id = p_ride_id
    AND (p->>'id')::UUID = v_user_id
    AND p->>'status' IN ('confirmed', 'pending');
IF v_pin IS NULL THEN RETURN json_build_object('success', false, 'error', 'PIN no disponible');
END IF;
RETURN json_build_object('success', true, 'data', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 10. VERIFICACIÓN Y GESTIÓN DE PASAJEROS (verify_passenger / handle_passenger_no_show / remove_passenger)
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
v_match BOOLEAN := false;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No autorizado o viaje inexistente.';
END IF;
-- Validar PIN y actualizar
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = p_passenger_id
            AND p->>'pin' = p_pin THEN (
                (v_match := true) IS NOT NULL
                AND jsonb_set(p, '{status}', '"verified"')
            )
            ELSE p
        END
    ) INTO v_passengers
FROM jsonb_array_elements(v_passengers) p;
IF NOT v_match THEN RAISE EXCEPTION 'PIN incorrecto.';
END IF;
UPDATE public.rides
SET passengers = v_passengers
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'Solo puedes marcar No-Show en viajes programados.';
END IF;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"no_show"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(v_passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Pasajero marcado como No-Show. Recibirás el pago al completar el viaje.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.remove_passenger(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
v_price DECIMAL;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No autorizado.';
END IF;
-- Reembolso al pasajero
SELECT (p->>'booked_price')::DECIMAL INTO v_price
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'id')::UUID = p_passenger_id
    AND p->>'status' = 'confirmed';
IF v_price IS NULL THEN RAISE EXCEPTION 'Pasajero no confirmado.';
END IF;
UPDATE public.wallets
SET balance = balance + v_price,
    held_balance = held_balance - v_price
WHERE user_id = p_passenger_id;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"removed"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(v_passengers) p
    ),
    participant_ids = array_remove(participant_ids, p_passenger_id),
    seats_available = seats_available + 1
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Pasajero eliminado y reembolsado.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.confirm_passenger_arrival(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_passengers JSONB;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_user_id THEN jsonb_set(p, '{arrived}', 'true')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(v_passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 11. ATOMICIDAD: FULFILL RIDE REQUEST (Aceptar solicitud pública creando viaje)
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
DECLARE v_driver_id UUID;
v_ride_id UUID;
v_res JSON;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Crear el viaje (usando create_ride internamente para heredar validaciones)
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
        -- bounds
        FALSE,
        -- women only (se hereda del request si se desea, por ahora manual)
        FALSE,
        -- exclusive community
        '{}',
        -- allowed communities
        'automatic',
        -- approval mode
        p_waypoints,
        '{}' -- preferences
    ) INTO v_res;
IF NOT (v_res->>'success')::BOOLEAN THEN RETURN v_res;
END IF;
v_ride_id := (v_res->>'rideId')::UUID;
-- 2. Vincular y cerrar la solicitud
UPDATE public.ride_requests
SET status = 'fulfilled',
    matched_ride_id = v_ride_id
WHERE id = p_request_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;