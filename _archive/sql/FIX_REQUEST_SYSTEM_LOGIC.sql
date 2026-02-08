-- ==========================================
-- FIX: Complete Request System Logic
-- ==========================================
-- This script fixes ALL the logical issues in the request system:
-- 1. Prevents multiple drivers from accepting the same request
-- 2. Correctly assigns roles (driver vs passenger)
-- 3. Proper state management and atomic operations
-- 4. Prevents drivers from appearing as passengers

-- ==========================================
-- 1. FIXED FULFILL RIDE REQUEST FUNCTION
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
    v_lock_acquired BOOLEAN := FALSE;
BEGIN 
    -- Validar autenticación
    IF v_driver_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- BLOQUEO ATÓMICO: Prevenir aceptación concurrente
    -- Usar FOR UPDATE para bloquear la solicitud durante la transacción
    SELECT requester_id, status INTO v_passenger_id, v_request_status
    FROM public.ride_requests
    WHERE id = p_request_id
    FOR UPDATE; -- Esto bloquea la fila para prevenir concurrencia
    
    IF v_passenger_id IS NULL THEN 
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;
    
    -- Validar que la solicitud esté disponible
    IF v_request_status != 'pending' THEN 
        RAISE EXCEPTION 'La solicitud ya no está disponible. Estado actual: %', v_request_status;
    END IF;
    
    -- Evitar que un conductor acepte su propia solicitud
    IF v_driver_id = v_passenger_id THEN
        RAISE EXCEPTION 'No puedes aceptar tu propia solicitud';
    END IF;
    
    -- MARCAR COMO "PROCESANDO" inmediatamente para prevenir doble aceptación
    UPDATE public.ride_requests
    SET status = 'processing',
        updated_at = v_current_time
    WHERE id = p_request_id;
    
    v_lock_acquired := TRUE;
    
    -- Obtener información del pasajero
    SELECT display_name, photo_url 
    INTO v_passenger_name, v_passenger_photo
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- Crear el viaje para el CONDUCTOR
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
                NULL, -- driver_id (se asigna automáticamente)
                FALSE, -- is_women_only
                FALSE, -- is_round_trip
                '{}', -- preferences
                'automatic', -- creation_source
                p_waypoints,
                '{}' -- metadata
            ) INTO v_ride_res;
        
        IF NOT (v_ride_res->>'success')::BOOLEAN THEN 
            -- Revertir el estado si falla la creación del viaje
            UPDATE public.ride_requests
            SET status = 'pending',
                updated_at = v_current_time
            WHERE id = p_request_id;
            
            RETURN v_ride_res;
        END IF;
        
        v_ride_id := (v_ride_res->>'rideId')::UUID;
    EXCEPTION
        WHEN OTHERS THEN
        -- Revertir el estado si hay cualquier error
        UPDATE public.ride_requests
        SET status = 'pending',
            updated_at = v_current_time
        WHERE id = p_request_id;
        
        RAISE EXCEPTION 'Error al crear el viaje: %', SQLERRM;
    END;
    
    -- Generar PIN del viaje
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    -- Crear objeto del PASAJERO (no del conductor)
    v_passenger_obj := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Pasajero'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', v_current_time,
        'role', 'passenger' -- Explícitamente marcar como pasajero
    )::JSONB;
    
    -- Actualizar el viaje con el PASAJERO y el CONDUCTOR correcto
    UPDATE public.rides
    SET 
        passengers = jsonb_build_array(v_passenger_obj), -- Solo el pasajero
        participant_ids = ARRAY[v_driver_id, v_passenger_id], -- Ambos participantes
        seats_available = p_seats - 1, -- Una plaza menos disponible
        driver_id = v_driver_id, -- Asegurar que el conductor es correcto
        updated_at = v_current_time
    WHERE id = v_ride_id;
    
    -- Actualizar estado de la solicitud a FULFILLED
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id,
        driver_id = v_driver_id, -- Registrar quién aceptó
        updated_at = v_current_time,
        fulfilled_at = v_current_time
    WHERE id = p_request_id;
    
    -- Crear notificación para el pasajero
    BEGIN
        INSERT INTO public.notifications (
            user_id,
            title,
            message,
            type,
            data
        ) VALUES (
            v_passenger_id,
            '¡Solicitud Aceptada!',
            'Un conductor ha aceptado tu solicitud. Tu PIN de confirmación es: ' || v_ride_pin,
            'success',
            json_build_object(
                'ride_id', v_ride_id,
                'request_id', p_request_id,
                'driver_id', v_driver_id,
                'pin', v_ride_pin
            )
        );
    EXCEPTION
        WHEN undefined_table THEN
            -- La tabla de notificaciones no existe, continuar
            NULL;
    END;
    
    RETURN json_build_object(
        'success', true, 
        'rideId', v_ride_id,
        'passengerPin', v_ride_pin,
        'passengerId', v_passenger_id,
        'driverId', v_driver_id,
        'message', 'Solicitud aceptada exitosamente',
        'role', 'driver' -- Confirmar que el usuario actual es el conductor
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Asegurar revertir el estado si algo falla
        IF v_lock_acquired THEN
            UPDATE public.ride_requests
            SET status = 'pending',
                updated_at = v_current_time
            WHERE id = p_request_id;
        END IF;
        
        -- Registrar error para debugging
        BEGIN
            INSERT INTO public.rpc_error_logs (
                function_name,
                error_message,
                error_detail,
                user_id,
                params
            ) VALUES (
                'fulfill_ride_request',
                SQLERRM,
                SQLSTATE,
                v_driver_id,
                json_build_object(
                    'request_id', p_request_id,
                    'departure_time', p_departure_time,
                    'price', p_price
                )
            );
        EXCEPTION
            WHEN undefined_table THEN
                NULL;
        END;
        
        -- Return error instead of raising to avoid 500 errors
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'errorDetail', SQLSTATE
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 2. ADD MISSING COLUMNS TO REQUESTS TABLE
-- ==========================================
-- Add columns to track who accepted the request and when
DO $$
BEGIN
    -- Add driver_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ride_requests' 
        AND column_name = 'driver_id'
    ) THEN
        ALTER TABLE public.ride_requests ADD COLUMN driver_id UUID REFERENCES public.profiles(id);
    END IF;
    
    -- Add fulfilled_at column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ride_requests' 
        AND column_name = 'fulfilled_at'
    ) THEN
        ALTER TABLE public.ride_requests ADD COLUMN fulfilled_at TIMESTAMPTZ;
    END IF;
    
    -- Add processing status if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ride_requests' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE public.ride_requests ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;
END $$;

-- ==========================================
-- 3. CREATE NOTIFICATIONS TABLE (if it doesn't exist)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    data JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Grant permissions
GRANT SELECT, INSERT ON public.notifications TO authenticated;

-- ==========================================
-- 4. CREATE RPC ERROR LOGS TABLE (if it doesn't exist)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.rpc_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_detail TEXT,
    user_id UUID,
    params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grant permissions
GRANT SELECT, INSERT ON public.rpc_error_logs TO authenticated;

-- ==========================================
-- 5. UPDATE USER RIDE HISTORY TO SHOW CORRECT ROLES
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
    user_role TEXT -- 'driver' or 'passenger'
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
-- 6. GRANT PERMISSIONS
-- ==========================================
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_ride_history TO authenticated;

-- ==========================================
-- 7. VERIFICATION
-- ==========================================

-- Verify the function was created
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'CREATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname IN ('fulfill_ride_request', 'get_user_ride_history') 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- ==========================================
-- SUMMARY OF FIXES
-- ==========================================
/*
✅ FIXED ISSUES:

1. CONCURRENCY: 
   - Added FOR UPDATE locking to prevent multiple drivers accepting same request
   - Added 'processing' status as intermediate state
   - Atomic transaction with rollback on failure

2. ROLE ASSIGNMENT:
   - Driver is correctly set as driver_id in rides table
   - Passenger is correctly added to passengers array with 'passenger' role
   - user_role field in history shows correct role for each user

3. STATE MANAGEMENT:
   - Request states: pending -> processing -> fulfilled
   - Proper rollback on any failure
   - Track who accepted and when (driver_id, fulfilled_at)

4. NOTIFICATIONS:
   - Automatic notification to passenger with PIN
   - Clear communication of acceptance

5. HISTORY DISPLAY:
   - user_role field shows 'driver' or 'passenger'
   - Correct identification of user's role in each ride/request

TESTING:
- Multiple drivers cannot accept same request simultaneously
- Driver appears as driver, passenger appears as passenger
- Proper error handling and state management
- Notifications sent correctly
*/
