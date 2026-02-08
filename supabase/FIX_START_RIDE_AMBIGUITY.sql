-- ==========================================
-- FIX: START RIDE AMBIGUITY & STATUS SYNC
-- ==========================================
-- Problema detectado: Existen múltiples versiones de 'start_ride' en el historial
-- de migraciones (algunas requieren PIN, otras no; algunas usan 'active', otras 'in_progress').
-- Esto puede causar que el botón "Iniciar Viaje" falle o que el estado no se refleje en la UI.
-- 1. Eliminar versiones antiguas para evitar conflictos
DROP FUNCTION IF EXISTS public.start_ride(UUID);
DROP FUNCTION IF EXISTS public.start_ride(UUID, TEXT);
-- 2. Crear versión estandarizada (V3)
-- - Acepta solo ride_id (la verificación de PIN se hace ANTES paso a paso)
-- - Establece estado 'active' (el estándar más reciente)
-- - Notifica a los pasajeros
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_ride RECORD;
v_passenger_id UUID;
BEGIN -- Verificaciones básicas
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Actualizar estado (Soporta transición desde scheduled)
UPDATE public.rides
SET status = 'active',
    started_at = NOW()
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled'
RETURNING * INTO v_ride;
IF NOT FOUND THEN -- Verificar por qué falló (si ya estaba activo o no es el conductor)
SELECT status INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id;
IF FOUND
AND (
    v_ride.status = 'active'
    OR v_ride.status = 'in_progress'
) THEN RETURN json_build_object(
    'success',
    true,
    'message',
    'El viaje ya estaba iniciado'
);
END IF;
RAISE EXCEPTION 'No se puede iniciar el viaje (verifique permisos o estado).';
END IF;
-- Notificar a pasajeros (Intentar llamar a create_notification si existe)
-- Usamos un bloque anónimo seguro para no fallar si notification no existe
BEGIN FOR v_passenger_id IN
SELECT unnest(v_ride.participant_ids) LOOP IF v_passenger_id != v_driver_id THEN -- Intentamos insertar notificación básica directamente si la función compleja falla
INSERT INTO public.notifications (user_id, title, body, type, data)
VALUES (
        v_passenger_id,
        '¡Viaje iniciado!',
        'Tu conductor ha iniciado la ruta. ¡Buen viaje!',
        'ride_started',
        jsonb_build_object('ride_id', p_ride_id)
    );
END IF;
END LOOP;
EXCEPTION
WHEN OTHERS THEN -- Si falla la notificación, no bloqueamos el inicio del viaje
RAISE WARNING 'No se pudieron enviar notificaciones: %',
SQLERRM;
END;
RETURN json_build_object('success', true, 'status', 'active');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Confirmación
SELECT 'Función start_ride estandarizada a la versión (UUID) -> active' as status;