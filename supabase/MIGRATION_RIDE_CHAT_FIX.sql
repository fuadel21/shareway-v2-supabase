-- ==========================================
-- FUNCIÓN: get_or_create_ride_chat
-- Asegurar que existe un chat grupal para un viaje y sincronizar participantes
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_or_create_ride_chat(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_chat_id UUID;
v_driver_id UUID;
v_participant_ids UUID [];
v_passenger_ids UUID [];
BEGIN -- 1. Obtener datos del viaje
SELECT driver_id,
    participant_ids INTO v_driver_id,
    v_participant_ids
FROM public.rides
WHERE id = p_ride_id;
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- 2. Asegurar que el conductor esté en la lista de participantes
IF NOT (v_driver_id = ANY(v_participant_ids)) THEN v_participant_ids := array_append(v_participant_ids, v_driver_id);
END IF;
-- 3. Buscar chat grupal vinculado al viaje
SELECT id INTO v_chat_id
FROM public.chats
WHERE ride_id = p_ride_id
LIMIT 1;
-- 4. Si no existe, crearlo
IF v_chat_id IS NULL THEN
INSERT INTO public.chats (
        ride_id,
        participants
    )
VALUES (
        p_ride_id,
        v_participant_ids
    )
RETURNING id INTO v_chat_id;
ELSE -- Sincronizar participantes si el chat ya existe
UPDATE public.chats
SET participants = v_participant_ids,
    updated_at = NOW()
WHERE id = v_chat_id;
END IF;
-- 5. Vincular el chat_id a la tabla de rides (opcional pero recomendado para joins rápidos)
-- Asumiendo que existe una columna chat_id o similar, de lo contrario la lógica del join en el front funcionará.
RETURN json_build_object('success', true, 'chatId', v_chat_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;