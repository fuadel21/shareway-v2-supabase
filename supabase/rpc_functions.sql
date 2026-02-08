-- ==========================================
-- RPC FUNCTIONS PARA SUPABASE
-- Reemplazan las Firebase Cloud Functions
-- ==========================================
-- ==========================================
-- FUNCIÓN: create_payout_request
-- Solicitar retiro de fondos (conductor)
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_payout_request(p_amount DECIMAL) RETURNS JSON AS $$
DECLARE v_user_id UUID;
v_current_balance DECIMAL;
v_payout_id UUID;
BEGIN v_user_id := auth.uid();
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Verificar balance disponible
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_user_id FOR
UPDATE;
IF v_current_balance IS NULL
OR v_current_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente para el retiro.';
END IF;
IF p_amount < 5 THEN RAISE EXCEPTION 'El monto mínimo de retiro es de 5€.';
END IF;
-- 2. Restar del balance principal
UPDATE public.wallets
SET balance = balance - p_amount,
    updated_at = NOW()
WHERE user_id = v_user_id;
-- 3. Crear solicitud de pago
INSERT INTO public.payout_requests (user_id, amount, status)
VALUES (v_user_id, p_amount, 'pending')
RETURNING id INTO v_payout_id;
-- 4. Registrar transacción
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        amount,
        balance_after,
        type,
        description
    )
SELECT id,
    user_id,
    - p_amount,
    balance,
    'payout',
    'Retiro de fondos solicitado'
FROM public.wallets
WHERE user_id = v_user_id;
RETURN json_build_object(
    'success',
    true,
    'payoutId',
    v_payout_id,
    'message',
    'Solicitud de retiro creada con éxito'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: cancel_pending_booking
-- El pasajero cancela su solicitud pendiente en un viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.cancel_pending_booking(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_passengers JSONB;
v_new_passengers JSONB;
v_booked_price DECIMAL;
v_found BOOLEAN := false;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado o no disponible';
END IF;
SELECT (p->>'booked_price')::DECIMAL INTO v_booked_price
FROM jsonb_array_elements(v_passengers) AS p
WHERE (p->>'id')::UUID = v_passenger_id
    AND p->>'status' = 'pending';
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'No tienes una solicitud pendiente en este viaje';
END IF;
UPDATE public.wallets
SET balance = balance + v_booked_price,
    held_balance = held_balance - v_booked_price
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
    'refund',
    v_booked_price,
    balance,
    'Cancelación de solicitud pendiente por el pasajero',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
v_found := true;
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = v_passenger_id
            AND p->>'status' = 'pending' THEN jsonb_set(p, '{status}', '"cancelled"')
            ELSE p
        END
    ) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) AS p;
IF NOT v_found THEN RAISE EXCEPTION 'No se encontró la solicitud pendiente para cancelar';
END IF;
UPDATE public.rides
SET passengers = COALESCE(v_new_passengers, '[]'::JSONB),
    participant_ids = array_remove(participant_ids, v_passenger_id)
WHERE id = p_ride_id;
PERFORM public.create_notification(
    v_passenger_id,
    'Solicitud cancelada',
    'Has cancelado tu solicitud pendiente. Se ha reembolsado el importe retenido.',
    'info',
    jsonb_build_object('ride_id', p_ride_id)
);
RETURN json_build_object(
    'success',
    true,
    'message',
    'Solicitud pendiente cancelada y reembolso realizado'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.accept_request(p_request_id UUID, p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_seats_available INTEGER;
v_req_seats INTEGER;
v_ride_status TEXT;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT driver_id,
    seats_available,
    status INTO v_ride_driver,
    v_seats_available,
    v_ride_status
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'No autorizado';
END IF;
IF v_ride_status IS NULL
OR v_ride_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje no está disponible';
END IF;
IF v_seats_available IS NULL
OR v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan asientos disponibles';
END IF;
SELECT seats_needed INTO v_req_seats
FROM public.ride_requests
WHERE id = p_request_id
    AND status = 'pending' FOR
UPDATE;
IF v_req_seats IS NULL
OR v_req_seats < 1 THEN RAISE EXCEPTION 'Solicitud inválida';
END IF;
IF v_req_seats > v_seats_available THEN RAISE EXCEPTION 'No hay suficientes asientos';
END IF;
UPDATE public.ride_requests
SET status = 'accepted',
    matched_ride_id = p_ride_id,
    payment_expires_at = NOW() + INTERVAL '10 minutes'
WHERE id = p_request_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: process_payout
-- Procesar (Aprobar/Rechazar) un retiro de fondos
-- Solo para administradores.
-- ==========================================
CREATE OR REPLACE FUNCTION public.process_payout(
        p_payout_id UUID,
        p_status TEXT,
        p_stripe_transfer_id TEXT DEFAULT NULL,
        p_error_message TEXT DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_user_id UUID;
v_amount DECIMAL;
BEGIN -- 1. Verificar rol de admin
IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
        AND (
            role = 'admin'
            OR is_admin = true
        )
) THEN RAISE EXCEPTION 'Acceso denegado. Se requiere rol de administrador.';
END IF;
-- 2. Obtener datos de la solicitud
SELECT user_id,
    amount INTO v_user_id,
    v_amount
FROM public.payout_requests
WHERE id = p_payout_id;
IF v_user_id IS NULL THEN RAISE EXCEPTION 'Solicitud de retiro no encontrada.';
END IF;
-- 3. Actualizar estado
UPDATE public.payout_requests
SET status = p_status,
    stripe_transfer_id = p_stripe_transfer_id,
    error_message = p_error_message,
    updated_at = NOW()
WHERE id = p_payout_id;
-- 4. Si es rechazado, devolver el dinero a la wallet
IF p_status = 'rejected' THEN
UPDATE public.wallets
SET balance = balance + v_amount,
    updated_at = NOW()
WHERE user_id = v_user_id;
-- Registrar reembolso
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        amount,
        balance_after,
        type,
        description,
        related_ride_id
    )
SELECT id,
    user_id,
    v_amount,
    balance,
    'payout_refund',
    'Reembolso por retiro rechazado: ' || COALESCE(p_error_message, 'Sin motivo especificado'),
    NULL
FROM public.wallets
WHERE user_id = v_user_id;
-- Notificar al usuario
PERFORM public.create_notification(
    v_user_id,
    'Retiro Rechazado',
    'Tu solicitud de retiro de ' || v_amount || '€ ha sido rechazada y los fondos devueltos a tu saldo.',
    'warning',
    jsonb_build_object('payout_id', p_payout_id)
);
ELSIF p_status = 'completed' THEN -- Notificar al usuario del éxito
PERFORM public.create_notification(
    v_user_id,
    'Retiro Completado',
    '¡Buenas noticias! Tu transferencia de ' || v_amount || '€ ha sido procesada con éxito.',
    'success',
    jsonb_build_object(
        'payout_id',
        p_payout_id,
        'stripe_id',
        p_stripe_transfer_id
    )
);
END IF;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: create_ride
-- Crear un nuevo viaje (CON PARCHE DE SEGURIDAD V1)
-- ==========================================
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
        p_approval_mode TEXT DEFAULT 'automatic'
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_driver_name TEXT;
v_driver_photo TEXT;
v_ride_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
v_verification_status TEXT;
v_active_rides_count INTEGER;
BEGIN -- Obtener el ID del usuario autenticado
v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Validaciones Básicas
IF p_origin IS NULL
OR p_destination IS NULL
OR p_departure_time IS NULL
OR p_seats IS NULL
OR p_price IS NULL THEN RAISE EXCEPTION 'Faltan datos esenciales para crear el viaje';
END IF;
IF p_seats <= 0
OR p_seats > 8 THEN RAISE EXCEPTION 'Número de asientos inválido (Máx 8)';
END IF;
IF p_price < 0 THEN RAISE EXCEPTION 'Precio inválido';
END IF;
-- [SECURITY PATCH 1] Validación de Precio Máximo (0.50€/km) usando kilómetros
IF p_distance IS NOT NULL
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.50 THEN RAISE EXCEPTION 'El precio excede el máximo permitido de 0.50€/km (Política de Precio Justo)';
END IF;
END IF;
-- [SECURITY PATCH 2] Rate Limiting (Máx 10 viajes activos)
SELECT COUNT(*) INTO v_active_rides_count
FROM public.rides
WHERE driver_id = v_driver_id
    AND status = 'scheduled';
IF v_active_rides_count >= 10 THEN RAISE EXCEPTION 'Has alcanzado el límite máximo de 10 viajes activos simultáneos.';
END IF;
-- [SECURITY PATCH 3] Prevención de Solapamiento (Driver Overlap)
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status = 'scheduled'
        AND departure_time BETWEEN p_departure_time - INTERVAL '2 hours'
        AND p_departure_time + INTERVAL '2 hours'
) THEN RAISE EXCEPTION 'Ya tienes un viaje programado en un horario cercano (+/- 2h). Imposible realizar ambos.';
END IF;
-- Obtener información del conductor y su estado de verificación
SELECT display_name,
    photo_url,
    (verification->>'status') INTO v_driver_name,
    v_driver_photo,
    v_verification_status
FROM public.profiles
WHERE id = v_driver_id;
IF v_driver_name IS NULL THEN RAISE EXCEPTION 'Perfil de conductor no encontrado';
END IF;
IF FALSE THEN RAISE EXCEPTION 'Tu cuenta no está verificada. Para publicar viajes, debes completar la validación de identidad en Ajustes.';
END IF;
-- Crear puntos geográficos
v_origin_point := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_destination_point := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
-- Insertar el viaje
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_total,
        seats_available,
        price,
        initial_price,
        details,
        distance,
        overview_polyline,
        bounds,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        approval_mode,
        participant_ids
    )
VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        CASE
            WHEN p_approval_mode IN ('automatic', 'manual') THEN p_approval_mode
            ELSE 'automatic'
        END,
        ARRAY [v_driver_id]
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: create_ride_request
-- Crear una nueva solicitud de viaje (CON PARCHE DE SEGURIDAD V2)
-- ==========================================
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
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
v_request_id UUID;
v_distance_meters FLOAT;
v_active_requests_count INTEGER;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Validaciones de Entrada
IF p_origin IS NULL
OR p_destination IS NULL
OR p_departure_time IS NULL
OR p_seats_needed IS NULL THEN RAISE EXCEPTION 'Faltan datos esenciales para crear la solicitud';
END IF;
-- [SECURITY PATCH 1] Validación de Asientos (1-8)
IF p_seats_needed <= 0
OR p_seats_needed > 8 THEN RAISE EXCEPTION 'Número de asientos inválido (Máx 8)';
END IF;
-- [SECURITY PATCH 2] Rate Limiting (Máx 5 solicitudes pendientes)
SELECT COUNT(*) INTO v_active_requests_count
FROM public.ride_requests
WHERE requester_id = v_requester_id
    AND status = 'pending';
IF v_active_requests_count >= 5 THEN RAISE EXCEPTION 'Has alcanzado el límite de 5 solicitudes pendientes. Cancela alguna antes de crear nueva.';
END IF;
-- Crear puntos geográficos
v_origin_point := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_destination_point := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
-- [SECURITY PATCH 3] Validación de Precio Sugerido vs Distancia
IF p_suggested_price < 0 THEN RAISE EXCEPTION 'El precio sugerido no puede ser negativo.';
END IF;
-- Calcular distancia aproximada para validar precio "loco"
v_distance_meters := ST_Distance(v_origin_point, v_destination_point);
IF v_distance_meters > 0 THEN -- Límite: 1€/km (más flexible que oferta, pero evita lavado de dinero obvio)
IF (p_suggested_price / (v_distance_meters / 1000.0)) > 1.00 THEN RAISE EXCEPTION 'El precio sugerido es inusualmente alto (>1€/km). Revisión de seguridad.';
END IF;
END IF;
INSERT INTO public.ride_requests (
        requester_id,
        origin,
        destination,
        origin_location,
        destination_location,
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
        v_origin_point,
        v_destination_point,
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
-- ==========================================
-- FUNCIÓN: confirm_trip_and_pay
-- Reservar un asiento y procesar el pago
-- ==========================================
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
v_ride_status TEXT;
BEGIN -- Obtener el ID del usuario autenticado
v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del pasajero (incluyendo género para validación)
SELECT display_name,
    photo_url,
    gender INTO v_passenger_name,
    v_passenger_photo,
    v_passenger_gender
FROM public.profiles
WHERE id = v_passenger_id;
-- Obtener información del viaje con bloqueo de fila para evitar condiciones de carrera (Overbooking)
SELECT price,
    seats_available,
    driver_id,
    participant_ids,
    is_women_only,
    approval_mode,
    departure_time,
    status INTO v_ride_price,
    v_seats_available,
    v_driver_id,
    v_participant_ids,
    v_is_women_only,
    v_approval_mode,
    v_departure_time,
    v_ride_status
FROM public.rides
WHERE id = p_ride_id
    AND status IN ('scheduled', 'in_progress') FOR
UPDATE;
-- BLINDAJE: Bloquea la fila hasta que termine la transacción
IF v_ride_price IS NULL THEN RAISE EXCEPTION 'El viaje no existe o no está disponible';
END IF;
-- Solo validamos tiempo de salida si el viaje aún no ha comenzado
IF v_ride_status = 'scheduled'
AND v_departure_time <= NOW() THEN RAISE EXCEPTION 'Este viaje ya ha salido o la fecha ha expirado.';
END IF;
-- VALIDACIÓN CLAVE: Women Only
IF v_is_women_only
AND (
    v_passenger_gender IS NULL
    OR v_passenger_gender != 'female'
) THEN RAISE EXCEPTION 'Este viaje es exclusivo para mujeres';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan asientos disponibles';
END IF;
IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'No puedes reservar tu propio viaje';
END IF;
IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'Ya tienes una reserva en este viaje';
END IF;
-- Obtener balance de la wallet
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id;
IF v_wallet_balance IS NULL THEN RAISE EXCEPTION 'Wallet no encontrada';
END IF;
IF v_wallet_balance < v_ride_price THEN RAISE EXCEPTION 'Saldo insuficiente';
END IF;
-- Determinar status inicial (manual -> pending, automatic -> confirmed)
v_booking_status := CASE
    WHEN v_approval_mode = 'manual' THEN 'pending'
    ELSE 'confirmed'
END;
-- Generar PIN de 4 dígitos
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
-- Crear objeto del nuevo pasajero (Congelamos el precio para evitar fraudes)
v_new_passenger := json_build_object(
    'id',
    v_passenger_id,
    'displayName',
    v_passenger_name,
    'photoURL',
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
-- Actualizar wallet
UPDATE public.wallets
SET balance = balance - v_ride_price,
    held_balance = held_balance + v_ride_price
WHERE user_id = v_passenger_id;
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
SELECT user_id,
    user_id,
    'hold',
    - v_ride_price,
    balance,
    'Pago retenido para viaje (Precio congelado)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- SI VIENE DE UNA SOLICITUD: Validar expiración de pago
IF p_request_id IS NOT NULL THEN IF NOT EXISTS (
    SELECT 1
    FROM public.ride_requests
    WHERE id = p_request_id
        AND status = 'accepted'
        AND payment_expires_at > NOW()
        AND requester_id = v_passenger_id
) THEN RAISE EXCEPTION 'La solicitud de viaje ha expirado o ya no es válida para pago.';
END IF;
-- Marcar solicitud como cumplida
UPDATE public.ride_requests
SET status = 'fulfilled'
WHERE id = p_request_id;
END IF;
-- Actualizar el viaje
UPDATE public.rides
SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = CASE
        WHEN v_booking_status = 'confirmed' THEN seats_available - 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
-- ⚡ SINCRONIZACIÓN DE CHAT: Asegurar que el pasajero vea el chat en su lista inmediatamente
PERFORM public.get_or_create_ride_chat(p_ride_id);
RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: cancel_booking_and_refund
-- Cancelar reserva y reembolsar
-- ==========================================
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_booked_price DECIMAL;
v_departure_time TIMESTAMPTZ;
v_passengers JSONB;
v_new_passengers JSONB;
v_refund_amount DECIMAL;
v_refund_percentage INTEGER;
v_hours_until_departure FLOAT;
v_driver_id UUID;
v_penalty_amount DECIMAL;
v_driver_compensation DECIMAL := 0;
v_booked_at TIMESTAMPTZ;
v_minutes_since_booking FLOAT;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del viaje y de la reserva específica del usuario
SELECT driver_id,
    departure_time,
    passengers INTO v_driver_id,
    v_departure_time,
    v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled';
IF v_passengers IS NULL THEN RAISE EXCEPTION 'El viaje no existe o no puede ser cancelado';
END IF;
-- Buscar datos específicos de la reserva del pasajero
SELECT (passenger->>'booked_price')::DECIMAL,
    (passenger->>'booked_at')::TIMESTAMPTZ INTO v_booked_price,
    v_booked_at
FROM jsonb_array_elements(v_passengers) AS passenger
WHERE (passenger->>'id')::UUID = v_passenger_id;
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'No tienes una reserva en este viaje';
END IF;
-- LÓGICA DE REEMBOLSO (Ventanas de tiempo)
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_departure_time - NOW())
) / 3600;
v_minutes_since_booking := EXTRACT(
    EPOCH
    FROM (NOW() - v_booked_at)
) / 60;
-- Regla de Oro: Periodo de gracia de 15 min si el viaje no es inminente (< 3h)
IF v_minutes_since_booking <= 15
AND v_hours_until_departure > 3 THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure > 24 THEN v_refund_percentage := 100;
v_refund_amount := v_booked_price;
ELSIF v_hours_until_departure >= 2 THEN v_refund_percentage := 50;
v_refund_amount := ROUND(v_booked_price * 0.5, 2);
ELSE -- Menos de 2 horas o ya pasado el tiempo: Sin reembolso
v_refund_percentage := 0;
v_refund_amount := 0;
END IF;
-- LÓGICA DE COMPENSACIÓN AL CONDUCTOR (Si hay penalización)
v_penalty_amount := v_booked_price - v_refund_amount;
-- Remover al pasajero del array
SELECT jsonb_agg(passenger) INTO v_new_passengers
FROM jsonb_array_elements(v_passengers) AS passenger
WHERE (passenger->>'id')::UUID != v_passenger_id;
-- 1. Procesar Reembolso al Pasajero
IF v_refund_amount > 0 THEN
UPDATE public.wallets
SET balance = balance + v_refund_amount,
    held_balance = held_balance - v_booked_price -- Liberamos todo el held
WHERE user_id = v_passenger_id;
ELSE
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
END IF;
-- Registrar transacción del pasajero
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'refund',
    v_refund_amount,
    balance,
    'Reembolso (' || v_refund_percentage || '%) por cancelación del pasajero',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- 2. ENVIAR COMPENSACIÓN AL CONDUCTOR (Si la cancelación es tardía)
IF v_penalty_amount > 0 THEN -- El conductor recibe el 80% de la penalización (20% para la plataforma)
v_driver_compensation := ROUND(v_penalty_amount * 0.8, 2);
UPDATE public.wallets
SET balance = balance + v_driver_compensation
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
SELECT user_id,
    user_id,
    'cancellation_compensation',
    v_driver_compensation,
    balance,
    'Compensación por cancelación tardía de pasajero',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
-- Notificar al conductor
PERFORM public.create_notification(
    v_driver_id,
    'Compensación por Cancelación',
    'Un pasajero ha cancelado tarde. Se ha ingresado una compensación de ' || v_driver_compensation || '€ en tu balance.',
    'info',
    jsonb_build_object('ride_id', p_ride_id)
);
END IF;
-- 3. Actualizar el viaje
UPDATE public.rides
SET passengers = COALESCE(v_new_passengers, '[]'::JSONB),
    participant_ids = array_remove(participant_ids, v_passenger_id),
    seats_available = seats_available + 1
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Reserva cancelada con reembolso del ' || v_refund_percentage || '%',
    'refundAmount',
    v_refund_amount,
    'driverCompensation',
    v_driver_compensation
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: handle_passenger_no_show
-- Gestionar pasajeros que no se presentan (No-Show)
-- El conductor reclama el pago por el asiento reservado.
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_ride_status TEXT;
v_passengers JSONB;
v_booked_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_earning DECIMAL;
v_passenger_name TEXT;
BEGIN v_driver_id := auth.uid();
-- 1. Verificar viaje y propiedad
SELECT driver_id,
    status,
    passengers INTO v_ride_driver,
    v_ride_status,
    v_passengers
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'No tienes permisos sobre este viaje';
END IF;
-- 2. Verificar que el pasajero esté confirmado y no verificado
SELECT (p->>'booked_price')::DECIMAL,
    (p->>'displayName') INTO v_booked_price,
    v_passenger_name
FROM jsonb_array_elements(v_passengers) AS p
WHERE (p->>'id')::UUID = p_passenger_id
    AND p->>'status' = 'confirmed';
IF v_booked_price IS NULL THEN RAISE EXCEPTION 'El pasajero no está en la lista de confirmados o ya ha sido verificado/cancelado';
END IF;
-- 3. Cálculos Financieros (Penalización 100% para el pasajero, Pago al conductor)
v_platform_fee := ROUND(v_booked_price * 0.15, 2);
v_driver_earning := v_booked_price - v_platform_fee;
-- 4. Actualizar Wallet del Pasajero (Liberar Held Balance - Dinero se queda en el sistema/pago)
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
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
SELECT user_id,
    user_id,
    'ride_payment',
    - v_booked_price,
    balance,
    'Cobro por No-Show (No presentado al viaje)',
    p_ride_id
FROM public.wallets
WHERE user_id = p_passenger_id;
-- 5. Actualizar Wallet del Conductor (Recibe el pago menos comisión)
UPDATE public.wallets
SET balance = balance + v_driver_earning
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
SELECT user_id,
    user_id,
    'ride_earning',
    v_driver_earning,
    balance,
    'Ganancia por No-Show de ' || v_passenger_name,
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
-- 6. Actualizar Array de Pasajeros y Asientos
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"no_show"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) AS p
    ),
    seats_available = CASE
        WHEN status = 'scheduled' THEN seats_available + 1
        ELSE seats_available
    END
WHERE id = p_ride_id;
-- 7. Notificar al Pasajero
PERFORM public.create_notification(
    p_passenger_id,
    'Marcado como No-Presentado',
    'El conductor te ha marcado como ausente en el viaje. Se ha procedido al cobro íntegro de la reserva según nuestra política de cancelación.',
    'warning',
    jsonb_build_object('ride_id', p_ride_id)
);
RETURN json_build_object(
    'success',
    true,
    'message',
    'Pasajero marcado como No-Show. Fondos procesados correctamente.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: start_ride
-- Iniciar un viaje (conductor)
-- ==========================================
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_ride_status TEXT;
v_passengers JSONB;
v_valid_passenger_found BOOLEAN := FALSE;
v_departure_time TIMESTAMPTZ;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del viaje
SELECT driver_id,
    status,
    passengers,
    departure_time INTO v_ride_driver,
    v_ride_status,
    v_passengers,
    v_departure_time
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede iniciar el viaje';
END IF;
IF v_ride_status != 'scheduled' THEN RAISE EXCEPTION 'El viaje ya ha sido iniciado o no está disponible';
END IF;
-- Restricción temporal: solo permitir iniciar 15 minutos antes de la salida
IF NOW() < v_departure_time - INTERVAL '15 minutes' THEN RAISE EXCEPTION 'El inicio del viaje se habilita 15 minutos antes de la salida.';
END IF;
IF jsonb_array_length(v_passengers) = 0 THEN RAISE EXCEPTION 'No hay pasajeros confirmados para iniciar el viaje';
END IF;
-- VERIFICACIÓN DINÁMICA DE PIN: Buscamos si el PIN coincide con CUALQUIER pasajero confirmado
SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_passengers) AS p
        WHERE p->>'status' = 'confirmed'
            AND p->>'pin' = p_pin
    ) INTO v_valid_passenger_found;
IF NOT v_valid_passenger_found THEN RAISE EXCEPTION 'PIN incorrecto. No coincide con ningún pasajero confirmado.';
END IF;
-- Actualizar estado del viaje
UPDATE public.rides
SET status = 'in_progress'
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    '¡Viaje iniciado con éxito!'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: complete_ride
-- Completar un viaje (conductor)
-- ==========================================
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_passengers JSONB;
v_passenger JSONB;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_earning DECIMAL;
v_co2_saved DECIMAL;
v_distance DECIMAL;
v_passenger_count INTEGER;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del viaje (Nota: Ya no obtenemos el precio global para procesar pagos)
SELECT driver_id,
    passengers,
    distance INTO v_ride_driver,
    v_passengers,
    v_distance
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede completar el viaje';
END IF;
-- Calcular ahorro de CO2 (simplificado)
v_passenger_count := jsonb_array_length(v_passengers);
IF v_distance > 0
AND v_passenger_count > 0 THEN v_co2_saved := (v_distance * 0.12) * v_passenger_count;
ELSE v_co2_saved := 0;
END IF;
-- Procesar pagos para cada pasajero usando el precio CONGELADO al reservar
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_passengers) LOOP IF v_passenger->>'status' = 'confirmed' THEN v_passenger_id := (v_passenger->>'id')::UUID;
v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
-- Redondeo de precisión de 2 decimales para evitar pérdida de céntimos (Comisión 15%)
v_platform_fee := ROUND(v_booked_price * 0.15, 2);
v_driver_earning := v_booked_price - v_platform_fee;
-- Liberar fondos retenidos del pasajero
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
-- Registrar transacción del pasajero
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'ride_payment',
    - v_booked_price,
    balance,
    'Pago de viaje completado (Precio congelado)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- Agregar ganancias al conductor
UPDATE public.wallets
SET balance = balance + v_driver_earning
WHERE user_id = v_driver_id;
-- Registrar ganancia del conductor
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'ride_earning',
    v_driver_earning,
    balance,
    'Ganancia de viaje (' || v_passenger->>'displayName' || ')',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
-- Registrar comisión de la plataforma (15%)
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    v_passenger_id,
    'platform_fee',
    v_platform_fee,
    balance,
    'Comisión de plataforma (15%) - ' || v_passenger->>'displayName',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
END IF;
END LOOP;
-- Actualizar estado del viaje y el CO2 ahorrado
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW(),
    co2_saved = v_co2_saved
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Viaje completado y pagos procesados'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: cancel_ride
-- Cancelar un viaje (conductor)
-- ==========================================
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_ride_price DECIMAL;
v_passengers JSONB;
v_passenger JSONB;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_departure_time TIMESTAMPTZ;
v_hours_until_departure FLOAT;
v_driver_penalty DECIMAL := 0;
v_updated_passengers JSONB;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del viaje
SELECT driver_id,
    price,
    passengers,
    departure_time INTO v_ride_driver,
    v_ride_price,
    v_passengers,
    v_departure_time
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede cancelar el viaje';
END IF;
-- LÓGICA DE PENALIZACIÓN AL CONDUCTOR
v_hours_until_departure := EXTRACT(
    EPOCH
    FROM (v_departure_time - NOW())
) / 3600;
IF v_hours_until_departure < 2 THEN v_driver_penalty := 5.0;
ELSIF v_hours_until_departure < 24 THEN v_driver_penalty := 2.0;
END IF;
IF v_driver_penalty > 0 THEN
UPDATE public.wallets
SET balance = balance - v_driver_penalty
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
    'cancellation_fee',
    - v_driver_penalty,
    balance,
    'Penalización por cancelación tardía (' || v_hours_until_departure::INT || 'h antes)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
END IF;
-- Reembolsar y actualizar estados de todos los pasajeros (confirmados y pendientes)
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_passengers) LOOP v_passenger_id := (v_passenger->>'id')::UUID;
v_booked_price := COALESCE(
    (v_passenger->>'booked_price')::DECIMAL,
    v_ride_price
);
IF v_passenger->>'status' IN ('confirmed', 'pending') THEN
UPDATE public.wallets
SET balance = balance + v_booked_price,
    held_balance = held_balance - v_booked_price
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
    'refund',
    v_booked_price,
    balance,
    'Reembolso por cancelación del conductor',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
PERFORM public.create_notification(
    v_passenger_id,
    'Viaje cancelado',
    'El conductor canceló el viaje. Se ha reembolsado tu pago retenido.',
    'warning',
    jsonb_build_object('ride_id', p_ride_id)
);
END IF;
END LOOP;
-- Marcar todos los pasajeros como 'cancelled' en el JSON del viaje
SELECT jsonb_agg(
        jsonb_set(p, '{status}', '"cancelled"')
    ) INTO v_updated_passengers
FROM jsonb_array_elements(v_passengers) AS p;
-- Actualizar estado del viaje
UPDATE public.rides
SET status = 'cancelled',
    passengers = COALESCE(v_updated_passengers, '[]'::JSONB),
    cancelled_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'message', 'Viaje cancelado');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: search_rides
-- Buscar viajes cercanos a una ruta
-- ==========================================
CREATE OR REPLACE FUNCTION public.search_rides(
        p_origin_lat FLOAT,
        p_origin_lng FLOAT,
        p_destination_lat FLOAT,
        p_destination_lng FLOAT,
        p_departure_date DATE DEFAULT NULL,
        p_max_distance_km FLOAT DEFAULT 5.0
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        details TEXT,
        distance DECIMAL,
        origin_distance_km FLOAT,
        destination_distance_km FLOAT
    ) AS $$
DECLARE v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
BEGIN -- Crear puntos geográficos
v_origin_point := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::GEOGRAPHY;
v_destination_point := ST_SetSRID(
    ST_MakePoint(p_destination_lng, p_destination_lat),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    p.rating,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.details,
    r.distance,
    ST_Distance(r.origin_location, v_origin_point) / 1000 AS origin_distance_km,
    ST_Distance(r.destination_location, v_destination_point) / 1000 AS destination_distance_km
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status = 'scheduled'
    AND r.seats_available > 0
    AND r.departure_time > NOW()
    AND ST_Distance(r.origin_location, v_origin_point) <= (p_max_distance_km * 1000)
    AND ST_Distance(r.destination_location, v_destination_point) <= (p_max_distance_km * 1000)
    AND (
        p_departure_date IS NULL
        OR DATE(r.departure_time) = p_departure_date
    )
ORDER BY (
        ST_Distance(r.origin_location, v_origin_point) + ST_Distance(r.destination_location, v_destination_point)
    ) ASC,
    r.departure_time ASC
LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;
-- ==========================================
-- FUNCIÓN: get_user_rides
-- Obtener viajes de un usuario (como conductor o pasajero)
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_user_rides(
        p_user_id UUID DEFAULT NULL,
        p_role TEXT DEFAULT 'all' -- 'driver', 'passenger', 'all'
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_total INTEGER,
        seats_available INTEGER,
        price DECIMAL,
        status TEXT,
        role_in_ride TEXT
    ) AS $$
DECLARE v_user_id UUID;
BEGIN v_user_id := COALESCE(p_user_id, auth.uid());
IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario no especificado';
END IF;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_total,
    r.seats_available,
    r.price,
    r.status,
    CASE
        WHEN r.driver_id = v_user_id THEN 'driver'::TEXT
        ELSE 'passenger'::TEXT
    END AS role_in_ride
FROM public.rides r
WHERE (
        p_role = 'all'
        OR (
            p_role = 'driver'
            AND r.driver_id = v_user_id
        )
        OR (
            p_role = 'passenger'
            AND v_user_id = ANY(r.participant_ids)
            AND r.driver_id != v_user_id
        )
    )
    AND v_user_id = ANY(r.participant_ids)
ORDER BY r.departure_time DESC;
END;
$$ LANGUAGE plpgsql STABLE;
-- ==========================================
-- FUNCIÓN: create_notification
-- Crea una notificación para un usuario
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_notification(
        p_user_id UUID,
        p_title TEXT,
        p_content TEXT,
        p_type TEXT DEFAULT 'info',
        p_data JSONB DEFAULT '{}'::jsonb
    ) RETURNS JSON AS $$ BEGIN
INSERT INTO public.notifications (user_id, payload)
VALUES (
        p_user_id,
        jsonb_build_object(
            'title',
            p_title,
            'content',
            p_content,
            'type',
            p_type,
            'data',
            p_data
        )
    );
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: cleanup_expired_rides
-- Detecta viajes 'scheduled' con más de 48h de retraso y los auto-cancela,
-- reembolsando al 100% a los pasajeros afectados y notificándoles.
-- ==========================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_rides() RETURNS JSON AS $$
DECLARE v_ride RECORD;
v_passenger JSONB;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_count INTEGER := 0;
BEGIN -- Buscamos viajes que debieron salir hace más de 48h y siguen en 'scheduled'
FOR v_ride IN
SELECT id,
    passengers,
    origin,
    destination
FROM public.rides
WHERE status = 'scheduled'
    AND departure_time < NOW() - INTERVAL '48 hours' LOOP -- Reembolsar a cada pasajero el 100%
    FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP IF v_passenger->>'status' = 'confirmed' THEN v_passenger_id := (v_passenger->>'id')::UUID;
v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
IF v_booked_price IS NOT NULL THEN -- Devolver balance
UPDATE public.wallets
SET balance = balance + v_booked_price,
    held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
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
SELECT user_id,
    user_id,
    'refund',
    v_booked_price,
    balance,
    'Reembolso automático: Viaje expirado/abandonado',
    v_ride.id
FROM public.wallets
WHERE user_id = v_passenger_id;
-- NOTIFICACIÓN AL PASAJERO (Añadido)
PERFORM public.create_notification(
    v_passenger_id,
    'Viaje expirado y reembolsado',
    'Tu viaje de ' || (v_ride.origin->>'name') || ' a ' || (v_ride.destination->>'name') || ' ha expirado por inactividad del conductor. Se ha reembolsado el 100% a tu cartera.',
    'warning',
    jsonb_build_object('ride_id', v_ride.id)
);
END IF;
END IF;
END LOOP;
-- Marcar viaje como expirado
UPDATE public.rides
SET status = 'expired'
WHERE id = v_ride.id;
v_count := v_count + 1;
END LOOP;
RETURN json_build_object('success', true, 'processed_rides', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: get_public_profile
-- Devuelve solo la información pública de un usuario para proteger su privacidad.
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID) RETURNS JSON AS $$
DECLARE v_profile JSONB;
BEGIN
SELECT jsonb_build_object(
        'id',
        id,
        'display_name',
        display_name,
        'photo_url',
        photo_url,
        'avatar_url',
        avatar_url,
        'bio',
        bio,
        'rating',
        rating,
        'review_count',
        review_count,
        'rides_count',
        rides_count,
        'total_co2_saved',
        total_co2_saved,
        'verification_status',
        (verification->>'status'),
        'created_at',
        created_at,
        'vehicle',
        CASE
            WHEN vehicle IS NOT NULL
            AND vehicle != '{}'::jsonb THEN jsonb_build_object(
                'make',
                vehicle->>'make',
                'model',
                vehicle->>'model',
                'color',
                vehicle->>'color' -- La matrícula (plate) NO se devuelve por seguridad
            )
            ELSE NULL
        END
    ) INTO v_profile
FROM public.profiles
WHERE id = p_user_id;
IF v_profile IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado';
END IF;
RETURN v_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: delete_user_account
-- Elimina la cuenta del usuario autenticado.
-- ==========================================
CREATE OR REPLACE FUNCTION public.delete_user_account() RETURNS VOID AS $$ BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado';
END IF;
DELETE FROM auth.users
WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: update_ride
-- Permite al conductor editar los detalles de su viaje.
-- Restricciones: No puede reducir asientos por debajo de los ya ocupados.
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_ride(
        p_ride_id UUID,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_current_passenger_count INTEGER;
v_ride_status TEXT;
BEGIN v_driver_id := auth.uid();
-- Verificar propiedad del viaje y estado
SELECT status,
    jsonb_array_length(passengers) INTO v_ride_status,
    v_current_passenger_count
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id;
IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado o no tienes permisos';
END IF;
IF v_ride_status != 'scheduled' THEN RAISE EXCEPTION 'No se puede editar un viaje que ya ha comenzado o finalizado';
END IF;
-- Validar asientos: No se puede bajar de los pasajeros ya confirmados
IF p_seats < v_current_passenger_count THEN RAISE EXCEPTION 'No puedes reducir los asientos por debajo del número de pasajeros ya confirmados (%)',
v_current_passenger_count;
END IF;
-- Actualizar
UPDATE public.rides
SET departure_time = p_departure_time,
    seats_total = p_seats,
    seats_available = p_seats - v_current_passenger_count,
    price = p_price,
    details = p_details,
    is_women_only = p_is_women_only
WHERE id = p_ride_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- MÓDULO: SEGURIDAD Y MODERACIÓN DE CONTENIDO
-- ==========================================
-- Función para sanear y moderar contenido
CREATE OR REPLACE FUNCTION public.moderate_content_fn() RETURNS TRIGGER AS $$
DECLARE v_content TEXT;
v_forbidden_words TEXT [] := ARRAY [
        'mierda', 'puta', 'puto', 'cabron', 'cabrón', 'gilipollas', 'pendejo', 'estupido', 'estúpido',
        'subnormal', 'maricon', 'maricón', 'joder', 'coño', 'fuck', 'shit', 'bitch', 'asshole'
    ];
v_word TEXT;
v_has_abuse BOOLEAN := FALSE;
BEGIN -- Determinar qué campo moderar según la tabla
IF TG_TABLE_NAME = 'messages' THEN v_content := NEW.content;
ELSIF TG_TABLE_NAME = 'rides'
OR TG_TABLE_NAME = 'ride_requests' THEN v_content := NEW.details;
ELSE RETURN NEW;
END IF;
IF v_content IS NULL
OR v_content = '' THEN RETURN NEW;
END IF;
-- 1. Censura de Palabras Prohibidas (Case Insensitive)
FOREACH v_word IN ARRAY v_forbidden_words LOOP IF v_content ~* ('\y' || v_word || '\y') THEN v_content := regexp_replace(v_content, '\y' || v_word || '\y', '****', 'gi');
v_has_abuse := TRUE;
END IF;
END LOOP;
-- 2. Detección y censura de Números de Teléfono (Prevención de saltar la plataforma)
-- Patrón: Detecta secuencias de 9 o más dígitos con posibles espacios/guiones
IF v_content ~ '(\+?\d{1,3}[- ]?)?\d{3}[- ]?\d{3}[- ]?\d{3,4}' THEN v_content := regexp_replace(
    v_content,
    '(\+?\d{1,3}[- ]?)?\d{3}[- ]?\d{3}[- ]?\d{3,4}',
    '[NÚMERO PROTEGIDO]',
    'g'
);
v_has_abuse := TRUE;
END IF;
-- 3. Detección de Enlaces Sospechosos
-- Permite solo dominios de confianza (sharway.com, google.com, openstreetmap.org)
-- Censura cualquier otro link
IF v_content ~* 'https?://[^\s]+' THEN IF NOT (
    v_content ~* 'https?://([a-z0-9]+\.)?(sharway\.com|google\.com|openstreetmap\.org)'
) THEN v_content := regexp_replace(
    v_content,
    'https?://[^\s]+',
    '[ENLACE BLOQUEADO POR SEGURIDAD]',
    'gi'
);
v_has_abuse := TRUE;
END IF;
END IF;
-- Aplicar cambios al registro
IF TG_TABLE_NAME = 'messages' THEN NEW.content := v_content;
ELSIF TG_TABLE_NAME = 'rides'
OR TG_TABLE_NAME = 'ride_requests' THEN NEW.details := v_content;
END IF;
-- Opcional: Podríamos registrar 'v_has_abuse' en una tabla de logs para auditoría humana
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Aplicar Triggers de Moderación
DROP TRIGGER IF EXISTS on_message_insert_moderate ON public.messages;
CREATE TRIGGER on_message_insert_moderate BEFORE
INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.moderate_content_fn();
DROP TRIGGER IF EXISTS on_ride_insert_moderate ON public.rides;
CREATE TRIGGER on_ride_insert_moderate BEFORE
INSERT
    OR
UPDATE OF details ON public.rides FOR EACH ROW EXECUTE FUNCTION public.moderate_content_fn();
DROP TRIGGER IF EXISTS on_request_insert_moderate ON public.ride_requests;
CREATE TRIGGER on_request_insert_moderate BEFORE
INSERT
    OR
UPDATE OF details ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.moderate_content_fn();
-- ==========================================
-- MÓDULO: SEGURIDAD DE CHATS Y CONFIRMACIONES
-- ==========================================
-- 1. Función para cerrar chats después de 24h del fin del viaje
CREATE OR REPLACE FUNCTION public.check_chat_active_fn() RETURNS TRIGGER AS $$
DECLARE v_ride_id UUID;
v_ride_status TEXT;
v_completed_at TIMESTAMPTZ;
BEGIN -- Obtener el ride_id asociado al chat
SELECT ride_id INTO v_ride_id
FROM public.chats
WHERE id = NEW.chat_id;
-- Si no hay viaje asociado, permitir (chats directos permanentes entre amigos/conocidos)
IF v_ride_id IS NULL THEN RETURN NEW;
END IF;
-- Verificar el estado del viaje asociado
SELECT status,
    completed_at INTO v_ride_status,
    v_completed_at
FROM public.rides
WHERE id = v_ride_id;
-- Bloqueo por privacidad: 24h después de completado
IF v_ride_status = 'completed'
AND (v_completed_at + INTERVAL '24 hours') < NOW() THEN RAISE EXCEPTION 'El chat para este viaje ha sido cerrado por privacidad (límite 24h superado).';
END IF;
-- Bloqueo por cancelación
IF v_ride_status = 'cancelled' THEN RAISE EXCEPTION 'No se pueden enviar mensajes en un viaje cancelado.';
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger para validar mensajes antes de insertar
DROP TRIGGER IF EXISTS on_message_insert_check_active ON public.messages;
CREATE TRIGGER on_message_insert_check_active BEFORE
INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.check_chat_active_fn();
-- 2. Función para que el pasajero confirme su llegada (Check-out)
CREATE OR REPLACE FUNCTION public.confirm_passenger_arrival(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID;
v_ride_status TEXT;
BEGIN v_passenger_id := auth.uid();
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Verificar que el viaje no esté aún en 'scheduled'
SELECT status INTO v_ride_status
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_status = 'scheduled' THEN RAISE EXCEPTION 'No puedes confirmar llegada de un viaje que no ha comenzado';
END IF;
-- Actualizar estado del pasajero en el array (añadir flag arrived)
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{arrived}', 'true')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) AS p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Llegada confirmada correctamente.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- MÓDULO: FUNCIONES FALTANTES (RPC)
-- ==========================================
-- 1) remove_passenger: El conductor elimina a un pasajero del viaje
DROP FUNCTION IF EXISTS public.remove_passenger(UUID, UUID);
CREATE OR REPLACE FUNCTION public.remove_passenger(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_actor_id UUID;
v_driver_id UUID;
v_seats_total INTEGER;
v_seats_available INTEGER;
v_passengers JSONB;
v_exists BOOLEAN := FALSE;
BEGIN v_actor_id := auth.uid();
IF v_actor_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Bloquear fila y obtener datos del viaje
SELECT driver_id,
    seats_total,
    seats_available,
    passengers INTO v_driver_id,
    v_seats_total,
    v_seats_available,
    v_passengers
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- Sólo el conductor puede eliminar pasajeros con esta función
IF v_actor_id <> v_driver_id THEN RAISE EXCEPTION 'No autorizado: sólo el conductor puede eliminar pasajeros';
END IF;
-- Comprobar si el pasajero está en el listado
SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_passengers) AS p
        WHERE (p->>'id')::UUID = p_passenger_id
    ) INTO v_exists;
IF NOT v_exists THEN RETURN json_build_object(
    'success',
    false,
    'message',
    'El pasajero no está en este viaje'
);
END IF;
-- Eliminar del array passengers y de los arrays auxiliares
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(p)
        FROM jsonb_array_elements(passengers) AS p
        WHERE (p->>'id')::UUID <> p_passenger_id
    ),
    seats_available = LEAST(v_seats_total, v_seats_available + 1),
    pending_passenger_ids = array_remove(pending_passenger_ids, p_passenger_id),
    passenger_ids = array_remove(passenger_ids, p_passenger_id),
    participant_ids = array_remove(participant_ids, p_passenger_id)
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Pasajero eliminado correctamente'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2) create_stripe_connect_onboarding: Devuelve URL de onboarding (stub)
CREATE OR REPLACE FUNCTION public.create_stripe_connect_onboarding(p_return_url TEXT) RETURNS JSON AS $$
DECLARE v_user_id UUID;
v_display_name TEXT;
v_onboarding_url TEXT;
BEGIN v_user_id := auth.uid();
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT display_name INTO v_display_name
FROM public.profiles
WHERE id = v_user_id;
-- Stub de URL de onboarding (integración real vía Edge Function / backend)
v_onboarding_url := 'https://connect.stripe.com/express/onboarding' || '?return_url=' || coalesce(p_return_url, '') || '&client_reference_id=' || v_user_id::TEXT || '&prefill_business_name=' || coalesce(v_display_name, 'Shareway User');
RETURN json_build_object(
    'success',
    true,
    'onboarding_url',
    v_onboarding_url
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3) search_users: Búsqueda de usuarios (sólo admin)
DROP FUNCTION IF EXISTS public.search_users(TEXT);
CREATE OR REPLACE FUNCTION public.search_users(p_search_term TEXT) RETURNS TABLE (
        id UUID,
        display_name TEXT,
        email TEXT,
        is_admin BOOLEAN,
        created_at TIMESTAMPTZ
    ) AS $$
DECLARE v_requester UUID;
v_is_admin BOOLEAN;
BEGIN v_requester := auth.uid();
IF v_requester IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT is_admin INTO v_is_admin
FROM public.profiles
WHERE id = v_requester;
IF NOT coalesce(v_is_admin, FALSE) THEN RAISE EXCEPTION 'No autorizado: se requieren privilegios de administrador';
END IF;
RETURN QUERY
SELECT p.id,
    p.display_name,
    p.email,
    p.is_admin,
    p.created_at
FROM public.profiles p
WHERE p.display_name ILIKE '%' || coalesce(p_search_term, '') || '%'
    OR p.email ILIKE '%' || coalesce(p_search_term, '') || '%'
ORDER BY p.created_at DESC
LIMIT 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;