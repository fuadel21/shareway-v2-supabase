-- ========================================================
-- SHAREWAY V2 - SECURITY HARDENING & CHAT INTEGRITY
-- ========================================================

-- LIMPIEZA DE VERSIONES ANTERIORES (Solución al error del screenshot)
DROP FUNCTION IF EXISTS public.get_or_create_chat_v2(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_ride_details_secure(uuid);

-- 1. REFORZAR CREACIÓN DE CHATS (Evitar auto-chats y validar existencia)
CREATE OR REPLACE FUNCTION public.get_or_create_chat_v2(
    p_other_user_id UUID,
    p_ride_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_chat_id UUID;
    v_current_user UUID := auth.uid();
BEGIN
    IF v_current_user = p_other_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'No puedes crear un chat contigo mismo');
    END IF;

    -- Buscar chat existente entre estos dos usuarios para este viaje (o chat directo)
    SELECT id INTO v_chat_id
    FROM public.chats
    WHERE participants @> ARRAY[v_current_user, p_other_user_id]
      AND (p_ride_id IS NULL OR ride_id = p_ride_id)
    LIMIT 1;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (participants, ride_id, updated_at)
        VALUES (ARRAY[v_current_user, p_other_user_id], p_ride_id, NOW())
        RETURNING id INTO v_chat_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'chatId', v_chat_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. BLINDAJE DE DETALLES DE VIAJE (Privacidad de PIN)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_is_driver BOOLEAN;
    v_is_passenger BOOLEAN;
BEGIN
    SELECT
        (driver_id = auth.uid()),
        (participant_ids @> ARRAY[auth.uid()])
    INTO v_is_driver, v_is_passenger
    FROM public.rides WHERE id = p_ride_id;

    RETURN json_build_object(
        'id', r.id,
        'driver_id', r.driver_id,
        'driver_name', p.display_name,
        'driver_photo', p.photo_url,
        'origin', r.origin,
        'destination', r.destination,
        'departure_time', r.departure_time,
        'status', r.status,
        'seats_available', r.seats_available,
        'passengers', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', (elem.val->>'id')::UUID,
                    'status', elem.val->>'status',
                    'displayName', prof.display_name,
                    -- Solo mostrar PIN al conductor o al propio pasajero
                    'pin', CASE
                        WHEN (elem.val->>'id')::UUID = auth.uid() OR v_is_driver
                        THEN elem.val->>'pin'
                        ELSE '****'
                    END
                )
            )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem(val)
            LEFT JOIN public.profiles prof ON (elem.val->>'id')::UUID = prof.id
        )
    )
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.id = p_ride_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. POLÍTICA DE MENSAJES (Hardened RLS)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants can read chat messages" ON public.messages;
CREATE POLICY "Participants can read chat messages" ON public.messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chats
            WHERE id = messages.chat_id
            AND participants @> ARRAY[auth.uid()]
        )
    );
