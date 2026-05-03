-- ==========================================
-- 20260510_CREATE_RIDE_TIME_VALIDATION.sql
-- Seguridad: Impedir creación de viajes con fecha pasada.
-- ==========================================

-- 0. Limpieza agresiva para evitar errores de cambio de tipo de retorno
DROP FUNCTION IF EXISTS public.create_ride(jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
    v_profile RECORD;
BEGIN
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. VALIDACIÓN DE TIEMPO: No permitir viajes en el pasado
    -- Permitimos un margen de 5 minutos por si hay desfase de reloj entre cliente/servidor.
    IF p_departure_time < (NOW() - INTERVAL '5 minutes') THEN
        RAISE EXCEPTION 'LA_FECHA_DE_SALIDA_NO_PUEDE_SER_PASADA';
    END IF;

    -- 2. Control de Idempotencia
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF v_ride_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    -- 3. Desnormalización de Perfil (Driver Data Sync)
    SELECT full_name, display_name, photo_url INTO v_profile FROM public.profiles WHERE id = v_driver_id;

    INSERT INTO public.rides (
        driver_id, driver_display_name, driver_photo_url,
        origin, destination, origin_address, destination_address,
        departure_time, seats_available, seats_total, total_seats,
        price, details, distance, overview_polyline, waypoints,
        status, participant_ids, idempotency_key
    ) VALUES (
        v_driver_id, COALESCE(v_profile.display_name, v_profile.full_name), v_profile.photo_url,
        p_origin, p_destination, p_origin->>'address', p_destination->>'address',
        p_departure_time, p_seats, p_seats, p_seats,
        p_price, p_details, p_distance, p_overview_polyline, p_waypoints,
        'scheduled', ARRAY[v_driver_id], p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
