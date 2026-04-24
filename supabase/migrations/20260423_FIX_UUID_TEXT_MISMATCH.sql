-- 1. LIMPIEZA DE FUNCIONES
DROP FUNCTION IF EXISTS public.create_ride(jsonb, jsonb, timestamptz, integer, decimal, text, decimal, text, jsonb);
DROP FUNCTION IF EXISTS public.create_ride(jsonb, jsonb, timestamptz, integer, decimal, text, decimal, text, jsonb, text);
DROP FUNCTION IF EXISTS public.create_ride(jsonb, jsonb, timestamptz, integer, decimal, text, decimal, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.get_ride_details_secure(uuid);
DROP FUNCTION IF EXISTS public.cancel_ride(uuid);

-- 2. DETALLES DEL VIAJE (CORREGIDO CON PRECIO)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_is_driver BOOLEAN;
    v_user_id UUID := auth.uid()::UUID;
BEGIN
    SELECT (driver_id = v_user_id) INTO v_is_driver
    FROM public.rides WHERE id = p_ride_id;

    RETURN (
        SELECT json_build_object(
            'success', true,
            'data', json_build_object(
                'id', r.id,
                'driver_id', r.driver_id,
                'driver_name', p.display_name,
                'driver_photo', p.photo_url,
                'driver_verified', (p.verification->>'status' = 'verified'),
                'origin', r.origin,
                'destination', r.destination,
                'departure_time', r.departure_time,
                'price', r.price,
                'status', r.status,
                'seats_available', r.seats_available,
                'distance', r.distance,
                'waypoints', r.waypoints,
                'overview_polyline', r.overview_polyline,
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', prof.id,
                            'displayName', prof.display_name,
                            'photo_url', prof.photo_url,
                            'status', elem.val->>'status',
                            'pickup_address', elem.val->>'pickup_address',
                            'pin', CASE
                                WHEN (elem.val->>'id')::UUID = v_user_id OR v_is_driver
                                THEN elem.val->>'pin'
                                ELSE '****'
                            END
                        )
                    )
                    FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem(val)
                    JOIN public.profiles prof ON (elem.val->>'id')::UUID = prof.id
                    WHERE elem.val->>'status' != 'cancelled'
                )
            )
        )
        FROM public.rides r
        JOIN public.profiles p ON r.driver_id = p.id
        WHERE r.id = p_ride_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. CANCELACIÓN DE VIAJE (CONDUCTOR)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_status TEXT;
BEGIN
    SELECT driver_id, status INTO v_driver_id, v_status
    FROM public.rides WHERE id = p_ride_id;

    IF v_driver_id != auth.uid()::UUID THEN
        RETURN jsonb_build_object('success', false, 'message', 'Solo el conductor puede cancelar el viaje');
    END IF;

    IF v_status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'message', 'El viaje ya ha finalizado o ha sido cancelado');
    END IF;

    -- Actualizar estado del viaje
    UPDATE public.rides
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Nota: Aquí podrías añadir lógica de reembolsos automáticos si usas una tabla de escrow/pagos
    -- Por ahora, marcamos como cancelado para liberar la interfaz.

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. CREACIÓN DE VIAJE (UNIFICADA)
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::JSONB,
    p_idempotency_key UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid()::UUID;
    v_ride_id UUID;
BEGIN
    IF v_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time,
        seats_available, seats_total, price, details, distance,
        overview_polyline, waypoints, status, participant_ids, idempotency_key
    ) VALUES (
        v_driver_id, p_origin, p_destination, p_departure_time,
        p_seats, p_seats, p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_driver_id], p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
