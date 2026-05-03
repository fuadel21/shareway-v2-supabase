-- ==============================================================================
-- 20260510_SCHEMA_STANDARDIZATION_TOTAL_SEATS.sql
-- Limpieza de Esquema: Unificación de asientos en la columna total_seats.
-- Mantiene compatibilidad con el frontend mediante alias en los RPCs.
-- ==============================================================================

DO $$
BEGIN
    -- 1. Migración de datos: Asegurar que total_seats esté poblado
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='seats_total') THEN
        UPDATE public.rides SET total_seats = COALESCE(total_seats, seats_total, seats_available);
    END IF;

    -- 2. Eliminar la columna duplicada
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='seats_total') THEN
        ALTER TABLE public.rides DROP COLUMN seats_total;
    END IF;
END $$;

-- 3. Actualizar create_ride (Versión Estandarizada)
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
) RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
    v_profile RECORD;
BEGIN
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- Validación de Tiempo
    IF p_departure_time < (NOW() - INTERVAL '5 minutes') THEN
        RAISE EXCEPTION 'LA_FECHA_DE_SALIDA_NO_PUEDE_SER_PASADA';
    END IF;

    -- Control de Idempotencia
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF v_ride_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    -- Desnormalización de Perfil
    SELECT full_name, display_name, photo_url INTO v_profile FROM public.profiles WHERE id = v_driver_id;

    INSERT INTO public.rides (
        driver_id, driver_display_name, driver_photo_url,
        origin, destination, origin_address, destination_address,
        departure_time, seats_available, total_seats,
        price, details, distance, overview_polyline, waypoints,
        status, participant_ids, idempotency_key
    ) VALUES (
        v_driver_id, COALESCE(v_profile.display_name, v_profile.full_name), v_profile.photo_url,
        p_origin, p_destination, p_origin->>'address', p_destination->>'address',
        p_departure_time, p_seats, p_seats,
        p_price, p_details, p_distance, p_overview_polyline, p_waypoints,
        'scheduled', ARRAY[v_driver_id], p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Actualizar get_ride_details_secure (Con Alias de Compatibilidad)
DROP FUNCTION IF EXISTS public.get_ride_details_secure(uuid);

CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_is_driver BOOLEAN;
    v_user_id   UUID := auth.uid()::UUID;
BEGIN
    SELECT (driver_id = v_user_id) INTO v_is_driver
    FROM public.rides WHERE id = p_ride_id;

    RETURN (
        SELECT json_build_object(
            'success', true,
            'data', json_build_object(
                'id',                  r.id,
                'driver_id',           r.driver_id,
                'status',              r.status,
                'origin',              r.origin,
                'destination',         r.destination,
                'origin_address',      COALESCE(r.origin_address, r.origin->>'address'),
                'destination_address', COALESCE(r.destination_address, r.destination->>'address'),
                'departure_time',      r.departure_time,
                'price',               r.price,
                'seats_available',     r.seats_available,
                'total_seats',         COALESCE(r.total_seats, 4),
                'seats_total',         COALESCE(r.total_seats, 4), -- Alias para compatibilidad frontend
                'distance',            r.distance,
                'waypoints',           r.waypoints,
                'overview_polyline',   r.overview_polyline,
                'vehicle_model',       r.vehicle_model,
                'vehicle_plate',       r.vehicle_plate,
                'driver', json_build_object(
                    'id',           p.id,
                    'display_name', COALESCE(p.display_name, p.full_name),
                    'avatar_url',   p.photo_url,
                    'rating',       p.rating,
                    'verified',     p.is_verified
                ),
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id',              prof.id,
                            'displayName',     COALESCE(prof.display_name, prof.full_name),
                            'avatarUrl',       prof.photo_url,
                            'status',          elem.val->>'status',
                            'pickup_address',  COALESCE(elem.val->>'pickup_address', r.origin->>'address'),
                            'pin', CASE
                                WHEN (elem.val->>'id')::UUID = v_user_id OR v_is_driver
                                THEN elem.val->>'pin'
                                ELSE '****'
                            END,
                            'num_seats',       COALESCE((elem.val->>'seats_booked')::int, (elem.val->>'seats')::int, 1)
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
