-- ==============================================================================
-- FIX: PERMITIR MENSAJES DE SISTEMA EN VIAJES CANCELADOS Y ESTANDARIZACIÓN RPC
-- Resuelve el Error 400: "No se pueden enviar mensajes en un viaje cancelado"
-- ==============================================================================

-- 1. Actualizar la función de validación de chat para ser más flexible
-- Se ejecuta ANTES de insertar un mensaje.
CREATE OR REPLACE FUNCTION public.check_chat_active_fn() RETURNS TRIGGER AS $$
DECLARE
    v_ride_id UUID;
    v_ride_status TEXT;
    v_completed_at TIMESTAMPTZ;
BEGIN
    -- Obtener el ride_id asociado al chat
    SELECT ride_id INTO v_ride_id
    FROM public.chats
    WHERE id = NEW.chat_id;

    -- Si no hay viaje asociado, permitir (chats directos permanentes)
    IF v_ride_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Verificar el estado del viaje asociado
    SELECT status, completed_at INTO v_ride_status, v_completed_at
    FROM public.rides
    WHERE id = v_ride_id;

    -- Bloqueo por privacidad: 24h después de completado
    IF v_ride_status = 'completed' AND (v_completed_at + INTERVAL '24 hours') < NOW() THEN
        RAISE EXCEPTION 'El chat para este viaje ha sido cerrado por privacidad (límite 24h superado).';
    END IF;

    -- Bloqueo por cancelación: PERMITIR MENSAJES SI SON DE SISTEMA
    IF v_ride_status = 'cancelled' THEN
        -- Si el contenido tiene el prefijo de sistema o palabras de notificación, permitir.
        -- Esto permite que la transacción de cancelación (que ocurre en el mismo bloque)
        -- pueda insertar el mensaje de despedida.
        IF (NEW.content LIKE 'SISTEMA:%' OR NEW.content LIKE '%cancelado%' OR NEW.content LIKE '%reembolsado%') THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'No se pueden enviar mensajes en un viaje cancelado.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Asegurar que cancel_ride NO envíe mensajes si no está preparado, o que use el prefijo SISTEMA
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_chat_id UUID;
BEGIN
    -- 1. Obtener y bloquear el viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede cancelar este viaje'; END IF;
    IF v_ride_record.status IN ('completed', 'cancelled') THEN RETURN jsonb_build_object('success', true, 'message', 'El viaje ya ha finalizado o ya está cancelado'); END IF;

    -- Obtener chat_id para el mensaje de sistema
    SELECT id INTO v_chat_id FROM public.chats WHERE ride_id = p_ride_id AND type = 'group' LIMIT 1;

    -- 2. Devolver dinero a TODOS los pasajeros
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_booked_price := (v_passenger->>'booked_price')::DECIMAL;

        IF v_passenger->>'status' = 'confirmed' OR v_passenger->>'status' = 'pending' THEN
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_booked_price),
                balance = balance + v_booked_price,
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso: Viaje cancelado por conductor (' || v_ride_record.origin->>'name' || ')', p_ride_id);

            INSERT INTO public.notifications (user_id, type, title, body)
            VALUES (v_passenger_id, 'ride_cancelled', 'Viaje Cancelado', 'El conductor ha cancelado el viaje. Se ha reembolsado tu dinero.');
        END IF;
    END LOOP;

    -- 3. INSERTAR MENSAJE DE SISTEMA (Debe hacerse ANTES o DURANTE el cambio de estado,
    -- pero el trigger check_chat_active_fn ahora lo permitirá por el prefijo SISTEMA)
    IF v_chat_id IS NOT NULL THEN
        INSERT INTO public.messages (chat_id, sender_id, content)
        VALUES (v_chat_id, v_driver_id, 'SISTEMA: Este viaje ha sido cancelado por el conductor. Los reembolsos han sido procesados.');
    END IF;

    -- 4. Marcar el viaje como cancelado
    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado y reembolsos procesados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
