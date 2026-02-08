-- ==========================================
-- FIX: Deploy Missing RPC Functions
-- ==========================================
-- Execute this script in your Supabase SQL Editor
-- to fix the 404 errors for RPC functions

-- 1. UPDATE RIDE LOCATION FUNCTION
CREATE OR REPLACE FUNCTION public.update_ride_location(p_ride_id UUID, p_location JSONB) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_point GEOGRAPHY;
    v_ride_status TEXT;
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
    IF v_ride_status NOT IN ('scheduled', 'active') THEN 
        RAISE EXCEPTION 'El viaje no está en un estado que permita actualización de ubicación'; 
    END IF;
    
    -- Convertir coordenadas a punto geográfico
    v_point := ST_SetSRID(
        ST_MakePoint(
            (p_location->>'lng')::FLOAT,
            (p_location->>'lat')::FLOAT
        ),
        4326
    )::GEOGRAPHY;
    
    -- Actualizar ubicación del viaje
    UPDATE public.rides 
    SET 
        current_location = p_location,
        current_location_geog = v_point,
        location_updated_at = NOW()
    WHERE id = p_ride_id AND driver_id = v_driver_id;
    
    -- Registrar en log de ubicaciones (si la tabla existe)
    INSERT INTO public.ride_location_logs (
        ride_id,
        driver_id,
        location,
        location_geog,
        created_at
    ) VALUES (
        p_ride_id,
        v_driver_id,
        p_location,
        v_point,
        NOW()
    ) ON CONFLICT DO NOTHING;
    
    RETURN json_build_object(
        'success', true,
        'rideId', p_ride_id,
        'location', p_location,
        'timestamp', NOW()
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Registrar error para debugging
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
        ) ON CONFLICT DO NOTHING;
        
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. FULFILL RIDE REQUEST FUNCTION
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
BEGIN 
    -- Validar autenticación
    IF v_driver_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Obtener información de la solicitud
    SELECT requester_id INTO v_passenger_id
    FROM public.ride_requests
    WHERE id = p_request_id AND status = 'pending';
    
    IF v_passenger_id IS NULL THEN 
        RAISE EXCEPTION 'La solicitud ya no está disponible.';
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
    
    -- Verificar saldo del pasajero
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = v_passenger_id FOR UPDATE;
    
    IF v_wallet_balance < p_price THEN 
        RAISE EXCEPTION 'El pasajero no tiene saldo suficiente.';
    END IF;
    
    -- Crear el viaje usando la función existente
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
    
    -- Generar PIN del viaje
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
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
    
    -- Crear objeto del pasajero
    v_passenger_obj := json_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', NOW()
    )::JSONB;
    
    -- Actualizar el viaje con el pasajero
    UPDATE public.rides
    SET 
        passengers = jsonb_build_array(v_passenger_obj),
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - 1
    WHERE id = v_ride_id;
    
    -- Actualizar estado de la solicitud
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id
    WHERE id = p_request_id;
    
    RETURN json_build_object(
        'success', true, 
        'rideId', v_ride_id,
        'passengerPin', v_ride_pin
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Registrar error para debugging
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
            json_build_object('request_id', p_request_id)
        ) ON CONFLICT DO NOTHING;
        
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. CREATE TABLES IF NOT EXISTS (for supporting functionality)

-- Tabla de logs de ubicaciones (si no existe)
CREATE TABLE IF NOT EXISTS public.ride_location_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    location JSONB NOT NULL,
    location_geog GEOGRAPHY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de logs de errores RPC (si no existe)
CREATE TABLE IF NOT EXISTS public.rpc_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_detail TEXT,
    user_id UUID REFERENCES public.profiles(id),
    params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_ride_location_logs_ride_id ON public.ride_location_logs(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_location_logs_created_at ON public.ride_location_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_rpc_error_logs_function_name ON public.rpc_error_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_rpc_error_logs_created_at ON public.rpc_error_logs(created_at);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.ride_location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpc_error_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de seguridad
CREATE POLICY "Drivers can view their own ride location logs" ON public.ride_location_logs
    FOR SELECT USING (auth.uid() = driver_id);

CREATE POLICY "Users can view their own error logs" ON public.rpc_error_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT ON public.ride_location_logs TO authenticated;
GRANT SELECT, INSERT ON public.rpc_error_logs TO authenticated;

-- ==========================================
-- VERIFICATION
-- ==========================================

-- Verificar que las funciones fueron creadas correctamente
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname IN ('update_ride_location', 'fulfill_ride_request') 
    AND pronamespace = 'public'::regnamespace;

-- ==========================================
-- USAGE INSTRUCTIONS
-- ==========================================
/*
After executing this script:

1. The 404 errors for update_ride_location and fulfill_ride_request should be resolved
2. Your frontend should be able to:
   - Update ride locations in real-time
   - Accept ride requests successfully
   - Handle proper error logging

To test the functions:

-- Test update_ride_location:
SELECT public.update_ride_location(
    'your-ride-id',
    '{"lat": 40.7128, "lng": -74.0060, "speed": 45.2}'
);

-- Test fulfill_ride_request:
SELECT public.fulfill_ride_request(
    'request-id',
    '{"lat": 40.7128, "lng": -74.0060}',
    '{"lat": 40.7589, "lng": -73.9851}',
    NOW() + INTERVAL '1 hour',
    2,
    25.50,
    'Test ride'
);

Note: Replace the IDs with actual data from your database
*/
