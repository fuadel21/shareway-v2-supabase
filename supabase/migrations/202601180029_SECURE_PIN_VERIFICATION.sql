
-- ==============================================================================
-- 20260118_SECURE_PIN_VERIFICATION.sql
-- Propósito: Ocultar PINs al conductor y habilitar sistema de verificación ciega.
-- ==============================================================================

-- 1. Actualizar obtención de detalles para OCULTAR PINs a terceros
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passengers_redacted JSONB;
BEGIN
    SELECT r.*, p.display_name as driver_name, p.photo_url as driver_photo, p.is_verified as driver_verified, p.rating as driver_rating
    INTO v_ride_record
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.id = p_ride_id;

    IF v_ride_record.id IS NULL THEN RETURN NULL; END IF;

    -- Redactar PINs: Solo el pasajero dueño del PIN puede verlo. El conductor NO lo ve.
    SELECT jsonb_agg(
        CASE 
            WHEN (p->>'id')::UUID = v_user_id THEN p -- Ver mi propio PIN
            ELSE p - 'pin' -- Eliminar PIN para el resto (incluido conductor)
        END
    ) INTO v_passengers_redacted
    FROM jsonb_array_elements(COALESCE(v_ride_record.passengers, '[]'::JSONB)) p;

    RETURN json_build_object(
        'id', v_ride_record.id,
        'driver_id', v_ride_record.driver_id,
        'driver_name', v_ride_record.driver_name,
        'driver_photo', v_ride_record.driver_photo,
        'driver_verified', v_ride_record.driver_verified,
        'driver_rating', v_ride_record.driver_rating,
        'origin', v_ride_record.origin,
        'destination', v_ride_record.destination,
        'departure_time', v_ride_record.departure_time,
        'seats_available', v_ride_record.seats_available,
        'price', v_ride_record.price,
        'status', v_ride_record.status,
        'is_women_only', v_ride_record.is_women_only,
        'passengers', v_passengers_redacted,
        'user_pin', (SELECT p->>'pin' FROM jsonb_array_elements(v_ride_record.passengers) p WHERE (p->>'id')::UUID = v_user_id) -- PIN explícito para el pasajero actual
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 2. Función de Verificación Ciega (El conductor introduce el PIN que le da el pasajero)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_passenger_id UUID,
    p_pin TEXT
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_correct_pin TEXT;
BEGIN
    -- 1. Bloquear viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- 2. Validar que es el conductor
    IF v_ride_record.driver_id != v_driver_id THEN
        RAISE EXCEPTION 'No autorizado: Solo el conductor puede verificar pasajeros';
    END IF;

    -- 3. Buscar al pasajero y su PIN
    SELECT p INTO v_passenger_entry 
    FROM jsonb_array_elements(v_ride_record.passengers) AS p 
    WHERE (p->>'id')::UUID = p_passenger_id;

    IF v_passenger_entry IS NULL THEN RAISE EXCEPTION 'Pasajero no encontrado en este viaje'; END IF;
    
    v_correct_pin := v_passenger_entry->>'pin';

    -- 4. Comparar PIN
    IF v_correct_pin != p_pin THEN
        RAISE EXCEPTION 'PIN_INCORRECTO';
    END IF;

    -- 5. Marcar como verificado/a bordo
    UPDATE public.rides
    SET passengers = (
        SELECT jsonb_agg(
            CASE 
                WHEN (p->>'id')::UUID = p_passenger_id THEN p || jsonb_build_object('status', 'verified', 'verified_at', NOW())
                ELSE p 
            END
        )
        FROM jsonb_array_elements(v_ride_record.passengers) p
    )
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'message', 'Pasajero verificado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
