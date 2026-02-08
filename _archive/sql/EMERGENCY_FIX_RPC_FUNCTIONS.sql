-- ==========================================
-- EMERGENCY FIX: Deploy Missing RPC Functions v2
-- ==========================================
-- Execute this script IMMEDIATELY in your Supabase SQL Editor
-- This will fix ALL the 404 and 400 errors

-- First, let's check what functions currently exist
-- (You can run this separately to see current state)
/*
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname IN ('update_ride_location', 'fulfill_ride_request') 
    AND pronamespace = 'public'::regnamespace;
*/

-- 1. UPDATE RIDE LOCATION FUNCTION (Fixed version)
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
    
    -- Registrar en log de ubicaciones (si la tabla existe)
    BEGIN
        INSERT INTO public.ride_location_logs (
            ride_id,
            driver_id,
            location,
            created_at
        ) VALUES (
            p_ride_id,
            v_driver_id,
            p_location,
            v_current_time
        );
    EXCEPTION
        WHEN undefined_table THEN
            -- Table doesn't exist, skip logging
            NULL;
    END;
    
    RETURN json_build_object(
        'success', true,
        'rideId', p_ride_id,
        'location', p_location,
        'timestamp', v_current_time,
        'status', v_ride_status
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Registrar error para debugging (si la tabla existe)
        BEGIN
            INSERT INTO public.rpc_error_logs (
                function_name,
                error_message,
                error_detail,
                user_id,
                params
            ) VALUES (
                'update_ride_location',
                SQLERRM,
                SQLSTATE,
                v_driver_id,
                json_build_object('ride_id', p_ride_id, 'location', p_location)
            );
        EXCEPTION
            WHEN undefined_table THEN
                -- Table doesn't exist, skip error logging
                NULL;
        END;
        
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. FULFILL RIDE REQUEST FUNCTION (Fixed version)
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
    v_wallet_balance DECIMAL;
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
    
    -- Verificar wallet del pasajero (si existe)
    BEGIN
        SELECT balance INTO v_wallet_balance
        FROM public.wallets
        WHERE user_id = v_passenger_id FOR UPDATE;
        
        IF v_wallet_balance < p_price THEN 
            RAISE EXCEPTION 'El pasajero no tiene saldo suficiente. Balance: %, Requerido: %', v_wallet_balance, p_price;
        END IF;
        
        -- Mover fondos del pasajero a escrow
        UPDATE public.wallets
        SET balance = balance - p_price,
            held_balance = held_balance + p_price
        WHERE user_id = v_passenger_id;
        
        -- Registrar transacción
        INSERT INTO public.transactions (
                wallet_id,
                user_id,
                type,
                amount,
                balance_after,
                description,
                related_ride_id
            )
        SELECT id,
            user_id,
            'hold',
            - p_price,
            balance,
            'Reserva automática por Match',
            v_ride_id
        FROM public.wallets
        WHERE user_id = v_passenger_id;
    EXCEPTION
        WHEN undefined_table THEN
            -- Wallet tables don't exist, skip payment logic
            v_wallet_balance := NULL;
    END;
    
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
                -- Error log table doesn't exist, skip
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

-- 3. CREATE SUPPORTING TABLES (if they don't exist)

-- Tabla de logs de ubicaciones
CREATE TABLE IF NOT EXISTS public.ride_location_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL,
    driver_id UUID NOT NULL,
    location JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de logs de errores RPC
CREATE TABLE IF NOT EXISTS public.rpc_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_detail TEXT,
    user_id UUID,
    params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_ride_location_logs_ride_id ON public.ride_location_logs(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_location_logs_created_at ON public.ride_location_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_rpc_error_logs_function_name ON public.rpc_error_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_rpc_error_logs_created_at ON public.rpc_error_logs(created_at);

-- Grant permissions
GRANT SELECT, INSERT ON public.ride_location_logs TO authenticated;
GRANT SELECT, INSERT ON public.rpc_error_logs TO authenticated;

-- ==========================================
-- VERIFICATION QUERIES
-- ==========================================

-- Verify functions were created
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'CREATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname IN ('update_ride_location', 'fulfill_ride_request') 
    AND pronamespace = 'public'::regnamespace;

-- Test functions (optional - uncomment to test)
/*
-- Test update_ride_location (replace with real ride ID):
SELECT public.update_ride_location(
    '00000000-0000-0000-0000-000000000000',
    '{"lat": 40.7128, "lng": -74.0060}'
);

-- Test fulfill_ride_request (replace with real request ID):
SELECT public.fulfill_ride_request(
    '00000000-0000-0000-0000-000000000000',
    '{"lat": 40.7128, "lng": -74.0060}',
    '{"lat": 40.7589, "lng": -73.9851}',
    NOW() + INTERVAL '2 hours',
    2,
    25.50,
    'Test ride'
);
*/

-- ==========================================
-- SUCCESS MESSAGE
-- ==========================================
/*
After executing this script:

1. ✅ update_ride_location function should work (no more 404 errors)
2. ✅ fulfill_ride_request function should work (no more 404 errors)
3. ✅ Better error handling (no more 500 errors)
4. ✅ Proper validation and logging
5. ✅ Graceful fallback when supporting tables don't exist

Your frontend should now be able to:
- Update ride locations in real-time
- Accept ride requests successfully
- Handle errors gracefully
- Log debugging information

If you still see 404 errors after running this script:
1. Check that the script executed without errors
2. Refresh your browser cache
3. Restart your development server
4. Check the Supabase logs for any remaining issues
*/
