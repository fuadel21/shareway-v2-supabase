-- ========================================================
-- FIX_REPORTED_ERRORS.sql
-- Solución consolidada para errores 400, 404 y Mismatch
-- ========================================================
-- 1. EXTENSIÓN DE SCHEMA (Compatibilidad Frontend)
-- --------------------------------------------------------
-- Añadir is_verified a profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
-- Sincronizar is_verified con el objeto verification existente
UPDATE public.profiles
SET is_verified = (verification->>'status' = 'verified')
WHERE is_verified IS FALSE;
-- Añadir columnas faltantes a chats y messages
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'individual' CHECK (type IN ('group', 'individual', 'support'));
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '[]'::jsonb;
-- 2. CORRECCIÓN DE RPCS (get_ride_chats)
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_ride_chats(uuid);
CREATE OR REPLACE FUNCTION public.get_ride_chats(p_ride_id UUID) RETURNS TABLE (
        chat_id UUID,
        chat_type TEXT,
        participants UUID [],
        participant_names JSONB,
        last_message JSONB,
        unread_count INTEGER,
        ride_id UUID
    ) AS $$ BEGIN RETURN QUERY
SELECT c.id as chat_id,
    COALESCE(c.type, 'group') as chat_type,
    c.participants,
    (
        SELECT jsonb_object_agg(p.id, p.display_name)
        FROM public.profiles p
        WHERE p.id = ANY(c.participants)
    ) as participant_names,
    (
        SELECT json_build_object(
                'content',
                m.content,
                'created_at',
                m.created_at,
                'sender_id',
                m.sender_id
            )::JSONB
        FROM public.messages m
        WHERE m.chat_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
    ) as last_message,
    (
        SELECT COUNT(*)::INTEGER
        FROM public.messages m
        WHERE m.chat_id = c.id
            AND m.sender_id != auth.uid()
            AND NOT (m.read_by @> jsonb_build_array(auth.uid()))
    ) as unread_count,
    c.ride_id
FROM public.chats c
WHERE c.ride_id = p_ride_id
    AND auth.uid() = ANY(c.participants);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 3. CORRECCIÓN DE RPCS (complete_ride - Más permisivo)
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_ride(uuid);
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_ride_record RECORD;
v_passenger JSONB;
v_total_driver_payout DECIMAL := 0;
v_driver_id UUID;
v_platform_fee_percent DECIMAL := 0.10;
-- 10% Platform fee
BEGIN
SELECT * INTO v_ride_record
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- Permitimos completar desde scheduled, active o in_progress
IF v_ride_record.status NOT IN ('scheduled', 'active', 'in_progress') THEN RAISE EXCEPTION 'El viaje no se puede completar en su estado actual: %',
v_ride_record.status;
END IF;
v_driver_id := v_ride_record.driver_id;
-- Procesar pagos de pasajeros
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride_record.passengers) LOOP -- Consideramos como candidatos todos los que no hayan cancelado
    IF v_passenger->>'status' IN (
        'confirmed',
        'verified',
        'on_board',
        'confirmed_by_pin',
        'picked_up'
    ) THEN v_total_driver_payout := v_total_driver_payout + (v_passenger->>'booked_price')::DECIMAL;
-- Liberar el saldo retenido (held_balance -> 0)
UPDATE public.wallets
SET held_balance = held_balance - (v_passenger->>'booked_price')::DECIMAL,
    updated_at = NOW()
WHERE user_id = (v_passenger->>'id')::UUID;
END IF;
END LOOP;
-- Pagar al conductor (Menos comisión)
IF v_total_driver_payout > 0 THEN v_total_driver_payout := v_total_driver_payout * (1.0 - v_platform_fee_percent);
UPDATE public.wallets
SET balance = balance + v_total_driver_payout,
    updated_at = NOW()
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        user_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_driver_id,
        v_total_driver_payout,
        'payout',
        'Liquidación de viaje completado (Neto)',
        p_ride_id
    );
END IF;
-- Marcar como completado
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW(),
    updated_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Viaje completado y pagos liquidados',
    'payout',
    v_total_driver_payout
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. CORRECCIÓN DE RPCS (cancel_booking_and_refund - Blindado)
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid);
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_passenger_id UUID := auth.uid();
v_ride_record RECORD;
v_passenger_entry JSONB;
v_booked_price DECIMAL;
v_refund_amount DECIMAL;
v_penalty_amount DECIMAL;
v_penalty_percent DECIMAL := 0.20;
-- 20% penalización
BEGIN -- 1. Bloquear viaje
SELECT * INTO v_ride_record
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- 2. Buscar al pasajero
SELECT p INTO v_passenger_entry
FROM jsonb_array_elements(v_ride_record.passengers) AS p
WHERE (p->>'id')::UUID = v_passenger_id
    AND p->>'status' NOT IN ('cancelled', 'rejected');
IF v_passenger_entry IS NULL THEN RAISE EXCEPTION 'No tienes una reserva activa en este viaje';
END IF;
v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
v_penalty_amount := v_booked_price * v_penalty_percent;
v_refund_amount := v_booked_price - v_penalty_amount;
-- 3. Actualizar Wallet
UPDATE public.wallets
SET held_balance = GREATEST(held_balance - v_booked_price, 0),
    balance = balance + v_refund_amount,
    updated_at = NOW()
WHERE user_id = v_passenger_id;
-- 4. Transacciones
INSERT INTO public.transactions (
        user_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_passenger_id,
        v_refund_amount,
        'refund',
        'Reembolso por cancelación de reserva (Parcial)',
        p_ride_id
    );
-- 5. Actualizar Ride
UPDATE public.rides
SET seats_available = seats_available + 1,
    participant_ids = array_remove(participant_ids, v_passenger_id),
    passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = v_passenger_id
                    AND p->>'status' NOT IN ('cancelled', 'rejected') THEN p || jsonb_build_object('status', 'cancelled', 'cancelled_at', NOW())
                    ELSE p
                END
            )
        FROM jsonb_array_elements(v_ride_record.passengers) p
    ),
    updated_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Reserva cancelada y reembolso parcial procesado (80%)',
    'refunded',
    v_refund_amount
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Comentarios
COMMENT ON FUNCTION public.get_ride_chats IS 'Fix 400: Maneja columnas type y participant_names con COALESCE';
COMMENT ON FUNCTION public.complete_ride IS 'Fix 400: Permite completar desde scheduled y active';
COMMENT ON FUNCTION public.cancel_booking_and_refund IS 'Fix 404/400: Nueva versión robusta para cancelaciones';
-- 5. FUNCIÓN FALTANTE: search_rides_by_corridor
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_rides_by_corridor(float, float, float, float, date, float);
CREATE OR REPLACE FUNCTION public.search_rides_by_corridor(
        p_pax_origin_lat FLOAT,
        p_pax_origin_lng FLOAT,
        p_pax_dest_lat FLOAT,
        p_pax_dest_lng FLOAT,
        p_date DATE DEFAULT NULL,
        p_max_detour_meters FLOAT DEFAULT 2500
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
        distance DECIMAL,
        is_women_only BOOLEAN
    ) AS $$
DECLARE v_searcher_id UUID := auth.uid();
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
BEGIN IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(p_pax_origin_lng, p_pax_origin_lat),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(p_pax_dest_lng, p_pax_dest_lat),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status = 'scheduled'
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available > 0
    AND ST_Distance(r.origin_location, v_origin_geog) <= p_max_detour_meters
    AND ST_Distance(r.destination_location, v_dest_geog) <= p_max_detour_meters
    AND (
        NOT r.is_women_only
        OR (v_searcher_gender = 'female')
    )
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;