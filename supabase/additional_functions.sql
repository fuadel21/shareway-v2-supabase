-- ==========================================
-- FUNCIONES RPC ADICIONALES PARA SUPABASE
-- Funciones complementarias para el sistema
-- ==========================================
-- ==========================================
-- FUNCIÓN: create_ride_request
-- Crear una solicitud de viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER DEFAULT 1,
        p_suggested_price DECIMAL DEFAULT NULL,
        p_details TEXT DEFAULT ''
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_requester_name TEXT;
v_requester_photo TEXT;
v_request_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del solicitante
SELECT display_name,
    photo_url INTO v_requester_name,
    v_requester_photo
FROM public.profiles
WHERE id = v_requester_id;
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
-- Insertar solicitud
INSERT INTO public.ride_requests (
        requester_id,
        requester_display_name,
        requester_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_needed,
        suggested_price,
        details,
        expires_at
    )
VALUES (
        v_requester_id,
        v_requester_name,
        v_requester_photo,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_departure_time + INTERVAL '24 hours'
    )
RETURNING id INTO v_request_id;
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.clean_pending_reservations() RETURNS JSON AS $$
DECLARE v_count INTEGER := 0;
v_ride RECORD;
v_passenger JSONB;
v_passenger_id UUID;
v_price DECIMAL;
BEGIN FOR v_ride IN
SELECT id,
    passengers
FROM public.rides
WHERE status = 'scheduled' LOOP FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP IF v_passenger->>'status' = 'pending'
    AND (v_passenger->>'booked_at')::TIMESTAMPTZ < NOW() - INTERVAL '2 hours' THEN v_passenger_id := (v_passenger->>'id')::UUID;
v_price := (v_passenger->>'booked_price')::DECIMAL;
UPDATE public.wallets
SET balance = balance + v_price,
    held_balance = held_balance - v_price
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
    v_price,
    balance,
    'Solicitud expirada (sin decisión del conductor)',
    v_ride.id
FROM public.wallets
WHERE user_id = v_passenger_id;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"rejected"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) AS p
    ),
    participant_ids = array_remove(participant_ids, v_passenger_id)
WHERE id = v_ride.id;
PERFORM public.create_notification(
    v_passenger_id,
    'Solicitud expirada',
    'El conductor no decidió a tiempo. Hemos reembolsado tu pago retenido.',
    'warning',
    jsonb_build_object('ride_id', v_ride.id)
);
v_count := v_count + 1;
END IF;
END LOOP;
END LOOP;
RETURN json_build_object(
    'success',
    true,
    'expired_pending_requests',
    v_count
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: cancel_ride_request
-- Cancelar una solicitud de viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.cancel_ride_request(p_request_id UUID) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Verificar que la solicitud pertenece al usuario
UPDATE public.ride_requests
SET status = 'cancelled'
WHERE id = p_request_id
    AND requester_id = v_requester_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada o no tienes permisos';
END IF;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: accept_request
-- Aceptar una solicitud y asignarla a un viaje.
-- BLINDAJE: Verifica asientos disponibles y notifica al pasajero.
-- ==========================================
CREATE OR REPLACE FUNCTION public.accept_request(p_request_id UUID, p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_seats_available INTEGER;
v_passenger_id UUID;
v_origin_name TEXT;
v_dest_name TEXT;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Bloquear el viaje y la solicitud para edición concurrente
SELECT driver_id,
    seats_available,
    (origin->>'name'),
    (destination->>'name') INTO v_ride_driver,
    v_seats_available,
    v_origin_name,
    v_dest_name
FROM public.rides
WHERE id = p_ride_id
    AND status = 'scheduled' FOR
UPDATE;
SELECT requester_id INTO v_passenger_id
FROM public.ride_requests
WHERE id = p_request_id
    AND status = 'pending' FOR
UPDATE;
-- 2. Validaciones de integridad
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado o ya no está disponible';
END IF;
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'La solicitud ya no está pendiente o no existe';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede aceptar solicitudes para este viaje';
END IF;
IF v_seats_available <= 0 THEN RAISE EXCEPTION 'No quedan asientos disponibles en este viaje para aceptar la solicitud';
END IF;
-- 3. Actualizar la solicitud (Establecer límite de 2h para pagar)
UPDATE public.ride_requests
SET status = 'accepted',
    matched_ride_id = p_ride_id,
    payment_expires_at = NOW() + INTERVAL '2 hours'
WHERE id = p_request_id;
-- 4. Notificar al pasajero (Mencionar el límite de 2h)
PERFORM public.create_notification(
    v_passenger_id,
    '¡Solicitud Aceptada!',
    'El conductor ha aceptado tu solicitud de ' || v_origin_name || ' a ' || v_dest_name || '. Tienes 2 horas para completar el pago y asegurar tu plaza.',
    'success',
    jsonb_build_object(
        'ride_id',
        p_ride_id,
        'request_id',
        p_request_id,
        'expires_at',
        NOW() + INTERVAL '2 hours'
    )
);
RETURN json_build_object(
    'success',
    true,
    'message',
    'Solicitud aceptada. El pasajero ha sido notificado para proceder al pago.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: get_or_create_chat
-- Obtener o crear un chat entre dos usuarios
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_or_create_chat(
        p_other_user_id UUID,
        p_ride_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_current_user_id UUID;
v_chatId UUID;
v_current_user_name TEXT;
v_other_user_name TEXT;
v_participants UUID [];
BEGIN v_current_user_id := auth.uid();
IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Buscar chat existente
SELECT id INTO v_chatId
FROM public.chats
WHERE participants @> ARRAY [v_current_user_id, p_other_user_id]
    AND participants <@ ARRAY [v_current_user_id, p_other_user_id]
    AND (
        (
            p_ride_id IS NULL
            AND ride_id IS NULL
        )
        OR (
            p_ride_id IS NOT NULL
            AND ride_id = p_ride_id
        )
    )
LIMIT 1;
-- Si no existe, crear uno nuevo
IF v_chatId IS NULL THEN -- Obtener nombres de los participantes
SELECT display_name INTO v_current_user_name
FROM public.profiles
WHERE id = v_current_user_id;
SELECT display_name INTO v_other_user_name
FROM public.profiles
WHERE id = p_other_user_id;
INSERT INTO public.chats (
        ride_id,
        participants,
        participant_names
    )
VALUES (
        p_ride_id,
        ARRAY [v_current_user_id, p_other_user_id],
        jsonb_build_object(
            v_current_user_id::TEXT,
            v_current_user_name,
            p_other_user_id::TEXT,
            v_other_user_name
        )
    )
RETURNING id INTO v_chatId;
END IF;
RETURN json_build_object('success', true, 'chatId', v_chatId);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: add_funds (Placeholder - requiere integración con Stripe)
-- Agregar fondos a la wallet
-- ==========================================
CREATE OR REPLACE FUNCTION public.add_funds(
        p_amount DECIMAL,
        p_payment_method_id TEXT
    ) RETURNS JSON AS $$
DECLARE v_user_id UUID;
BEGIN v_user_id := auth.uid();
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido';
END IF;
-- NOTA: Aquí deberás integrar con Stripe usando Edge Functions
-- Este es un placeholder que simula la operación
-- Actualizar balance
UPDATE public.wallets
SET balance = balance + p_amount
WHERE user_id = v_user_id;
-- Registrar transacción
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description
    )
SELECT id,
    user_id,
    'deposit',
    p_amount,
    balance,
    'Depósito de fondos'
FROM public.wallets
WHERE user_id = v_user_id;
RETURN json_build_object(
    'success',
    true,
    'newBalance',
    (
        SELECT balance
        FROM public.wallets
        WHERE user_id = v_user_id
    )
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: request_payout
-- Solicitar retiro de fondos
-- ==========================================
CREATE OR REPLACE FUNCTION public.request_payout(p_amount DECIMAL) RETURNS JSON AS $$
DECLARE v_user_id UUID;
v_current_balance DECIMAL;
BEGIN v_user_id := auth.uid();
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido';
END IF;
-- Verificar balance
SELECT balance INTO v_current_balance
FROM public.wallets
WHERE user_id = v_user_id;
IF v_current_balance < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente';
END IF;
-- NOTA: Aquí deberás integrar con Stripe Connect para procesar el retiro
-- Este es un placeholder
-- Actualizar balance
UPDATE public.wallets
SET balance = balance - p_amount
WHERE user_id = v_user_id;
-- Registrar transacción
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description
    )
SELECT id,
    user_id,
    'withdrawal',
    - p_amount,
    balance,
    'Retiro de fondos'
FROM public.wallets
WHERE user_id = v_user_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Solicitud de retiro procesada'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: get_platform_stats (Admin)
-- Obtener estadísticas de la plataforma
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_platform_stats() RETURNS JSON AS $$
DECLARE v_user_id UUID;
v_is_admin BOOLEAN;
v_total_users INTEGER;
v_total_rides INTEGER;
v_active_rides INTEGER;
v_completed_rides INTEGER;
v_total_revenue DECIMAL;
BEGIN v_user_id := auth.uid();
IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Verificar si es admin
SELECT is_admin INTO v_is_admin
FROM public.profiles
WHERE id = v_user_id;
IF NOT v_is_admin THEN RAISE EXCEPTION 'No tienes permisos de administrador';
END IF;
-- Obtener estadísticas
SELECT COUNT(*) INTO v_total_users
FROM public.profiles;
SELECT COUNT(*) INTO v_total_rides
FROM public.rides;
SELECT COUNT(*) INTO v_active_rides
FROM public.rides
WHERE status IN ('scheduled', 'in_progress');
SELECT COUNT(*) INTO v_completed_rides
FROM public.rides
WHERE status = 'completed';
SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
FROM public.transactions
WHERE type = 'platform_fee';
RETURN json_build_object(
    'totalUsers',
    v_total_users,
    'totalRides',
    v_total_rides,
    'activeRides',
    v_active_rides,
    'completedRides',
    v_completed_rides,
    'totalRevenue',
    v_total_revenue
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: get_ride_participants
-- Obtener información detallada de los participantes de un viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_ride_participants(p_ride_id UUID) RETURNS TABLE (
        user_id UUID,
        display_name TEXT,
        photo_url TEXT,
        rating DECIMAL,
        role TEXT,
        status TEXT,
        pin TEXT
    ) AS $$ BEGIN RETURN QUERY
SELECT p.id,
    p.display_name,
    p.photo_url,
    p.rating,
    CASE
        WHEN r.driver_id = p.id THEN 'driver'
        ELSE 'passenger'
    END AS role,
    CASE
        WHEN r.driver_id = p.id THEN 'confirmed'
        ELSE (
            SELECT (passenger->>'status')::TEXT
            FROM jsonb_array_elements(r.passengers) AS passenger
            WHERE (passenger->>'id')::UUID = p.id
        )
    END AS status,
    CASE
        WHEN r.driver_id = p.id THEN NULL
        ELSE (
            SELECT (passenger->>'pin')::TEXT
            FROM jsonb_array_elements(r.passengers) AS passenger
            WHERE (passenger->>'id')::UUID = p.id
        )
    END AS pin
FROM public.rides r
    CROSS JOIN UNNEST(r.participant_ids) AS pid
    JOIN public.profiles p ON p.id = pid
WHERE r.id = p_ride_id;
END;
$$ LANGUAGE plpgsql STABLE;
-- ==========================================
-- FUNCIÓN: get_nearby_rides
-- Obtener viajes cercanos a un punto
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_nearby_rides(
        p_lat FLOAT,
        p_lng FLOAT,
        p_radius_km FLOAT DEFAULT 10.0,
        p_departure_date DATE DEFAULT NULL
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance_km FLOAT
    ) AS $$
DECLARE v_point GEOGRAPHY;
BEGIN v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    ST_Distance(r.origin_location, v_point) / 1000 AS distance_km
FROM public.rides r
WHERE r.status = 'scheduled'
    AND r.seats_available > 0
    AND r.departure_time > NOW()
    AND ST_DWithin(r.origin_location, v_point, p_radius_km * 1000)
    AND (
        p_departure_date IS NULL
        OR DATE(r.departure_time) = p_departure_date
    )
ORDER BY ST_Distance(r.origin_location, v_point) ASC
LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;
-- ==========================================
-- FUNCIÓN: verify_passenger
-- Verificar un pasajero con PIN
-- ==========================================
CREATE OR REPLACE FUNCTION public.verify_passenger(
        p_ride_id UUID,
        p_passenger_id UUID,
        p_pin TEXT
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_passengers JSONB;
v_correct_pin TEXT;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener información del viaje
SELECT driver_id,
    passengers INTO v_driver_id,
    v_passengers
FROM public.rides
WHERE id = p_ride_id;
IF v_driver_id != auth.uid() THEN RAISE EXCEPTION 'Solo el conductor puede verificar pasajeros';
END IF;
-- Buscar el PIN correcto
SELECT (passenger->>'pin')::TEXT INTO v_correct_pin
FROM jsonb_array_elements(v_passengers) AS passenger
WHERE (passenger->>'id')::UUID = p_passenger_id;
IF v_correct_pin IS NULL THEN RAISE EXCEPTION 'Pasajero no encontrado';
END IF;
IF v_correct_pin != p_pin THEN RAISE EXCEPTION 'PIN incorrecto';
END IF;
-- Actualizar estado del pasajero a 'verified'
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (passenger->>'id')::UUID = p_passenger_id THEN jsonb_set(passenger, '{status}', '"verified"')
                    ELSE passenger
                END
            )
        FROM jsonb_array_elements(passengers) AS passenger
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Pasajero verificado'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: clean_expired_requests
-- Limpiar solicitudes expiradas (llamar con cron job)
-- ==========================================
CREATE OR REPLACE FUNCTION public.clean_expired_requests() RETURNS JSON AS $$
DECLARE v_expired_pending INTEGER := 0;
v_expired_accepted INTEGER := 0;
r RECORD;
BEGIN -- 1. Expirar solicitudes pendientes (caducidad natural de la solicitud) y notificar
FOR r IN
SELECT id,
    requester_id,
    destination->>'name' AS dest
FROM public.ride_requests
WHERE status = 'pending'
    AND expires_at < NOW() LOOP
UPDATE public.ride_requests
SET status = 'expired'
WHERE id = r.id;
v_expired_pending := v_expired_pending + 1;
PERFORM public.create_notification(
    r.requester_id,
    'Solicitud expirada',
    'Tu solicitud para ' || COALESCE(r.dest, 'esta ruta') || ' ha expirado.',
    'warning',
    jsonb_build_object('request_id', r.id)
);
END LOOP;
-- 2. Revertir solicitudes aceptadas que no fueron pagadas a tiempo
-- Vuelven a 'pending' para que otros conductores puedan verlas (si no ha pasado su expires_at)
FOR r IN
SELECT id,
    requester_id,
    destination->>'name' AS dest
FROM public.ride_requests
WHERE status = 'accepted'
    AND payment_expires_at < NOW()
    AND expires_at > NOW() LOOP
UPDATE public.ride_requests
SET status = 'pending',
    matched_ride_id = NULL,
    payment_expires_at = NULL
WHERE id = r.id;
v_expired_accepted := v_expired_accepted + 1;
PERFORM public.create_notification(
    r.requester_id,
    'Pago expirado',
    'Tu solicitud aceptada para ' || COALESCE(r.dest, 'esta ruta') || ' volvió a estado pendiente por no completar el pago a tiempo.',
    'info',
    jsonb_build_object('request_id', r.id)
);
END LOOP;
-- 3. Expirar definitivamente las aceptadas cuyo tiempo total ya pasó
FOR r IN
SELECT id,
    requester_id,
    destination->>'name' AS dest
FROM public.ride_requests
WHERE status = 'accepted'
    AND expires_at < NOW() LOOP
UPDATE public.ride_requests
SET status = 'expired'
WHERE id = r.id;
PERFORM public.create_notification(
    r.requester_id,
    'Solicitud expirada',
    'Tu solicitud aceptada para ' || COALESCE(r.dest, 'esta ruta') || ' ha expirado definitivamente.',
    'warning',
    jsonb_build_object('request_id', r.id)
);
END LOOP;
RETURN json_build_object(
    'success',
    true,
    'expired_pending',
    v_expired_pending,
    'reverted_accepted',
    v_expired_accepted
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ==========================================
-- FUNCIÓN: submit_reviews
-- Enviar valoraciones para un viaje
-- ==========================================
CREATE OR REPLACE FUNCTION public.submit_reviews(
        p_ride_id UUID,
        p_reviews JSONB -- [{target_id: UUID, rating: INT, comment: TEXT}]
    ) RETURNS JSON AS $$
DECLARE v_author_id UUID;
v_review JSONB;
BEGIN v_author_id := auth.uid();
IF v_author_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Iterar sobre las reviews
FOR v_review IN
SELECT *
FROM jsonb_array_elements(p_reviews) LOOP -- Insertar review
INSERT INTO public.reviews (
        ride_id,
        author_id,
        target_id,
        rating,
        comment
    )
VALUES (
        p_ride_id,
        v_author_id,
        (v_review->>'target_id')::UUID,
        (v_review->>'rating')::INTEGER,
        v_review->>'comment'
    ) ON CONFLICT (ride_id, author_id, target_id) DO NOTHING;
-- Actualizar perfil del objetivo (recalculando el promedio)
UPDATE public.profiles
SET rating = CASE
        WHEN review_count = 0 THEN (v_review->>'rating')::DECIMAL
        ELSE (
            (rating * review_count) + (v_review->>'rating')::INTEGER
        ) / (review_count + 1)
    END,
    review_count = review_count + 1
WHERE id = (v_review->>'target_id')::UUID;
END LOOP;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;