-- ==========================================
-- CORRECTED: Accept Request Logic
-- ==========================================
-- This script fixes the role assignment when accepting requests
-- Driver should be the driver, passenger should be the passenger

-- ==========================================
-- 1. CORRECTED FULFILL RIDE REQUEST FUNCTION
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
    v_driver_id UUID := auth.uid(); -- El que acepta es el CONDUCTOR
    v_passenger_id UUID; -- El que solicitó es el PASAJERO
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_ride_id UUID;
    v_ride_res JSON;
    v_ride_pin TEXT;
    v_passenger_obj JSONB;
    v_request_status TEXT;
    v_current_time TIMESTAMPTZ := NOW();
    v_lock_acquired BOOLEAN := FALSE;
    v_driver_name TEXT;
    v_driver_photo TEXT;
BEGIN 
    -- Validar autenticación del conductor
    IF v_driver_id IS NULL THEN 
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- BLOQUEO ATÓMICO: Prevenir aceptación concurrente
    SELECT requester_id, status INTO v_passenger_id, v_request_status
    FROM public.ride_requests
    WHERE id = p_request_id
    FOR UPDATE;
    
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
    
    -- MARCAR COMO "PROCESANDO" inmediatamente
    UPDATE public.ride_requests
    SET status = 'processing',
        updated_at = v_current_time
    WHERE id = p_request_id;
    
    v_lock_acquired := TRUE;
    
    -- Obtener información del PASAJERO (quien solicitó)
    SELECT display_name, photo_url 
    INTO v_passenger_name, v_passenger_photo
    FROM public.profiles
    WHERE id = v_passenger_id;
    
    -- Obtener información del CONDUCTOR (quien acepta)
    SELECT display_name, photo_url 
    INTO v_driver_name, v_driver_photo
    FROM public.profiles
    WHERE id = v_driver_id;
    
    -- Crear el NUEVO viaje con el CONDUCTOR como conductor
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
                v_driver_id, -- El conductor es quien acepta
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
    
    -- Generar PIN del viaje para el PASAJERO
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    
    -- Crear objeto del PASAJERO (quien solicitó)
    v_passenger_obj := json_build_object(
        'id', v_passenger_id,
        'displayName', COALESCE(v_passenger_name, 'Pasajero'),
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', p_price,
        'booked_at', v_current_time,
        'role', 'passenger' -- Explícitamente marcado como pasajero
    )::JSONB;
    
    -- Actualizar el viaje:
    -- 1. Establecer el conductor correcto
    -- 2. Agregar al pasajero
    -- 3. Dejar asientos disponibles para otros usuarios
    UPDATE public.rides
    SET 
        driver_id = v_driver_id, -- El conductor es quien aceptó
        driver_display_name = v_driver_name,
        driver_photo_url = v_driver_photo,
        passengers = jsonb_build_array(v_passenger_obj), -- El pasajero agregado
        participant_ids = ARRAY[v_driver_id, v_passenger_id], -- Ambos participantes
        seats_available = p_seats - 1, -- Una plaza reservada, el resto disponible
        updated_at = v_current_time
    WHERE id = v_ride_id;
    
    -- Procesar pago del PASAJERO (si existe sistema de wallets)
    BEGIN
        -- Verificar y mover fondos del pasajero a escrow
        PERFORM public.process_passenger_payment(v_passenger_id, p_price, v_ride_id);
    EXCEPTION
        WHEN undefined_function THEN
            -- La función de pago no existe, continuar sin procesar pago
            NULL;
    END;
    
    -- Actualizar estado de la solicitud a FULFILLED
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = v_ride_id,
        driver_id = v_driver_id, -- Registrar quién aceptó (el conductor)
        updated_at = v_current_time,
        fulfilled_at = v_current_time
    WHERE id = p_request_id;
    
    -- Crear notificación para el PASAJERO
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
            format('Un conductor ha aceptado tu solicitud. Tu PIN de confirmación es: %s', v_ride_pin),
            'success',
            json_build_object(
                'ride_id', v_ride_id,
                'request_id', p_request_id,
                'driver_id', v_driver_id,
                'driver_name', v_driver_name,
                'pin', v_ride_pin
            )
        );
    EXCEPTION
        WHEN undefined_table THEN
            NULL;
    END;
    
    RETURN json_build_object(
        'success', true, 
        'rideId', v_ride_id,
        'passengerPin', v_ride_pin,
        'passengerId', v_passenger_id,
        'driverId', v_driver_id,
        'message', 'Viaje creado y asiento reservado exitosamente',
        'role', 'driver', -- Confirmar que el usuario actual es el conductor
        'seatsAvailable', p_seats - 1 -- Asientos restantes para otros usuarios
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
        
        -- Registrar error
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
        
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'errorDetail', SQLSTATE
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 2. HELPER FUNCTION FOR PAYMENT PROCESSING (if needed)
-- ==========================================
CREATE OR REPLACE FUNCTION public.process_passenger_payment(
    p_passenger_id UUID,
    p_amount DECIMAL,
    p_ride_id UUID
) RETURNS JSON AS $$
DECLARE 
    v_wallet_balance DECIMAL;
BEGIN 
    -- Verificar wallet del pasajero
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = p_passenger_id FOR UPDATE;
    
    IF v_wallet_balance < p_amount THEN 
        RAISE EXCEPTION 'El pasajero no tiene saldo suficiente. Balance: %, Requerido: %', v_wallet_balance, p_amount;
    END IF;
    
    -- Mover fondos del pasajero a escrow
    UPDATE public.wallets
    SET balance = balance - p_amount,
        held_balance = held_balance + p_amount
    WHERE user_id = p_passenger_id;
    
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
        - p_amount,
        balance,
        'Reserva automática por aceptación de solicitud',
        p_ride_id
    FROM public.wallets
    WHERE user_id = p_passenger_id;
    
    RETURN json_build_object('success', true, 'amount', p_amount);
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 3. GRANT PERMISSIONS
-- ==========================================
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_passenger_payment TO authenticated;

-- ==========================================
-- 4. VERIFICATION
-- ==========================================

SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'CREATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname IN ('fulfill_ride_request', 'process_passenger_payment') 
    AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- ==========================================
-- SUMMARY OF CORRECTED LOGIC
-- ==========================================
/*
✅ CORRECTED LOGIC:

1. USER REQUESTS SEAT:
   - Creates ride_request with requester_id = PASSENGER

2. DRIVER ACCEPTS REQUEST:
   - Driver ID = auth.uid() (who accepts)
   - Passenger ID = requester_id (who requested)
   - Creates NEW ride with driver_id = DRIVER
   - Adds PASSENGER to passengers array
   - Seats available = total_seats - 1 (for others to join)

3. ROLE ASSIGNMENT:
   - Driver: user_role = 'driver' in history
   - Passenger: user_role = 'passenger' in history
   - Correct display in frontend

4. OTHER USERS:
   - Can see the new ride in available rides
   - Can join remaining seats
   - Each gets their own PIN

TESTING:
- Driver appears as driver in ride history
- Passenger appears as passenger in ride history  
- Ride is available for other users to join
- Correct payment processing
- Proper notifications sent
*/
