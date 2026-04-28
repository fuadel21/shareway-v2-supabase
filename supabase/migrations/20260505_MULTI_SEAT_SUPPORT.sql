-- ==========================================
-- 20260505_MULTI_SEAT_SUPPORT.sql
-- Auditoría y Mejora: Sistema Multi-Plaza Elite
-- ==========================================

-- 1. Limpieza de funciones antiguas (Evitar errores de cambio de firma)
DROP FUNCTION IF EXISTS public.fulfill_ride_request(uuid, jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, text, jsonb, numeric, integer);

-- 2. Asegurar que la tabla de solicitudes soporte pedir múltiples plazas
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS requested_seats INTEGER DEFAULT 1;

-- 3. Actualizar RESERVA DIRECTA para soportar múltiples plazas
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,
    p_num_seats INTEGER DEFAULT 1 -- Plazas a reservar
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_val_price NUMERIC;
    v_val_seats INTEGER;
    v_pin TEXT;
    v_total_cost NUMERIC;
BEGIN
    -- Bloqueo de fila para consistencia atómica
    SELECT price, seats_available INTO v_val_price, v_val_seats
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_val_price IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_val_seats < p_num_seats THEN RAISE EXCEPTION 'PLAZAS_INSUFICIENTES'; END IF;

    v_total_cost := COALESCE(p_price, v_val_price) * p_num_seats;
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Transacción financiera
    UPDATE public.wallets SET balance = balance - v_total_cost, held_balance = held_balance + v_total_cost WHERE user_id = v_me;

    -- Actualización de plazas y pasajeros
    UPDATE public.rides
    SET seats_available = seats_available - p_num_seats,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me,
            'status', 'confirmed',
            'pin', v_pin,
            'booked_price', COALESCE(p_price, v_val_price),
            'seats_booked', p_num_seats,
            'pickup_address', p_pickup_address
        )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_pin, 'total_paid', v_total_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Actualizar ACEPTAR SOLICITUD para descontar plazas dinámicamente
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_total INTEGER, -- Capacidad ofrecida por el conductor
        p_price_per_seat DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger_id UUID;
    v_requested_seats INTEGER;
    v_ride_id UUID;
    v_ride_res JSON;
    v_pin TEXT;
BEGIN
    -- Obtener datos de la solicitud y cuántas plazas requiere
    SELECT requester_id, COALESCE(requested_seats, 1) INTO v_passenger_id, v_requested_seats
    FROM public.ride_requests WHERE id = p_request_id FOR UPDATE;

    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'SOLICITUD_NO_ENCONTRADA'; END IF;

    -- Crear el viaje base con el total de plazas del conductor
    SELECT public.create_ride(
        p_origin, p_destination, p_departure_time, p_seats_total,
        p_price_per_seat, p_details, p_distance, p_overview_polyline, p_waypoints
    ) INTO v_ride_res;

    v_ride_id := (v_ride_res->>'rideId')::UUID;
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Vincular pasajero y restar plazas dinámicamente
    UPDATE public.rides
    SET
        passengers = jsonb_build_array(jsonb_build_object(
            'id', v_passenger_id,
            'status', 'confirmed',
            'pin', v_pin,
            'booked_price', p_price_per_seat,
            'seats_booked', v_requested_seats
        )),
        participant_ids = ARRAY[v_driver_id, v_passenger_id],
        seats_available = p_seats_total - v_requested_seats
    WHERE id = v_ride_id;

    -- Finalizar solicitud
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id,
        driver_id = v_driver_id
    WHERE id = p_request_id;

    RETURN json_build_object(
        'success', true,
        'rideId', v_ride_id,
        'remaining_seats', p_seats_total - v_requested_seats
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
