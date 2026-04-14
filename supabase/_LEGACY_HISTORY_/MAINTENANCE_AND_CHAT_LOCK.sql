-- ==========================================
-- SCRIPT: MANTENIMIENTO MANUAL Y BLOQUEO DE CHAT
-- ==========================================
-- 1. FUNCIÓN PARA VERIFICAR SI UN CHAT ESTÁ BLOQUEADO
-- Bloquea mensajes si el viaje terminó hace más de 24 horas
CREATE OR REPLACE FUNCTION public.is_chat_locked(p_chat_id UUID) RETURNS BOOLEAN AS $$
DECLARE v_ride_id UUID;
v_ride_status TEXT;
v_completed_at TIMESTAMPTZ;
v_departure_time TIMESTAMPTZ;
BEGIN -- Obtener el viaje asociado al chat
SELECT ride_id INTO v_ride_id
FROM public.chats
WHERE id = p_chat_id;
-- Si no hay viaje (chat de soporte?), no se bloquea por tiempo de viaje
IF v_ride_id IS NULL THEN RETURN FALSE;
END IF;
-- Obtener info del viaje
SELECT status,
    completed_at,
    departure_time INTO v_ride_status,
    v_completed_at,
    v_departure_time
FROM public.rides
WHERE id = v_ride_id;
-- Lógica de bloqueo: 
-- 1. Si está cancelado, bloqueado (puedes dar 24h opcionalmente)
IF v_ride_status = 'cancelled' THEN RETURN TRUE;
END IF;
-- 2. Si está completado y pasó más de 24 horas
IF v_ride_status = 'completed'
AND (v_completed_at < NOW() - INTERVAL '24 hours') THEN RETURN TRUE;
END IF;
-- 3. Fallback: Si el viaje desapareció o algo raro, por seguridad permitimos 
-- pero si el departure_time fue hace más de una semana y sigue 'scheduled', algo está mal.
IF v_departure_time < NOW() - INTERVAL '7 days'
AND v_ride_status != 'active' THEN RETURN TRUE;
END IF;
RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 2. ACTUALIZAR RLS DE MENSAJES PARA USAR EL BLOQUEO
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages FOR
INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.chats c
            WHERE c.id = chat_id
                AND auth.uid() = ANY(c.participants)
        )
        AND NOT public.is_chat_locked(chat_id) -- << RESTRICCIÓN AGREGADA
    );
-- 3. FUNCIÓN DE MANTENIMIENTO MANUAL PARA EL ADMIN
CREATE OR REPLACE FUNCTION public.run_manual_maintenance_tasks() RETURNS JSON AS $$
DECLARE v_notif_cleaned INTEGER;
v_suspensions_lifted INTEGER;
BEGIN -- Verificar si es admin
IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
        AND is_admin = true
) THEN RAISE EXCEPTION 'Acceso denegado: Solo administradores.';
END IF;
-- 1. Limpieza de notificaciones (antiguas a 30 días)
DELETE FROM public.notifications
WHERE created_at < NOW() - INTERVAL '30 days'
RETURNING COUNT(*) INTO v_notif_cleaned;
-- 2. Levantar suspensiones
UPDATE public.profiles
SET is_suspended = false,
    suspension_until = NULL
WHERE is_suspended = true
    AND suspension_until < NOW();
GET DIAGNOSTICS v_suspensions_lifted = ROW_COUNT;
-- 3. Limpiar reservas expiradas
PERFORM public.clean_expired_requests();
PERFORM public.clean_pending_reservations();
RETURN json_build_object(
    'success',
    true,
    'notifications_cleaned',
    v_notif_cleaned,
    'suspensions_lifted',
    v_suspensions_lifted,
    'timestamp',
    NOW()
);
END $$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. DAR PERMISOS PARA EJECUTAR EL RPC
GRANT EXECUTE ON FUNCTION public.run_manual_maintenance_tasks() TO authenticated;
-- RESUMEN
DO $$ BEGIN RAISE NOTICE '✅ Mantenimiento y Bloqueo de Chat configurados.';
RAISE NOTICE '   - Mensajes bloqueados tras 24h de viaje completado.';
RAISE NOTICE '   - RPC run_manual_maintenance_tasks disponible para Admins.';
END $$;