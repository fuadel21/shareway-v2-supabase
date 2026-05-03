-- ==========================================
-- 20260506_FIX_RIDE_RPC_STABILITY.sql
-- Reparación de Columnas de Asientos y RPCs
-- ==========================================

-- 1. Asegurar que ambas columnas existan para máxima compatibilidad
-- Algunos RPCs viejos usan seats_total, los nuevos "Elite" usan total_seats
DO $$
BEGIN
    -- Asegurar seats_total
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='seats_total') THEN
        ALTER TABLE public.rides ADD COLUMN seats_total INTEGER;
    END IF;

    -- Asegurar total_seats
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='total_seats') THEN
        ALTER TABLE public.rides ADD COLUMN total_seats INTEGER DEFAULT 4;
    END IF;
END $$;

-- 2. Sincronizar datos (por si una estaba poblada y la otra no)
UPDATE public.rides
SET
    seats_total = COALESCE(seats_total, total_seats, seats_available),
    total_seats = COALESCE(total_seats, seats_total, seats_available)
WHERE seats_total IS NULL OR total_seats IS NULL;

-- 3. Corregir get_available_rides_v2 para que no falle
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
        r.id as ride_id,
        r.driver_id,
        p.full_name as driver_name,
        p.photo_url as driver_photo,
        p.rating as driver_rating,
        r.origin,
        r.destination,
        r.departure_time,
        r.price,
        r.seats_available,
        COALESCE(r.seats_total, r.total_seats, 4) as seats_total,
        r.distance,
        COALESCE(r.is_women_only, false)
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
      AND r.seats_available > 0
      AND r.departure_time > NOW()
    ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 4. Actualizar create_ride para que inserte en ambas columnas
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
        seats_available, seats_total, total_seats, -- Las tres
        price, details, distance,
        overview_polyline, waypoints, status, participant_ids
    )
    VALUES (
        auth.uid(), p_origin, p_destination, p_departure_time,
        p_seats, p_seats, p_seats,
        p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[auth.uid()]
    )
    RETURNING id INTO v_new_id;

    RETURN json_build_object('success', true, 'rideId', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
