-- ========================================================
-- FIX: Función para cancelar solicitudes de viaje
-- ========================================================

CREATE OR REPLACE FUNCTION public.cancel_ride_request(p_request_id UUID)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_request_record RECORD;
BEGIN
    -- 1. Obtener y bloquear la solicitud
    SELECT * INTO v_request_record 
    FROM public.ride_requests 
    WHERE id = p_request_id FOR UPDATE;

    IF v_request_record.id IS NULL THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;

    -- 2. Verificar propiedad
    IF v_request_record.requester_id != v_user_id THEN
        RAISE EXCEPTION 'No tienes permiso para cancelar esta solicitud';
    END IF;

    -- 3. Verificar estado (solo si no está ya cancelada o finalizada)
    IF v_request_record.status IN ('cancelled', 'fulfilled', 'confirmed') THEN
        RAISE EXCEPTION 'Esta solicitud no se puede cancelar en su estado actual (%)', v_request_record.status;
    END IF;

    -- 4. Actualizar estado
    UPDATE public.ride_requests
    SET 
        status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_request_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Solicitud cancelada correctamente'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario para auditoría
COMMENT ON FUNCTION public.cancel_ride_request IS 'Cancela una solicitud de viaje por parte del usuario que la creó';
