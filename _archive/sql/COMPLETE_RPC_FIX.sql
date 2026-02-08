-- ==========================================
-- COMPLETE FIX: All Missing RPC Functions
-- ==========================================
-- Execute this ENTIRE script in your Supabase SQL Editor
-- This will fix ALL 404 errors at once

-- ==========================================
-- 1. CANCEL RIDE REQUEST FUNCTION
-- ==========================================
DROP FUNCTION IF EXISTS public.cancel_ride_request(p_request_id UUID);

CREATE OR REPLACE FUNCTION public.cancel_ride_request(p_request_id UUID) RETURNS JSON AS $$
DECLARE 
    v_requester_id UUID;
    v_request_status TEXT;
    v_current_time TIMESTAMPTZ := NOW();
BEGIN 
    -- Validar autenticación
    v_requester_id := auth.uid();
    IF v_requester_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Verificar que la solicitud existe y obtener su estado actual
    SELECT status INTO v_request_status
    FROM public.ride_requests
    WHERE id = p_request_id AND requester_id = v_requester_id;
    
    IF v_request_status IS NULL THEN 
        RAISE EXCEPTION 'Solicitud no encontrada o no tienes permisos';
    END IF;
    
    -- Validar que la solicitud pueda ser cancelada
    IF v_request_status NOT IN ('pending', 'accepted') THEN 
        RAISE EXCEPTION 'La solicitud no puede ser cancelada. Estado actual: %', v_request_status;
    END IF;
    
    -- Actualizar estado a cancelled
    UPDATE public.ride_requests
    SET 
        status = 'cancelled',
        updated_at = v_current_time,
        cancelled_at = v_current_time
    WHERE id = p_request_id
        AND requester_id = v_requester_id;
    
    -- Si estaba aceptada, liberar el ride match
    IF v_request_status = 'accepted' THEN
        UPDATE public.ride_requests
        SET 
            matched_ride_id = NULL,
            payment_expires_at = NULL
        WHERE id = p_request_id;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'requestId', p_request_id,
        'previousStatus', v_request_status,
        'newStatus', 'cancelled',
        'cancelledAt', v_current_time,
        'message', 'Solicitud cancelada exitosamente'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error instead of raising to avoid 500 errors
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'errorDetail', SQLSTATE
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 2. UPDATE RIDE LOCATION FUNCTION
-- ==========================================
DROP FUNCTION IF EXISTS public.update_ride_location(p_ride_id UUID, p_location JSONB);

CREATE OR REPLACE FUNCTION public.update_ride_location(p_ride_id UUID, p_location JSONB) 
RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride_status TEXT;
    v_current_time TIMESTAMPTZ := NOW();
BEGIN 
    -- Validar autenticación
    IF v_driver_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado'; 
    END IF;
    
    -- Validar que el viaje existe y pertenece al conductor
    SELECT status INTO v_ride_status
    FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id;
    
    IF v_ride_status IS NULL THEN 
        RAISE EXCEPTION 'Viaje no encontrado o no autorizado'; 
    END IF;
    
    -- Validar que el viaje está en estado activo
    IF v_ride_status NOT IN ('scheduled', 'active', 'in_progress') THEN 
        RAISE EXCEPTION 'El viaje no está en un estado que permita actualización de ubicación'; 
    END IF;
    
    -- Actualizar ubicación del viaje
    UPDATE public.rides 
    SET 
        current_location = p_location,
        location_updated_at = v_current_time
    WHERE id = p_ride_id AND driver_id = v_driver_id;
    
    RETURN json_build_object(
        'success', true,
        'rideId', p_ride_id,
        'location', p_location,
        'timestamp', v_current_time,
        'status', v_ride_status
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error instead of raising to avoid 500 errors
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'errorDetail', SQLSTATE
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 3. FULFILL RIDE REQUEST FUNCTION
-- ==========================================
DROP FUNCTION IF EXISTS public.fulfill_ride_request(
    p_request_id UUID,
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT,
    p_distance DECIMAL,
    p_overview_polyline TEXT,
    p_waypoints JSONB
);

CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_passenger_id UUID;
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_ride_id UUID;
    v_ride_res JSON;
    v_ride_pin TEXT;
    v_passenger_obj JSONB;
    v_request_status TEXT;
    v_current_time TIMESTAMPTZ := NOW();
BEGIN 
    -- Validar autenticación
    IF v_driver_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Validar que la solicitud existe y está pendiente
    SELECT requester_id, status INTO v_passenger_id, v_request_status
    FROM public.ride_requests
    WHERE id = p_request_id;
    
    IF v_passenger_id IS NULL THEN 
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;
    
    IF v_request_status != 'pending' THEN 
        RAISE EXCEPTION 'La solicitud ya no está disponible. Estado actual: %', v_request_status;
    END IF;
    
    -- Evitar que un conductor acepte su propia solicitud
    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes aceptar tu propia solicitud';
    END IF;
    
    -- Obtener información del pasajero
    SELECT display_name, photo_url 
    INTO v_passenger_name, v_passenger_photo
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- Crear el viaje usando la función existente
    BEGIN
        SELECT public.create_ride(
                p_origin,
                p_destination,
                p_departure_time,
                p_seats,
                p_price,
                p_details,
                p_distance,
                p_overview_polyline,
                NULL,
                FALSE,
                FALSE,
                '{}',
                'automatic',
                p_waypoints,
                '{}'
            ) INTO v_ride_res;
        
        IF NOT (v_ride_res->>'success')::BOOLEAN THEN 
            RETURN v_ride_res;
        END IF;
        
        v_ride_id := (v_ride_res->>'rideId')::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Error al crear el viaje: %', SQLERRM;
    END;
    
    -- Generar PIN del viaje
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    -- Crear objeto del pasajero
    v_passenger_obj := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Pasajero'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', v_current_time
    )::JSONB;
    
    -- Actualizar el viaje con el pasajero
    UPDATE public.rides
    SET 
        passengers = COALESCE(passengers, '[]'::jsonb) || v_passenger_obj,
        participant_ids = COALESCE(participant_ids, ARRAY[]::UUID[]) || v_passenger_id,
        seats_available = GREATEST(0, seats_available - 1)
    WHERE id = v_ride_id;
    
    -- Actualizar estado de la solicitud
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id,
        updated_at = v_current_time
    WHERE id = p_request_id;
    
    RETURN json_build_object(
        'success', true, 
        'rideId', v_ride_id,
        'passengerPin', v_ride_pin,
        'passengerId', v_passenger_id,
        'message', 'Solicitud aceptada exitosamente'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error instead of raising to avoid 500 errors
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'errorDetail', SQLSTATE
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 4. USER RIDE HISTORY FUNCTION
-- ==========================================
DROP FUNCTION IF EXISTS public.get_user_ride_history(
    p_user_id UUID,
    p_limit INTEGER,
    p_offset INTEGER
);

CREATE OR REPLACE FUNCTION public.get_user_ride_history(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_avatar_url TEXT,
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    distance DECIMAL,
    status TEXT,
    passengers JSONB,
    participant_ids UUID[],
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    co2_saved DECIMAL,
    item_type TEXT,
    user_role TEXT
) AS $$
BEGIN
    RETURN QUERY
    -- Rides where user is driver or passenger
    SELECT 
        r.id,
        r.driver_id,
        COALESCE(d.display_name, '')::TEXT as driver_display_name,
        COALESCE(d.photo_url, '')::TEXT as driver_photo_url,
        COALESCE(d.avatar_url, '')::TEXT as driver_avatar_url,
        r.origin,
        r.destination,
        r.departure_time,
        NULL::TIMESTAMPTZ as arrival_time,
        r.seats_available,
        r.price,
        r.distance,
        r.status,
        COALESCE(r.passengers, '[]'::jsonb) as passengers,
        COALESCE(r.participant_ids, ARRAY[]::UUID[]) as participant_ids,
        r.created_at,
        r.updated_at,
        r.co2_saved,
        'ride'::TEXT as item_type,
        CASE 
            WHEN r.driver_id = p_user_id THEN 'driver'::TEXT
            WHEN r.participant_ids @> ARRAY[p_user_id] THEN 'passenger'::TEXT
            ELSE 'unknown'::TEXT
        END as user_role
    FROM public.rides r
    LEFT JOIN public.profiles d ON r.driver_id = d.id
    WHERE r.driver_id = p_user_id 
       OR r.participant_ids @> ARRAY[p_user_id]
    
    UNION ALL
    
    -- Requests where user is the requester
    SELECT 
        rq.id,
        rq.driver_id, -- Quien aceptó (si fue aceptada)
        COALESCE(d.display_name, '')::TEXT as driver_display_name,
        COALESCE(d.photo_url, '')::TEXT as driver_photo_url,
        COALESCE(d.avatar_url, '')::TEXT as driver_avatar_url,
        rq.origin,
        rq.destination,
        rq.departure_time,
        NULL::TIMESTAMPTZ as arrival_time,
        rq.seats_needed as seats_available,
        rq.suggested_price as price,
        rq.distance,
        rq.status,
        '[]'::jsonb as passengers,
        ARRAY[rq.requester_id]::UUID[] as participant_ids,
        rq.created_at,
        rq.updated_at,
        NULL::DECIMAL as co2_saved,
        'request'::TEXT as item_type,
        'passenger'::TEXT as user_role -- El solicitante siempre es pasajero
    FROM public.ride_requests rq
    LEFT JOIN public.profiles d ON rq.driver_id = d.id
    WHERE rq.requester_id = p_user_id 
       AND rq.status IN ('cancelled', 'expired', 'fulfilled')
    
    ORDER BY departure_time DESC, created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==========================================
-- 5. GRANT PERMISSIONS
-- ==========================================
GRANT EXECUTE ON FUNCTION public.cancel_ride_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ride_location TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_ride_history TO authenticated;

-- ==========================================
-- 6. VERIFICATION
-- ==========================================

-- Verify all functions were created
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'CREATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname IN ('cancel_ride_request', 'update_ride_location', 'fulfill_ride_request', 'get_user_ride_history') 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- ==========================================
-- SUCCESS MESSAGE
-- ==========================================
/*
After executing this script:

✅ cancel_ride_request - Will work (no more 404)
✅ update_ride_location - Will work (no more 404)  
✅ fulfill_ride_request - Will work (no more 404)
✅ get_user_ride_history - Will work (no more 404)

Your frontend should now be able to:
- Cancel requests successfully
- Update ride locations in real-time
- Accept ride requests successfully  
- Show complete ride history with cancelled requests

Refresh your browser after executing this script!
*/
