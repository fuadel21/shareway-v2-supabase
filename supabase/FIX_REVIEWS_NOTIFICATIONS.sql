-- ==========================================
-- SCRIPT DE SEGURIDAD: RESEÑAS Y NOTIFICACIONES
-- ==========================================
-- 1. Corrige validación en reseñas (evita fakes)
-- 2. Añade limpieza de notificaciones antiguas
-- ==========================================
-- 1. CORRECCIÓN: submit_reviews
-- Añade validación estricta de participación y estado del viaje
CREATE OR REPLACE FUNCTION public.submit_reviews(
        p_ride_id UUID,
        p_reviews JSONB -- [{target_id: UUID, rating: INT, comment: TEXT}]
    ) RETURNS JSON AS $$
DECLARE v_author_id UUID;
v_review JSONB;
v_ride_status TEXT;
v_driver_id UUID;
v_participant_ids UUID [];
v_is_participant BOOLEAN;
v_target_id UUID;
BEGIN v_author_id := auth.uid();
IF v_author_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Obtener datos del viaje para validación
SELECT status,
    driver_id,
    participant_ids INTO v_ride_status,
    v_driver_id,
    v_participant_ids
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- 1. Validar estado del viaje
IF v_ride_status != 'completed' THEN RAISE EXCEPTION 'Solo se pueden valorar viajes completados';
END IF;
-- 2. Validar que el AUTOR participó en el viaje
IF v_author_id != v_driver_id
AND NOT (v_author_id = ANY(v_participant_ids)) THEN RAISE EXCEPTION 'No puedes valorar un viaje en el que no participaste';
END IF;
-- Iterar sobre las reviews
FOR v_review IN
SELECT *
FROM jsonb_array_elements(p_reviews) LOOP v_target_id := (v_review->>'target_id')::UUID;
-- 3. Validar que el OBJETIVO participó en el viaje
IF v_target_id != v_driver_id
AND NOT (v_target_id = ANY(v_participant_ids)) THEN -- Saltamos esta review silenciosamente o lanzamos error? Mejor lanzar error para alertar fraude.
RAISE EXCEPTION 'El usuario a valorar no participó en este viaje';
END IF;
-- 4. No auto-reviews
IF v_target_id = v_author_id THEN CONTINUE;
-- Saltar si intenta valorarse a sí mismo
END IF;
-- Insertar review
INSERT INTO public.reviews (
        ride_id,
        author_id,
        target_id,
        rating,
        comment
    )
VALUES (
        p_ride_id,
        v_author_id,
        v_target_id,
        (v_review->>'rating')::INTEGER,
        v_review->>'comment'
    ) ON CONFLICT (ride_id, author_id, target_id) DO
UPDATE
SET rating = EXCLUDED.rating,
    comment = EXCLUDED.comment,
    created_at = NOW();
-- Permitir actualizar la reseña
-- NOTA: El trigger 'tr_update_rating' se encargará automáticamente de actualizar
-- el rating y review_count del perfil. No lo hacemos aquí para evitar conflictos.
END LOOP;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. MANTENIMIENTO: cleanup_notifications
-- Limpia notificaciones antiguas para mantener la BD ligera
CREATE OR REPLACE FUNCTION public.cleanup_notifications() RETURNS JSON AS $$
DECLARE v_deleted_count INTEGER;
BEGIN -- Borrar notificaciones antiguas (> 30 días)
-- Opcional: Solo borrar las leídas (read = true) si se quiere histérico estricto,
-- pero para apps móviles tipo Uber, el historial infinito no suele ser útil.
-- Aquí borramos TODAS las de más de 60 días, y las LEÍDAS de más de 30 días.
DELETE FROM public.notifications
WHERE (created_at < NOW() - INTERVAL '60 days')
    OR (
        read = true
        AND created_at < NOW() - INTERVAL '30 days'
    );
GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
RETURN json_build_object(
    'success',
    true,
    'deleted_count',
    v_deleted_count
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Resumen
DO $$ BEGIN RAISE NOTICE '✅ Correcciones aplicadas:';
RAISE NOTICE '   - submit_reviews: Validación estricta anti-fraude';
RAISE NOTICE '   - cleanup_notifications: Función de mantenimiento creada';
END $$;