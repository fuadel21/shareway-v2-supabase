-- ==============================================================================
-- SCRIPT DE CORRECCIÓN DE LÓGICA DE VIAJES
-- 1. Actualiza cancel_booking_and_refund para NO borrar al pasajero (historial).
-- 2. Actualiza get_user_rides para contar pasajeros correctamente.
-- ==============================================================================

-- 1. Actualizar cancel_booking_and_refund
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(
    p_ride_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID;
    v_ride_price DECIMAL;
    v_passengers JSONB;
    v_new_passengers JSONB;
BEGIN
    v_passenger_id := auth.uid();
    
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Obtener información del viaje
    SELECT price, passengers
    INTO v_ride_price, v_passengers
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled';
    
    IF v_ride_price IS NULL THEN
        RAISE EXCEPTION 'El viaje no existe o no puede ser cancelado';
    END IF;
    
    -- Verificar que el usuario tiene una reserva
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_passengers) AS passenger
        WHERE (passenger->>'id')::UUID = v_passenger_id AND passenger->>'status' = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'No tienes una reserva activa en este viaje';
    END IF;
    
    -- Actualizar estado del pasajero a 'cancelled' en el JSON. NO borrarlo.
    SELECT jsonb_agg(
        CASE 
            WHEN (p->>'id')::UUID = v_passenger_id THEN jsonb_set(p, '{status}', '"cancelled"')
            ELSE p 
        END
    )
    INTO v_new_passengers
    FROM jsonb_array_elements(v_passengers) AS p;
    
    -- Reembolsar fondos
    UPDATE public.wallets
    SET balance = balance + v_ride_price,
        held_balance = held_balance - v_ride_price
    WHERE user_id = v_passenger_id;
    
    -- Registrar transacción
    INSERT INTO public.transactions (wallet_id, user_id, type, amount, balance_after, description, related_ride_id)
    SELECT id, user_id, 'refund', v_ride_price, balance, 'Reembolso por cancelación', p_ride_id
    FROM public.wallets
    WHERE user_id = v_passenger_id;
    
    -- Actualizar el viaje
    -- Nota: NO removemos del participant_ids para mantener RLS y historial
    UPDATE public.rides
    SET passengers = COALESCE(v_new_passengers, '[]'::JSONB),
        seats_available = seats_available + 1
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'message', 'Reserva cancelada y reembolsada');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Actualizar get_user_rides
CREATE OR REPLACE FUNCTION public.get_user_rides(
    p_user_id UUID DEFAULT NULL,
    p_role TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    result JSONB;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no especificado';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'origin', r.origin,
            'destination', r.destination,
            'departure_time', r.departure_time,
            'status', r.status,
            'price', r.price,
            'seats', r.seats_available, -- Esto debería ser total, pero mantengo compatibilidad
            'seats_available', r.seats_available,
            'seats_total', r.seats_total,
            -- Contar solo pasajeros confirmados
            'passengers_count', (SELECT COUNT(*) FROM jsonb_array_elements(r.passengers) p WHERE p->>'status' = 'confirmed'),
            'driver_id', r.driver_id,
            'driver_display_name', p.display_name,
            'driver_photo_url', COALESCE(p.avatar_url, ''),
            'participant_ids', COALESCE(r.participant_ids, '{}'),
            'passengers', COALESCE(r.passengers, '[]'::jsonb),
            'distance', r.distance,
            'overview_polyline', r.overview_polyline,
            'details', r.details,
            'my_role', CASE WHEN r.driver_id = v_user_id THEN 'driver' ELSE 'passenger' END
        )
    ) INTO result
    FROM rides r
    JOIN profiles p ON r.driver_id = p.id
    WHERE 
        (p_role = 'all' OR 
         (p_role = 'driver' AND r.driver_id = v_user_id) OR
         (p_role = 'passenger' AND v_user_id = ANY(r.participant_ids) AND r.driver_id != v_user_id))
        AND v_user_id = ANY(r.participant_ids)
    ORDER BY r.departure_time DESC;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
