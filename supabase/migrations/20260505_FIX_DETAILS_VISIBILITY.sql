-- ==========================================
-- 20260505_FIX_DETAILS_VISIBILITY.sql
-- Asegurar visibilidad de viajes finalizados
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_driver BOOLEAN;
    v_is_passenger BOOLEAN;
BEGIN
    -- Verificar relación con el viaje
    SELECT
        (driver_id = v_user_id),
        (v_user_id = ANY(participant_ids))
    INTO v_is_driver, v_is_passenger
    FROM public.rides
    WHERE id = p_ride_id;

    -- Si no es conductor ni pasajero, pero el viaje es público, permitir ver info básica
    -- Pero para esta vista 'Elite', permitimos ver si está en los participantes

    RETURN (
        SELECT json_build_object(
            'success', true,
            'data', json_build_object(
                'id', r.id,
                'driver_id', r.driver_id,
                'status', r.status,
                'origin', r.origin,
                'destination', r.destination,
                'origin_address', COALESCE(r.origin_address, r.origin->>'address'),
                'destination_address', COALESCE(r.destination_address, r.destination->>'address'),
                'departure_time', r.departure_time,
                'price', r.price,
                'seats_available', r.seats_available,
                'total_seats', COALESCE(r.total_seats, 4),
                'vehicle_model', COALESCE(r.vehicle_model, 'Vehículo ShareWay'),
                'vehicle_plate', COALESCE(r.vehicle_plate, 'S/N'),
                'driver_name', p.full_name,
                'driver_photo', p.photo_url,
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', prof.id,
                            'displayName', prof.full_name,
                            'avatarUrl', prof.photo_url,
                            'status', elem->>'status',
                            'seats_booked', COALESCE((elem->>'seats_booked')::int, 1)
                        )
                    )
                    FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem
                    JOIN public.profiles prof ON (elem->>'id')::UUID = prof.id
                )
            )
        )
        FROM public.rides r
        JOIN public.profiles p ON r.driver_id = p.id
        WHERE r.id = p_ride_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
