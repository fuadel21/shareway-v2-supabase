-- ==============================================================================
-- 🚀 SHAREWAY ELITE - AUDITORÍA DE DATOS Y ACCIONES (V15.9)
-- Arregla direcciones vacías y solapamiento de botones
-- ==============================================================================

-- 1. ASEGURAR QUE LOS DATOS DE DIRECCIÓN SEAN ACCESIBLES
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
                -- Ride core
                'id',                  r.id,
                'driver_id',           r.driver_id,
                'status',              r.status,
                'origin',              r.origin,
                'destination',         r.destination,
                'origin_address',      COALESCE(r.origin_address, 'Dirección no especificada'),
                'destination_address', COALESCE(r.destination_address, 'Dirección no especificada'),
                'departure_time',      r.departure_time,
                'price',               r.price,
                'seats_available',     r.seats_available,
                'total_seats',         r.total_seats,
                'distance',            r.distance,
                'waypoints',           r.waypoints,
                'overview_polyline',   r.overview_polyline,
                'vehicle_model',       r.vehicle_model,
                'vehicle_plate',       r.vehicle_plate,
                -- Driver Object (Matched to Frontend)
                'driver', json_build_object(
                    'id',           p.id,
                    'display_name', p.display_name,
                    'avatar_url',   p.photo_url,
                    'rating',       p.rating,
                    'city',         p.city,
                    'verified',     (p.verification->>'status' = 'verified')
                ),
                -- Passengers (PIN visible solo al propio pasajero o al conductor)
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id',              prof.id,
                            'displayName',     prof.display_name,
                            'avatarUrl',       prof.photo_url,
                            'status',          elem.val->>'status',
                            'pickup_address',  elem.val->>'pickup_address',
                            'pickup_location', elem.val->>'pickup_location',
                            'pin', CASE
                                WHEN (elem.val->>'id')::UUID = v_user_id OR v_is_driver
                                THEN elem.val->>'pin'
                                ELSE '****'
                            END,
                            'rated',           elem.val->'rated',
                            'booked_price',    elem.val->'booked_price'
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
