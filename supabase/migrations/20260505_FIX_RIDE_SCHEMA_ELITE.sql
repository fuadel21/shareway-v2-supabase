-- ==========================================
-- 20260505_FIX_RIDE_SCHEMA_ELITE.sql
-- Reparación de Columnas Faltantes en Rides
-- ==========================================

-- 1. Añadir columnas de dirección y vehículo si no existen
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS origin_address TEXT,
ADD COLUMN IF NOT EXISTS destination_address TEXT,
ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
ADD COLUMN IF NOT EXISTS vehicle_plate TEXT,
ADD COLUMN IF NOT EXISTS total_seats INTEGER DEFAULT 4;

-- 2. Poblar columnas desde JSONB (Migración de datos segura)
UPDATE public.rides
SET
    origin_address = COALESCE(origin_address, origin->>'address'),
    destination_address = COALESCE(destination_address, destination->>'address')
WHERE origin_address IS NULL OR destination_address IS NULL;

-- 3. RE-COMPILAR get_ride_details_secure con máxima compatibilidad
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
                -- Fallback inteligente: si la columna está vacía, usar el JSONB
                'origin_address',      COALESCE(r.origin_address, r.origin->>'address', 'Dirección no especificada'),
                'destination_address', COALESCE(r.destination_address, r.destination->>'address', 'Dirección no especificada'),
                'departure_time',      r.departure_time,
                'price',               r.price,
                'seats_available',     r.seats_available,
                'total_seats',         COALESCE(r.total_seats, 4),
                'distance',            r.distance,
                'waypoints',           r.waypoints,
                'overview_polyline',   r.overview_polyline,
                'vehicle_model',       COALESCE(r.vehicle_model, 'Vehículo estándar'),
                'vehicle_plate',       COALESCE(r.vehicle_plate, 'S/N'),
                'driver', json_build_object(
                    'id',           p.id,
                    'display_name', p.full_name,
                    'avatar_url',   p.photo_url,
                    'rating',       p.rating,
                    'city',         (p.vehicle_info->>'city'),
                    'verified',     p.is_verified
                ),
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id',              prof.id,
                            'displayName',     prof.full_name,
                            'avatarUrl',       prof.photo_url,
                            'status',          elem.val->>'status',
                            'pickup_address',  COALESCE(elem.val->>'pickup_address', r.origin->>'address'),
                            'pin', CASE
                                WHEN (elem.val->>'id')::UUID = v_user_id OR v_is_driver
                                THEN elem.val->>'pin'
                                ELSE '****'
                            END,
                            'rated',           COALESCE((elem.val->>'rated')::boolean, false),
                            'num_seats',       COALESCE((elem.val->>'seats_booked')::int, 1)
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
