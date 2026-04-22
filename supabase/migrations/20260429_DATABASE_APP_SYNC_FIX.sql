-- ==============================================================================
-- SYNC FIX: REPARACIÓN DE RPCs PARA COMPATIBILIDAD CON ESQUEMA V4
-- ==============================================================================

-- 1. Asegurar que la columna seats_total existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='seats_total') THEN
        ALTER TABLE public.rides ADD COLUMN seats_total INTEGER;
    END IF;
END $$;

-- 2. FIX: create_ride (Ahora inserta seats_total)
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB, p_destination JSONB, p_departure_time TIMESTAMPTZ,
    p_seats INTEGER, p_price DECIMAL, p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0, p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::JSONB
) RETURNS JSON AS $$
DECLARE v_new_id UUID;
BEGIN
    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time,
        seats_available, seats_total, -- Insertamos ambos
        price, details, distance,
        overview_polyline, waypoints, status, participant_ids
    )
    VALUES (
        auth.uid(), p_origin, p_destination, p_departure_time,
        p_seats, p_seats, -- Al crear, total y available son iguales
        p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[auth.uid()]
    )
    RETURNING id INTO v_new_id;

    RETURN json_build_object('success', true, 'rideId', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FIX: get_available_rides_v2 (Resuelve ambigüedad de ID)
DROP FUNCTION IF EXISTS public.get_available_rides_v2();
CREATE OR REPLACE FUNCTION public.get_available_rides_v2()
RETURNS TABLE (
    ride_id UUID,
    driver_id UUID,
    driver_name TEXT,
    driver_photo TEXT,
    driver_rating NUMERIC,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    price NUMERIC,
    seats_available INTEGER,
    seats_total INTEGER,
    distance NUMERIC,
    is_women_only BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id as ride_id, -- Alias explícito
        r.driver_id,
        p.display_name as driver_name,
        p.photo_url as driver_photo,
        p.rating as driver_rating,
        r.origin,
        r.destination,
        r.departure_time,
        r.price,
        r.seats_available,
        r.seats_total,
        r.distance,
        r.is_women_only
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
      AND r.seats_available > 0
      AND r.departure_time > NOW()
      AND (p.verification->>'is_suspended')::BOOLEAN IS NOT TRUE
    ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
