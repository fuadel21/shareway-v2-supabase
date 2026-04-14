-- ==========================================
-- SCRIPT DE SEGURIDAD: OCULTAMIENTO DE PIN
-- ==========================================

-- 1. FUNCIÓN SEGURA PARA DETALLES DE VIAJE
-- Devuelve los detalles del viaje pero ELIMINA el campo PIN de los pasajeros
-- e incluye la información del conductor (similar a select *, driver:profiles(*))
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride JSONB;
    v_driver JSONB;
    v_passengers JSONB;
BEGIN
    SELECT to_jsonb(r) INTO v_ride
    FROM public.rides r
    WHERE r.id = p_ride_id;

    IF v_ride IS NULL THEN
        RETURN NULL;
    END IF;

    -- Obtener datos del conductor
    SELECT to_jsonb(p) INTO v_driver
    FROM public.profiles p
    WHERE p.id = (v_ride->>'driver_id')::UUID;

    -- Añadir driver al objeto ride
    v_ride := jsonb_set(v_ride, '{driver}', COALESCE(v_driver, '{}'::jsonb));

    -- Limpiar PINs del array de pasajeros
    SELECT jsonb_agg(
        p - 'pin'  -- Eliminar clave 'pin' de cada objeto pasajero
    ) INTO v_passengers
    FROM jsonb_array_elements(v_ride->'passengers') AS p;

    -- Reemplazar el array de pasajeros original con el limpio
    v_ride := jsonb_set(
        v_ride, 
        '{passengers}', 
        COALESCE(v_passengers, '[]'::jsonb)
    );

    RETURN v_ride;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. FUNCIÓN PARA OBTENER MI PROPIO PIN
-- Solo devuelve el PIN si el usuario es el pasajero correspondiente
CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_pin TEXT;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    SELECT p->>'pin' INTO v_pin
    FROM public.rides r,
         jsonb_array_elements(r.passengers) p
    WHERE r.id = p_ride_id
    AND (p->>'id')::UUID = v_user_id;

    RETURN v_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. FUNCIÓN DE BÚSQUEDA SEGURA
-- Versión segura de search_rides que no expone PINs
CREATE OR REPLACE FUNCTION public.search_rides_secure(
    p_origin JSONB,
    p_destination JSONB,
    p_date DATE
)
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    distance DECIMAL,
    is_women_only BOOLEAN,
    passengers_count INTEGER -- Solo devolvemos la cuenta, no el JSON completo con PINs
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.distance,
        r.is_women_only,
        jsonb_array_length(r.passengers)
    FROM public.rides r
    WHERE 
        -- Filtro geoespacial básico (se puede mejorar con PostGIS si está habilitado)
        -- Aquí simplificado para demostración, asumiendo que el frontend filtra más
        r.status = 'scheduled'
        AND r.departure_time > NOW()
        AND r.seats_available > 0
        AND r.departure_time::DATE = p_date
    ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Resumen
DO $$
BEGIN
    RAISE NOTICE '✅ Funciones de seguridad creadas:';
    RAISE NOTICE '   - get_ride_details_secure: Limpia PINs del JSON público';
    RAISE NOTICE '   - get_my_ride_pin: Permite al usuario ver SOLO su PIN';
    RAISE NOTICE '   - search_rides_secure: Búsqueda segura sin data sensible';
END $$;
