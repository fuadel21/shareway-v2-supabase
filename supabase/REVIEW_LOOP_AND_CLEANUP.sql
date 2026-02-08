-- SHAREWAY V2: REVIEW LOOP & CLEANUP
-- Objetivo: Asegurar que los usuarios valoren después de cada viaje y limpiar triggers redundantes.
-- 1. LIMPIEZA: Eliminar trigger del Match Engine duplicado (ahora lo hace SQL nativo más rápido)
DROP TRIGGER IF EXISTS on_new_ride_invoke_match_engine ON public.rides;
DROP TRIGGER IF EXISTS on_new_ride_request_invoke_match_engine ON public.ride_requests;
-- 2. MEJORA: Notificación de Valoración al finalizar viaje
CREATE OR REPLACE FUNCTION public.handle_ride_completion_reviews() RETURNS TRIGGER AS $$
DECLARE v_pax JSONB;
BEGIN IF NEW.status = 'completed'
AND OLD.status != 'completed' THEN -- 1. Notificar a los PASAJEROS para que valoren al CONDUCTOR
FOR v_pax IN
SELECT *
FROM jsonb_array_elements(NEW.passengers) LOOP IF v_pax->>'status' IN ('verified', 'no_show') THEN PERFORM public.create_notification(
        (v_pax->>'id')::UUID,
        '¿Qué tal el viaje? ⭐',
        'El viaje ha finalizado. Tómate un momento para valorar a ' || (
            SELECT display_name
            FROM public.profiles
            WHERE id = NEW.driver_id
        ),
        'review',
        jsonb_build_object('ride_id', NEW.id, 'reviewee_id', NEW.driver_id)
    );
END IF;
END LOOP;
-- Nota: El requisito actual dice que el conductor NO valora a los pasajeros.
-- Si eso cambia, se añadiría aquí la lógica inversa.
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_ride_completed_send_review_notif ON public.rides;
CREATE TRIGGER on_ride_completed_send_review_notif
AFTER
UPDATE OF status ON public.rides FOR EACH ROW EXECUTE FUNCTION public.handle_ride_completion_reviews();