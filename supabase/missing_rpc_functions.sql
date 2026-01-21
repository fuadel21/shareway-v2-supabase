-- Funciones RPC faltantes detectadas en el log de errores

-- 1. accept_request (CORREGIDO: Sin referencia a updated_at)
CREATE OR REPLACE FUNCTION public.accept_request(
    p_request_id UUID,
    p_ride_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_ride_driver_id UUID;
BEGIN
    v_driver_id := auth.uid();
    
    -- Validar autenticación
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Verificar propiedad del viaje
    SELECT driver_id INTO v_ride_driver_id
    FROM public.rides
    WHERE id = p_ride_id;

    IF v_ride_driver_id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado';
    END IF;

    IF v_ride_driver_id != v_driver_id THEN
        RAISE EXCEPTION 'No autorizado. Solo el conductor puede aceptar solicitudes para este viaje.';
    END IF;

    -- Actualizar la solicitud
    UPDATE public.ride_requests
    SET status = 'accepted',
        matched_ride_id = p_ride_id
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'message', 'Solicitud aceptada correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. cancel_ride_request
CREATE OR REPLACE FUNCTION public.cancel_ride_request(
    p_request_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_requester_id UUID;
BEGIN
    v_user_id := auth.uid();

    SELECT requester_id INTO v_requester_id
    FROM public.ride_requests
    WHERE id = p_request_id;

    IF v_requester_id != v_user_id THEN
         RAISE EXCEPTION 'No autorizado para cancelar esta solicitud';
    END IF;

    UPDATE public.ride_requests
    SET status = 'cancelled'
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'message', 'Solicitud cancelada');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. get_or_create_chat
CREATE OR REPLACE FUNCTION public.get_or_create_chat(
    p_other_user_id UUID,
    p_ride_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_chat_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
         RAISE EXCEPTION 'No autenticado';
    END IF;

    SELECT id INTO v_chat_id
    FROM public.chats
    WHERE participants @> ARRAY[v_user_id, p_other_user_id]
      AND participants @> ARRAY[p_other_user_id, v_user_id]
    LIMIT 1;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (participants, ride_id)
        VALUES (ARRAY[v_user_id, p_other_user_id], p_ride_id)
        RETURNING id INTO v_chat_id;
    END IF;

    RETURN json_build_object('success', true, 'chatId', v_chat_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
