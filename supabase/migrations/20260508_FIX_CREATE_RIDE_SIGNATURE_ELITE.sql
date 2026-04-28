-- ========================================================
-- FIX: Sincronización de Firma create_ride (10 parámetros)
-- Corrige el error "Could not find the function" al incluir idempotency_key
-- ========================================================

-- 1. Limpieza de versiones anteriores para evitar ambigüedad
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb);
DROP FUNCTION IF EXISTS public.create_ride(jsonb,jsonb,timestamptz,integer,decimal,text,decimal,text,jsonb,uuid);

-- 2. Nueva definición con 10 parámetros (Sincronizada con rideService.js)
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
BEGIN
    -- Verificación de Sesión
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Sesión expirada o no válida. Por favor, inicia sesión de nuevo.';
    END IF;

    -- CONTROL DE IDEMPOTENCIA (Anti-Duplicados)
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF v_ride_id IS NOT NULL THEN
            -- Si ya existe, devolvemos el ID existente sin error (Silent Success)
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    -- Inserción de Viaje Elite
    INSERT INTO public.rides (
        driver_id,
        origin,
        destination,
        departure_time,
        seats_available,
        price,
        details,
        distance,
        overview_polyline,
        waypoints,
        status,
        participant_ids,
        idempotency_key
    ) VALUES (
        v_driver_id,
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_waypoints,
        'scheduled',
        ARRAY[v_driver_id],
        p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    -- Registro en Auditoría
    PERFORM public.log_platform_audit(
        'Operativo',
        'RIDE_CREATED',
        v_driver_id,
        jsonb_build_object('ride_id', v_ride_id, 'price', p_price, 'seats', p_seats)
    );

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Asegurar permisos
GRANT EXECUTE ON FUNCTION public.create_ride TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ride TO service_role;
