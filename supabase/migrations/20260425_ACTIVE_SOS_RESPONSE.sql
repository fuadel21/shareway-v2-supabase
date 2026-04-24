-- ==============================================================================
-- ACTIVE SOS RESPONSE: PROTOCOLO DE RESPUESTA CRÍTICA
-- ==============================================================================

-- 1. Mejorar la tabla de alertas con más contexto
ALTER TABLE public.emergency_alerts
ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'high',
ADD COLUMN IF NOT EXISTS ride_snapshot JSONB; -- Para guardar datos del conductor/coche en el momento del SOS

-- 2. REFACTOR: trigger_emergency_alert con Notificaciones Automáticas
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert_v2(
    p_ride_id UUID,
    p_current_location JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_name TEXT;
    v_alert_id UUID;
    v_ride_data RECORD;
    v_contact RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    -- A. Obtener datos básicos
    SELECT display_name INTO v_user_name FROM public.profiles WHERE id = v_user_id;
    SELECT * INTO v_ride_data FROM public.rides WHERE id = p_ride_id;

    -- B. Crear la Alerta con Snapshot
    INSERT INTO public.emergency_alerts (
        ride_id,
        user_id,
        location,
        ride_snapshot,
        status
    ) VALUES (
        p_ride_id,
        v_user_id,
        p_current_location,
        jsonb_build_object(
            'driver_id', v_ride_data.driver_id,
            'origin', v_ride_data.origin,
            'destination', v_ride_data.destination,
            'vehicle', (SELECT vehicle FROM public.profiles WHERE id = v_ride_data.driver_id)
        ),
        'active'
    ) RETURNING id INTO v_alert_id;

    -- C. NOTIFICAR A CONTACTOS DE EMERGENCIA (Loop)
    FOR v_contact IN
        SELECT * FROM public.emergency_contacts WHERE user_id = v_user_id
    LOOP
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            body,
            data,
            priority,
            category
        ) VALUES (
            v_contact.user_id, -- Nota: Si el contacto es usuario de la App, le llega push.
            'emergency_alert',
            '🚨 ALERTA SOS: ' || v_user_name,
            v_user_name || ' ha activado el botón de pánico en un viaje hacia ' || (v_ride_data.destination->>'address'),
            jsonb_build_object(
                'alert_id', v_alert_id,
                'ride_id', p_ride_id,
                'location', p_current_location,
                'phone', (SELECT phone FROM public.profiles WHERE id = v_user_id)
            ),
            'urgent',
            'system'
        );
    END LOOP;

    -- D. NOTIFICAR A ADMINISTRADORES
    -- Buscamos usuarios con rol admin y les enviamos alerta urgente
    INSERT INTO public.notifications (user_id, type, title, body, data, priority, category)
    SELECT id, 'emergency_alert', '🔴 SOS GLOBAL', v_user_name || ' en PELIGRO',
           jsonb_build_object('alert_id', v_alert_id, 'ride_id', p_ride_id), 'urgent', 'system'
    FROM public.profiles WHERE (verification->>'is_admin')::BOOLEAN = true;

    -- E. CREAR MENSAJE INICIAL EN EL CHAT DE EMERGENCIA
    INSERT INTO public.messages (
        sender_id,
        content,
        chat_id
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', -- ID de sistema
        '🚨 Protocolo SOS iniciado por ' || v_user_name || '. Ubicación: ' || COALESCE(p_current_location->>'lat', '?') || ',' || COALESCE(p_current_location->>'lng', '?'),
        'sos_' || p_ride_id::TEXT
    );

    RETURN jsonb_build_object(
        'success', true,
        'alertId', v_alert_id,
        'message', 'Protocolo SOS activado. Contactos y Soporte notificados.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
