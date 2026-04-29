-- ==============================================================================
-- 🛡️ SHAREWAY ELITE: SOS ENGINE & CRITICAL RESPONSE SYSTEM
-- Sincronización Total del Protocolo de Seguridad
-- ==============================================================================

-- 1. ASEGURAR PERFIL DE SISTEMA (Para mensajes automáticos)
INSERT INTO public.profiles (id, full_name, email, display_name, photo_url)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'ShareWay Security',
    'security@shareway.app',
    'Seguridad ShareWay',
    'https://wmkhutsesgtkcgqbctef.supabase.co/storage/v1/object/public/assets/security-badge.png'
) ON CONFLICT (id) DO NOTHING;

-- 2. AMPLIAR TIPOS DE CHAT
ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE public.chats ADD CONSTRAINT chats_type_check CHECK (type IN ('group', 'individual', 'support', 'emergency'));

-- 3. RE-DISEÑAR trigger_emergency_alert_v2 (Sincronizado con UUIDs)
DROP FUNCTION IF EXISTS public.trigger_emergency_alert_v2(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.trigger_emergency_alert_v2(
    p_ride_id UUID,
    p_current_location JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_name TEXT;
    v_alert_id UUID;
    v_ride_record RECORD;
    v_chat_id UUID;
    v_contact RECORD;
    v_admin RECORD;
BEGIN
    -- 1. Validaciones
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;

    SELECT display_name INTO v_user_name FROM public.profiles WHERE id = v_user_id;
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id;

    IF v_ride_record.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND'); END IF;

    -- 2. Crear Registro de Alerta
    INSERT INTO public.emergency_alerts (
        ride_id, user_id, location, status, severity, ride_snapshot
    ) VALUES (
        p_ride_id, v_user_id, p_current_location, 'active', 'critical',
        jsonb_build_object(
            'driver_id', v_ride_record.driver_id,
            'vehicle', COALESCE(v_ride_record.vehicle_model, 'No especificado'),
            'plate', COALESCE(v_ride_record.vehicle_plate, 'S/N')
        )
    ) RETURNING id INTO v_alert_id;

    -- 3. Crear o Recuperar el Chat de Emergencia (UUID Legítimo)
    -- Usamos un nombre determinista para el chat para que el frontend pueda encontrarlo o buscarlo
    SELECT id INTO v_chat_id FROM public.chats
    WHERE ride_id = p_ride_id AND type = 'emergency' LIMIT 1;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (ride_id, type, participants, participant_names)
        VALUES (
            p_ride_id,
            'emergency',
            ARRAY[v_user_id, '00000000-0000-0000-0000-000000000000'::UUID], -- Usuario + Sistema
            jsonb_build_object(v_user_id::text, v_user_name, '00000000-0000-0000-0000-000000000000', 'Seguridad ShareWay')
        ) RETURNING id INTO v_chat_id;
    END IF;

    -- 4. Notificar a Contactos
    FOR v_contact IN SELECT * FROM public.emergency_contacts WHERE user_id = v_user_id LOOP
        INSERT INTO public.notifications (user_id, type, title, body, priority, category, data)
        VALUES (
            v_contact.user_id, 'emergency_alert', '🚨 SOS: ' || v_user_name,
            'Alerta crítica en trayecto actual.', 'urgent', 'ride',
            jsonb_build_object('alert_id', v_alert_id, 'ride_id', p_ride_id, 'chat_id', v_chat_id)
        );
    END LOOP;

    -- 5. Mensaje de Sistema Inicial
    INSERT INTO public.messages (chat_id, sender_id, content)
    VALUES (
        v_chat_id,
        '00000000-0000-0000-0000-000000000000'::UUID,
        '🚨 PROTOCOLO SOS ACTIVADO. Estamos compartiendo tu ubicación en tiempo real. Mantén la calma.'
    );

    RETURN jsonb_build_object(
        'success', true,
        'alertId', v_alert_id,
        'chatId', v_chat_id,
        'message', 'Protocolo SOS iniciado con éxito'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
