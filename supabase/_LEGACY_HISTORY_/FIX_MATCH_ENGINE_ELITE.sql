-- SHAREWAY V2: ELITE MATCH ENGINE REINFORCEMENT
-- Objetivo: Prevenir spam, respetar filtros de género y mejorar precisión.
-- 1. Añadir restricción anti-spam a las notificaciones (opcional pero recomendado)
-- Para este sistema, usaremos una lógica en el trigger.
-- 2. Mejorar la función notify_matches()
CREATE OR REPLACE FUNCTION public.notify_matches() RETURNS TRIGGER AS $$
DECLARE v_requester_gender TEXT;
v_driver_gender TEXT;
BEGIN IF (TG_TABLE_NAME = 'ride_requests') THEN -- Obtener género del pasajero
SELECT gender INTO v_requester_gender
FROM public.profiles
WHERE id = NEW.requester_id;
-- Buscar conductores y notificarles
INSERT INTO public.notifications (user_id, payload)
SELECT r.driver_id,
    jsonb_build_object(
        'title',
        '¡Pasajero compatible!',
        'content',
        'Alguien busca un viaje hacia ' || COALESCE(
            NEW.destination->>'name',
            NEW.destination->>'address',
            'su destino'
        ),
        'type',
        'match',
        'data',
        jsonb_build_object('request_id', NEW.id, 'ride_id', r.id)
    )
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status = 'scheduled'
    AND r.seats_available >= NEW.seats_needed -- RADIUS: 5km (ajustable)
    AND ST_Distance(r.origin_location, NEW.origin_location) < 5000
    AND ST_Distance(r.destination_location, NEW.destination_location) < 5000
    AND ABS(
        EXTRACT(
            EPOCH
            FROM (r.departure_time - NEW.departure_time)
        )
    ) < 7200 -- FILTRO GÉNERO: Respetar Women Only
    AND (
        NOT r.is_women_only
        OR v_requester_gender = 'female'
    ) -- ANTI-SPAM: No repetir notificación idéntica en las últimas 24h
    AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = r.driver_id
            AND n.payload->'data'->>'request_id' = NEW.id::text
            AND n.payload->'data'->>'ride_id' = r.id::text
            AND n.created_at > (NOW() - INTERVAL '24 hours')
    );
ELSIF (TG_TABLE_NAME = 'rides') THEN -- Obtener género del conductor
SELECT gender INTO v_driver_gender
FROM public.profiles
WHERE id = NEW.driver_id;
-- Buscar pasajeros esperando y notificarles
INSERT INTO public.notifications (user_id, payload)
SELECT rr.requester_id,
    jsonb_build_object(
        'title',
        '¡Viaje encontrado!',
        'content',
        'Se ha publicado un viaje hacia ' || COALESCE(
            rr.destination->>'name',
            rr.destination->>'address',
            'tu destino'
        ),
        'type',
        'match',
        'data',
        jsonb_build_object('ride_id', NEW.id, 'request_id', rr.id)
    )
FROM public.ride_requests rr
    JOIN public.profiles p ON rr.requester_id = p.id
WHERE rr.status = 'pending'
    AND NEW.seats_available >= rr.seats_needed
    AND ST_Distance(rr.origin_location, NEW.origin_location) < 5000
    AND ST_Distance(
        rr.destination_location,
        NEW.destination_location
    ) < 5000
    AND ABS(
        EXTRACT(
            EPOCH
            FROM (rr.departure_time - NEW.departure_time)
        )
    ) < 7200 -- FILTRO GÉNERO
    AND (
        NOT NEW.is_women_only
        OR p.gender = 'female'
    ) -- El conductor no puede ser el mismo que el pasajero
    AND rr.requester_id != NEW.driver_id -- ANTI-SPAM
    AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = rr.requester_id
            AND n.payload->'data'->>'ride_id' = NEW.id::text
            AND n.payload->'data'->>'request_id' = rr.id::text
            AND n.created_at > (NOW() - INTERVAL '24 hours')
    );
END IF;
RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Re-instalar el trigger (Asegurarse de que están activos)
DROP TRIGGER IF EXISTS tr_notify_matches_rides ON public.rides;
CREATE TRIGGER tr_notify_matches_rides
AFTER
INSERT
    OR
UPDATE OF status,
    seats_available ON public.rides FOR EACH ROW
    WHEN (NEW.status = 'scheduled') EXECUTE FUNCTION public.notify_matches();
DROP TRIGGER IF EXISTS tr_notify_matches_requests ON public.ride_requests;
CREATE TRIGGER tr_notify_matches_requests
AFTER
INSERT
    OR
UPDATE OF status ON public.ride_requests FOR EACH ROW
    WHEN (NEW.status = 'pending') EXECUTE FUNCTION public.notify_matches();