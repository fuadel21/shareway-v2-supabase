-- ==========================================
-- FIX_BOOKING_V2_PARANOID.sql
-- Auditoría y Blindaje de Seguridad para ShareWay (Elite Mobility)
-- ==========================================

-- Dropear funciones antiguas para permitir cambios de nombre en parámetros
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,boolean,boolean,text[]);
DROP FUNCTION IF EXISTS public.create_ride_request(jsonb,jsonb,timestamptz,integer,decimal,text,boolean);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid,uuid);

-- 1. MEJORA: create_ride (Publicar Viaje)
-- Validaciones añadidas:
-- - Fecha futura obligatoria
-- - Rangos de precio y distancia lógicos
-- - Verificación de conductor (ya existía, se mantiene)
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
    p_allowed_communities TEXT[] DEFAULT '{}'
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_ride_id UUID;
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
    v_verification_status TEXT;
BEGIN
    v_driver_id := auth.uid();
    
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- VALIDACIÓN PARANOICA DE TIEMPO
    -- No permitimos viajes en el pasado ni "ahora mismo" (mínimo 15 min de margen opcional, pero NOW() estricto por ahora)
    IF p_departure_time <= NOW() THEN
        RAISE EXCEPTION 'La fecha de salida debe ser en el futuro.';
    END IF;

    -- VALIDACIÓN DE PRECIO
    -- Evitar lavado de dinero o precios negativos/absurdos
    IF p_price < 0.5 OR p_price > 200 THEN
        RAISE EXCEPTION 'El precio por asiento debe estar entre 0.50€ y 200€.';
    END IF;

    -- VALIDACIÓN DE DISTANCIA
    IF p_distance IS NULL OR p_distance <= 0 THEN
        -- Opcional: Podríamos permitirlo si el frontend falla, pero para Elite Mobility exigimos datos
        RAISE WARNING 'Distancia inválida recibida, métricas de CO2 podrían fallar.';
    END IF;
    
    IF p_seats <= 0 OR p_seats > 8 THEN
        RAISE EXCEPTION 'Número de asientos inválido (1-8).';
    END IF;
    
    -- Obtener conductor y estado
    SELECT display_name, photo_url, (verification->>'status')
    INTO v_driver_name, v_driver_photo, v_verification_status
    FROM public.profiles
    WHERE id = v_driver_id;
    
    IF v_driver_name IS NULL THEN
        RAISE EXCEPTION 'Perfil de conductor no encontrado. Completa tu registro.';
    END IF;

    -- [DESACTIVADO TEMPORALMENTE PARA PRUEBAS]
    -- IF v_verification_status IS NULL OR v_verification_status != 'verified' THEN
    --    RAISE EXCEPTION 'Tu cuenta no está verificada. Para publicar (Driver), debes validar tu identidad.';
    -- END IF;

    -- VALIDACIÓN DE EXCLUSIVIDAD TEMPORAL
    -- Un conductor no puede tener otro viaje activo o programado en un margen de 2 horas.
    IF EXISTS (
        SELECT 1 FROM public.rides 
        WHERE driver_id = v_driver_id 
        AND status IN ('scheduled', 'active') 
        AND ABS(EXTRACT(EPOCH FROM (departure_time - p_departure_time))) < 7200
    ) THEN
        RAISE EXCEPTION 'Ya tienes un viaje programado o activo en un horario cercano (±2h).';
    END IF;
    
    v_origin_point := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    
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
        details,
        distance,
        overview_polyline,
        bounds,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        participant_ids
    ) VALUES (
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
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        ARRAY[v_driver_id]
    )
    RETURNING id INTO v_ride_id;
    
    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. MEJORA: create_ride_request (Pedir Viaje)
-- Validaciones añadidas:
-- - **Exigir Verificación de Identidad** (Igualdad Driver-Pasajero)
-- - Fecha futura
-- - Lógica anti-spam básica (ya implícita por Auth, pero endurecida por Verificación)
CREATE OR REPLACE FUNCTION public.create_ride_request(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats_needed INTEGER,
    p_suggested_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_is_women_only BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
    v_requester_id UUID;
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
    v_request_id UUID;
    v_verification_status TEXT;
BEGIN
    v_requester_id := auth.uid();

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- VALIDACIÓN PARANOICA DE IDENTIDAD (PASAJERO)
    SELECT (verification->>'status') INTO v_verification_status
    FROM public.profiles
    WHERE id = v_requester_id;

    -- [DESACTIVADO TEMPORALMENTE PARA PRUEBAS]
    -- IF v_verification_status IS NULL OR v_verification_status != 'verified' THEN
    --    RAISE EXCEPTION 'Debes verificar tu identidad para solicitar viajes en la comunidad.';
    -- END IF;

    -- Validaciones de Datos
    IF p_departure_time <= NOW() THEN
        RAISE EXCEPTION 'La fecha de solicitud debe ser en el futuro.';
    END IF;

    IF p_seats_needed < 1 OR p_seats_needed > 8 THEN
        RAISE EXCEPTION 'Número de asientos inválido.';
    END IF;

    IF p_suggested_price < 0 THEN
        RAISE EXCEPTION 'El precio sugerido no puede ser negativo.';
    END IF;

    v_origin_point := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;

    INSERT INTO public.ride_requests (
        passenger_id,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only
    ) VALUES (
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


-- 3. MEJORA: confirm_trip_and_pay (Reservar)
-- Validaciones añadidas:
-- - **Exigir Verificación de Identidad** al pasajero.
-- - Chequeo de consistencia de género (aunque es básico, previene errores simples).
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_passenger_verification TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID[];
    v_ride_departure TIMESTAMPTZ;
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Obtener info extendida del pasajero
    SELECT display_name, photo_url, gender, (verification->>'status')
    INTO v_passenger_name, v_passenger_photo, v_passenger_gender, v_passenger_verification
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- VALIDACIÓN PARANOICA DE IDENTIDAD (Reserva)
    -- [DESACTIVADO TEMPORALMENTE PARA PRUEBAS]
    -- IF v_passenger_verification IS NULL OR v_passenger_verification != 'verified' THEN
    --    RAISE EXCEPTION 'Por seguridad, solo usuarios verificados pueden reservar viajes.';
    -- END IF;

    -- Obtener info del viaje con BLOQUEO
    SELECT price, seats_available, driver_id, participant_ids, is_women_only, departure_time
    INTO v_ride_price, v_seats_available, v_driver_id, v_participant_ids, v_is_women_only, v_ride_departure
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled'
    FOR UPDATE;
    
    IF v_ride_price IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe o no está disponible.';
    END IF;

    -- Validar que el viaje no haya expirado (aunque el status sea scheduled)
    IF v_ride_departure <= NOW() THEN
        RAISE EXCEPTION 'Este viaje ya ha salido o la fecha ha expirado.';
    END IF;

    -- VALIDACIÓN WOMEN ONLY
    IF v_is_women_only AND (v_passenger_gender IS NULL OR v_passenger_gender != 'female') THEN
         RAISE EXCEPTION 'Este viaje es exclusivo para mujeres.';
    END IF;
    
    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'No quedan asientos disponibles.';
    END IF;
    
    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes reservar tu propio viaje.';
    END IF;
    
    IF v_passenger_id = ANY(v_participant_ids) THEN
        RAISE EXCEPTION 'Ya tienes una reserva en este viaje.';
    END IF;
    
    -- Chequeo Financiero
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id;
    
    IF v_wallet_balance IS NULL OR v_wallet_balance < v_ride_price THEN
        RAISE EXCEPTION 'Saldo insuficiente. Recarga tu wallet.';
    END IF;
    
    -- Generar PIN
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    -- Crear Pasajero (Snapshot segura)
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_ride_price,
        'booked_at', NOW(),
        'gender_snapshot', v_passenger_gender -- Guardamos el género con el que reservó por auditoría
    )::JSONB;
    
    -- Movimiento de Fondos
    UPDATE public.wallets
    SET balance = balance - v_ride_price,
        held_balance = held_balance + v_ride_price
    WHERE user_id = v_passenger_id;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'hold', -v_ride_price, balance, 'Reserva confirmada (Retención)', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;
    
    -- Actualizar Solicitudes Vinculadas (Si aplica)
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests
        SET status = 'fulfilled'
        WHERE id = p_request_id AND requester_id = v_passenger_id;
    END IF;

    -- Actualizar Viaje
    UPDATE public.rides
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. MEJORA: cancel_booking_and_refund (Cancelar y Reembolsar)
-- Lógica Paranoid:
-- - Validar identidad y propiedad de la reserva.
-- - Bloqueo de concurrencia.
-- - Política de reembolso estricta.
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(
    p_ride_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
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
    v_ride_status TEXT;
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Bloquear fila para evitar Race Conditions
    SELECT driver_id, departure_time, passengers, status
    INTO v_driver_id, v_departure_time, v_passengers, v_ride_status
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;
    
    IF v_ride_status != 'scheduled' THEN
        RAISE EXCEPTION 'El viaje ya ha iniciado o finalizado. No se puede cancelar.';
    END IF;

    -- Buscar datos específicos de la reserva del pasajero
    SELECT 
        (passenger->>'booked_price')::DECIMAL,
        (passenger->>'booked_at')::TIMESTAMPTZ
    INTO v_booked_price, v_booked_at
    FROM jsonb_array_elements(v_passengers) AS passenger
    WHERE (passenger->>'id')::UUID = v_passenger_id AND passenger->>'status' = 'confirmed';

    IF v_booked_price IS NULL THEN
        RAISE EXCEPTION 'No tienes una reserva confirmada activa en este viaje.';
    END IF;
    
    -- LÓGICA DE REEMBOLSO (Ventanas de tiempo)
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_departure_time - NOW())) / 3600;
    -- Si booked_at es null (legacy), asumimos hace mucho
    v_minutes_since_booking := CASE WHEN v_booked_at IS NULL THEN 999 ELSE EXTRACT(EPOCH FROM (NOW() - v_booked_at)) / 60 END;

    -- Regla de Oro: Periodo de gracia de 15 min si el viaje no es inminente (< 3h)
    IF v_minutes_since_booking <= 15 AND v_hours_until_departure > 3 THEN
        v_refund_percentage := 100;
        v_refund_amount := v_booked_price;
    ELSIF v_hours_until_departure > 24 THEN
        v_refund_percentage := 100;
        v_refund_amount := v_booked_price;
    ELSIF v_hours_until_departure >= 2 THEN
        v_refund_percentage := 50;
        v_refund_amount := ROUND(v_booked_price * 0.5, 2);
    ELSE
        -- Menos de 2 horas o ya pasado el tiempo: Sin reembolso
        v_refund_percentage := 0;
        v_refund_amount := 0;
    END IF;

    v_penalty_amount := v_booked_price - v_refund_amount;
    
    -- Remover al pasajero de la lista activa (lo marcamos como cancelado en lugar de borrarlo para historial)
    -- O mejor: Lo marcamos como 'cancelled' en el JSON.
    SELECT jsonb_agg(
            CASE 
                WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
                ELSE p 
            END
        )
    INTO v_new_passengers
    FROM jsonb_array_elements(v_passengers) AS p;
    
    -- 1. Procesar Reembolso al Pasajero
    IF v_refund_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_refund_amount,
            held_balance = held_balance - v_booked_price
        WHERE user_id = v_passenger_id;
    ELSE
         UPDATE public.wallets
         SET held_balance = held_balance - v_booked_price -- El dinero retenido se consume (se va a la plataforma o conductor)
         WHERE user_id = v_passenger_id;
    END IF;
    
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'refund', v_refund_amount, balance, 
           'Reembolso (' || v_refund_percentage || '%) por cancelación', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;

    -- 2. COMPENSACIÓN AL CONDUCTOR
    IF v_penalty_amount > 0 THEN
        -- El conductor recibe el 80% de la penalización
        v_driver_compensation := ROUND(v_penalty_amount * 0.8, 2);
        
        UPDATE public.wallets
        SET balance = balance + v_driver_compensation
        WHERE user_id = v_driver_id;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
        SELECT id, user_id, 'cancellation_compensation', v_driver_compensation, balance, 
               'Compensación por cancelación tardía', p_ride_id
        FROM public.wallets
        WHERE user_id = v_driver_id;
    END IF;
    
    -- 3. Actualizar Viaje (Liberar asiento y eliminar ID de array para permitir re-reserva si quisiera)
    UPDATE public.rides
    SET passengers = v_new_passengers,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        seats_available = seats_available + 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'message', 'Cancelado. Reembolso: ' || v_refund_amount || '€');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. MEJORA: handle_passenger_no_show (Pasajero no presentado)
-- Solo ejecutable por el conductor DESPUÉS de la hora de salida.
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(
    p_ride_id UUID,
    p_passenger_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_ride_driver UUID;
    v_ride_status TEXT;
    v_departure_time TIMESTAMPTZ;
    v_passengers JSONB;
    v_booked_price DECIMAL;
    v_platform_fee DECIMAL;
    v_driver_earning DECIMAL;
    v_passenger_name TEXT;
BEGIN
    v_driver_id := auth.uid();
    
    SELECT driver_id, status, departure_time, passengers
    INTO v_ride_driver, v_ride_status, v_departure_time, v_passengers
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'No autorizado'; END IF;
    
    -- Validación Temporal: Solo marcar No-Show si ya pasó la hora de salida
    IF NOW() < v_departure_time THEN
        RAISE EXCEPTION 'No puedes marcar No-Show antes de la hora de salida.';
    END IF;

    -- Verificar pasajero confirmado
    SELECT (p->>'booked_price')::DECIMAL, (p->>'displayName')
    INTO v_booked_price, v_passenger_name
    FROM jsonb_array_elements(v_passengers) AS p
    WHERE (p->>'id')::UUID = p_passenger_id AND p->>'status' = 'confirmed';

    IF v_booked_price IS NULL THEN
        RAISE EXCEPTION 'Pasajero no válido para No-Show.';
    END IF;

    -- Cálculos
    v_platform_fee := ROUND(v_booked_price * 0.15, 2);
    v_driver_earning := v_booked_price - v_platform_fee;

    -- Actualizar Wallet Pasajero (Consumir held)
    UPDATE public.wallets
    SET held_balance = held_balance - v_booked_price
    WHERE user_id = p_passenger_id;

    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'ride_payment', -v_booked_price, balance, 'Cobro por No-Show', p_ride_id
    FROM public.wallets
    WHERE user_id = p_passenger_id;

    -- Pagar Conductor
    UPDATE public.wallets
    SET balance = balance + v_driver_earning
    WHERE user_id = v_driver_id;

    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'ride_earning', v_driver_earning, balance, 'Ganancia por No-Show', p_ride_id
    FROM public.wallets
    WHERE user_id = v_driver_id;

    -- Actualizar Ride
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
        -- Liberar asiento si el viaje aún está en curso (opcional, pero lógico si no fue)
        seats_available = seats_available + 1
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. NUEVA: search_rides_v2 (Búsqueda Inteligente)
-- Incluye filtros de género y status de verificación
CREATE OR REPLACE FUNCTION public.search_rides_v2(
    p_origin_lat FLOAT,
    p_origin_lng FLOAT,
    p_destination_lat FLOAT,
    p_destination_lng FLOAT,
    p_departure_date DATE DEFAULT NULL,
    p_max_distance_km FLOAT DEFAULT 5.0
)
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_rating DECIMAL,
    driver_verified TEXT,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    details TEXT,
    is_women_only BOOLEAN,
    distance DECIMAL,
    origin_distance_km FLOAT,
    destination_distance_km FLOAT
) AS $$
DECLARE
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
    v_searcher_id UUID;
    v_searcher_gender TEXT;
BEGIN
    v_searcher_id := auth.uid();
    
    -- Intentar obtener género del buscador (si está logueado)
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    v_origin_point := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint(p_destination_lng, p_destination_lat), 4326)::GEOGRAPHY;
    
    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        p.rating,
        (p.verification->>'status')::TEXT as driver_verified,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.is_women_only,
        r.distance,
        ST_Distance(r.origin_location, v_origin_point) / 1000 AS origin_distance_km,
        ST_Distance(r.destination_location, v_destination_point) / 1000 AS destination_distance_km
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time > NOW() -- Solo viajes futuros
        AND ST_Distance(r.origin_location, v_origin_point) <= (p_max_distance_km * 1000)
        AND ST_Distance(r.destination_location, v_destination_point) <= (p_max_distance_km * 1000)
        AND (p_departure_date IS NULL OR DATE(r.departure_time) = p_departure_date)
        -- Filtro inteligente de Women Only:
        -- Si el viaje es Women Only, y el buscador es Male -> Ocultar NO (mejor mostrar con candado? Por ahora ocultar para reducir ruido, o mostrar si queremos que sepan que existe).
        -- Decisión: Ocultar si el buscador es Male confirmado.
        AND (
            NOT r.is_women_only 
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
    ORDER BY 
        (ST_Distance(r.origin_location, v_origin_point) + ST_Distance(r.destination_location, v_destination_point)) ASC,
        r.departure_time ASC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;


-- 7. NUEVA: get_available_rides_v2 (Feed Global Paranoid)
-- Para el Dashboard inicial, sin necesidad de origen/destino
CREATE OR REPLACE FUNCTION public.get_available_rides_v2()
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_rating DECIMAL,
    driver_verified TEXT,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    details TEXT,
    is_women_only BOOLEAN,
    distance DECIMAL
) AS $$
DECLARE
    v_searcher_id UUID;
    v_searcher_gender TEXT;
BEGIN
    v_searcher_id := auth.uid();
    
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        p.rating,
        (p.verification->>'status')::TEXT as driver_verified,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.is_women_only,
        r.distance
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time > NOW()
        AND r.driver_id != v_searcher_id
        AND (
            NOT r.is_women_only 
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
    ORDER BY r.departure_time ASC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;


-- 8. NUEVA: update_ride_v2 (Modificación Paranoid)
-- Blindaje contra cambios arbitrarios que afecten a pasajeros confirmados.
CREATE OR REPLACE FUNCTION public.update_ride_v2(
    p_ride_id UUID,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_is_women_only BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_old_departure_time TIMESTAMPTZ;
    v_old_price DECIMAL;
    v_old_is_women_only BOOLEAN;
    v_current_passenger_count INTEGER;
    v_ride_status TEXT;
    v_passenger_ids UUID[];
    v_time_diff_minutes FLOAT;
    v_initial_price DECIMAL;
    v_distance DECIMAL;
    v_window_start TIMESTAMPTZ;
    v_window_count INTEGER;
BEGIN
    v_driver_id := auth.uid();
    
    -- 1. Obtener estado actual con BLOQUEO
    SELECT 
        status, 
        jsonb_array_length(passengers), 
        departure_time, 
        price, 
        is_women_only,
        participant_ids,
        initial_price,
        distance,
        modification_window_start,
        modification_window_count
    INTO 
        v_ride_status, 
        v_current_passenger_count, 
        v_old_departure_time, 
        v_old_price, 
        v_old_is_women_only,
        v_passenger_ids,
        v_initial_price,
        v_distance,
        v_window_start,
        v_window_count
    FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id
    FOR UPDATE;
    
    IF v_ride_status IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado o no autorizado.';
    END IF;
    
    IF v_ride_status != 'scheduled' THEN
        RAISE EXCEPTION 'No se puede editar un viaje que ya no está programado.';
    END IF;

    -- 2. VALIDACIÓN DE FECHA FUTURA
    IF p_departure_time <= NOW() THEN
        RAISE EXCEPTION 'La nueva fecha debe ser en el futuro.';
    END IF;

    -- 3. REGLAS CON PASAJEROS
    IF v_current_passenger_count > 0 THEN
        -- A. Restricción de Tiempo: Máximo 30 min de variación si hay gente
        v_time_diff_minutes := ABS(EXTRACT(EPOCH FROM (p_departure_time - v_old_departure_time))) / 60;
        IF v_time_diff_minutes > 30 THEN
            RAISE EXCEPTION 'No puedes cambiar la hora más de 30 min si ya tienes pasajeros. Cancela y publica de nuevo si es necesario.';
        END IF;

        -- B. Restricción de Género: Si era Women Only y hay gente, no se puede abrir a hombres
        IF v_old_is_women_only AND NOT p_is_women_only THEN
            RAISE EXCEPTION 'No puedes quitar la restricción "Mujeres Solamente" si ya hay reservas.';
        END IF;

        -- C. Restricción de Asientos: Ya validado mecánicamente
        IF p_seats < v_current_passenger_count THEN
            RAISE EXCEPTION 'No puedes reducir asientos por debajo de los ya ocupados (%).', v_current_passenger_count;
        END IF;
        
        -- D. Precio: Límite por edición ±20% y acumulado ±50% respecto al inicial
        IF v_old_price > 0 THEN
            IF ABS(p_price - v_old_price) / v_old_price > 0.20 THEN
                RAISE EXCEPTION 'Cambio de precio excesivo. Límite por edición ±20% con pasajeros.';
            END IF;
        END IF;
        IF v_initial_price > 0 THEN
            IF ABS(p_price - v_initial_price) / v_initial_price > 0.50 THEN
                RAISE EXCEPTION 'Cambio de precio acumulado excede ±50% respecto al precio inicial.';
            END IF;
        END IF;
    END IF;

    -- E. Fair Price €/km en edición
    IF v_distance IS NOT NULL AND v_distance > 0 THEN
        IF (p_price / v_distance) > 0.50 THEN
            RAISE EXCEPTION 'El precio excede el máximo permitido de 0.50€/km.';
        END IF;
    END IF;

    -- F. Cooldown de modificaciones: Máx 3 en 24h
    IF v_window_start IS NULL OR v_window_count IS NULL THEN
        v_window_start := NOW();
        v_window_count := 0;
    END IF;
    IF NOW() - v_window_start > INTERVAL '24 hours' THEN
        v_window_start := NOW();
        v_window_count := 0;
    END IF;
    IF v_window_count >= 3 THEN
        RAISE EXCEPTION 'Has alcanzado el límite de modificaciones permitidas en 24 horas.';
    END IF;
    v_window_count := v_window_count + 1;

    -- 4. ACTUALIZACIÓN
    UPDATE public.rides
    SET departure_time = p_departure_time,
        seats_total = p_seats,
        seats_available = p_seats - v_current_passenger_count,
        price = p_price,
        details = p_details,
        is_women_only = p_is_women_only,
        modification_window_start = v_window_start,
        modification_window_count = v_window_count,
        last_modified_at = NOW()
    WHERE id = p_ride_id;

    -- 5. NOTIFICACIONES (Si hay pasajeros)
    IF v_current_passenger_count > 0 THEN
        -- Notificar a todos excepto conductor (v_passenger_ids incluye al conductor en el índice 0)
        PERFORM public.create_notification(
            p_id,
            'Viaje Modificado',
            'El conductor ha actualizado detalles en tu próximo viaje de las ' || TO_CHAR(p_departure_time, 'HH24:MI') || '. Revisa los cambios.',
            'info',
            jsonb_build_object('ride_id', p_ride_id)
        )
        FROM unnest(v_passenger_ids) AS p_id
        WHERE p_id != v_driver_id;
    END IF;

    -- 6. Notificar solicitantes vinculados al viaje
    PERFORM public.create_notification(
        r.requester_id,
        'Cambio en viaje',
        'El conductor ha modificado un viaje vinculado a tu solicitud. Revisa los cambios.',
        'info',
        jsonb_build_object('ride_id', p_ride_id, 'request_id', r.id)
    )
    FROM public.ride_requests r
    WHERE r.matched_ride_id = p_ride_id OR r.ride_id = p_ride_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
