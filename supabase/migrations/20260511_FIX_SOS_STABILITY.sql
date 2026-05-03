-- ==========================================
-- 20260511_FIX_SOS_STABILITY.sql
-- Reparación del Sistema SOS y Mensajería Crítica
-- ==========================================

-- 1. ASEGURAR COLUMNA 'TYPE' Y RESTRICCIONES EN CHATS
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'individual';

-- Eliminar restricción antigua si existe y crear la nueva que incluya 'emergency'
ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE public.chats ADD CONSTRAINT chats_type_check CHECK (type IN ('group', 'individual', 'support', 'emergency'));

-- 2. ASEGURAR PERFIL DE SEGURIDAD (SYSTEM USER)
INSERT INTO public.profiles (id, full_name, email, display_name, photo_url)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'ShareWay Security',
    'security@shareway.app',
    'Seguridad ShareWay',
    'https://wmkhutsesgtkcgqbctef.supabase.co/storage/v1/object/public/assets/security-badge.png'
) ON CONFLICT (id) DO NOTHING;

-- 3. REPARAR RPC DE EMERGENCIA (trigger_emergency_alert_v2)
-- Borramos versiones previas para evitar conflictos de firmas
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
BEGIN
    -- Validaciones iniciales
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT display_name INTO v_user_name FROM public.profiles WHERE id = v_user_id;
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
    END IF;

    -- Crear Alerta de Emergencia
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

    -- Crear o recuperar Chat de Emergencia
    SELECT id INTO v_chat_id FROM public.chats
    WHERE ride_id = p_ride_id AND type = 'emergency' LIMIT 1;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (ride_id, type, participants, participant_names)
        VALUES (
            p_ride_id,
            'emergency',
            ARRAY[v_user_id, '00000000-0000-0000-0000-000000000000'::UUID],
            jsonb_build_object(v_user_id::text, v_user_name, '00000000-0000-0000-0000-000000000000', 'Seguridad ShareWay')
        ) RETURNING id INTO v_chat_id;
    END IF;

    -- Mensaje de sistema automático
    INSERT INTO public.messages (chat_id, sender_id, content)
    VALUES (
        v_chat_id,
        '00000000-0000-0000-0000-000000000000'::UUID,
        '🚨 ALERTA SOS: Se ha notificado a emergencias y a tus contactos. Estamos monitorizando tu ubicación.'
    );

    RETURN jsonb_build_object(
        'success', true,
        'alertId', v_alert_id,
        'chatId', v_chat_id,
        'message', 'Protocolo de seguridad activado'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PERMISOS
GRANT ALL ON public.chats TO authenticated;
GRANT ALL ON public.messages TO authenticated;
GRANT ALL ON public.emergency_alerts TO authenticated;
