-- ==========================================
-- CANCEL RIDE REQUEST FUNCTION
-- ==========================================
-- Add this to your EMERGENCY_FIX_RPC_FUNCTIONS.sql file

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
    
    -- Registrar en log (si la tabla existe)
    BEGIN
        INSERT INTO public.rpc_error_logs (
            function_name,
            error_message,
            user_id,
            params
        ) VALUES (
            'cancel_ride_request',
            'Request cancelled successfully',
            v_requester_id,
            json_build_object('request_id', p_request_id, 'previous_status', v_request_status)
        );
    EXCEPTION
        WHEN undefined_table THEN
            -- Table doesn't exist, skip logging
            NULL;
    END;
    
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
        -- Registrar error para debugging
        BEGIN
            INSERT INTO public.rpc_error_logs (
                function_name,
                error_message,
                error_detail,
                user_id,
                params
            ) VALUES (
                'cancel_ride_request',
                SQLERRM,
                SQLSTATE,
                v_requester_id,
                json_build_object('request_id', p_request_id)
            );
        EXCEPTION
            WHEN undefined_table THEN
                -- Table doesn't exist, skip error logging
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
-- VERIFICATION
-- ==========================================

-- Verify the function was created
SELECT 
    proname as function_name,
    pronargs as parameter_count,
    prorettype::regtype as return_type,
    'CREATED SUCCESSFULLY' as status
FROM pg_proc 
WHERE proname = 'cancel_ride_request' 
    AND pronamespace = 'public'::regnamespace;

-- ==========================================
-- TEST QUERY (uncomment to test)
-- ==========================================
/*
-- Test the function (replace with real request ID):
SELECT public.cancel_ride_request('00000000-0000-0000-0000-000000000000');
*/
