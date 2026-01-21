-- ==========================================
-- ELITE_MATCHING_ENGINE.sql
-- Motor de Matching Avanzado (Path-to-Point)
-- Optimizado para Eficiencia de Desvío (EDI)
-- ==========================================
-- 1. Función auxiliar para decodificar polilíneas (Opcional si usamos Geometrías directas)
-- Nota: En Supabase PostGIS, a veces es más eficiente pasar la geometría ya calculada.
-- Asumimos que r.overview_polyline puede ser convertida o ya tenemos r.route_line.
-- 2. FUNCIÓN: search_rides_v3_edi
-- Búsqueda inteligente basada en la trayectoria del conductor.
CREATE OR REPLACE FUNCTION public.search_rides_v3_edi(
        p_origin_lat FLOAT,
        p_origin_lng FLOAT,
        p_destination_lat FLOAT,
        p_destination_lng FLOAT,
        p_departure_time TIMESTAMPTZ,
        p_time_flexibility_hours INTEGER DEFAULT 2,
        p_max_detour_km FLOAT DEFAULT 5.0
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating NUMERIC,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price NUMERIC,
        is_women_only BOOLEAN,
        detour_score FLOAT -- 0 a 1, donde 1 es coincidencia perfecta
    ) AS $$
DECLARE v_passenger_origin GEOGRAPHY;
v_passenger_destination GEOGRAPHY;
v_searcher_gender TEXT;
v_searcher_id UUID;
BEGIN v_searcher_id := auth.uid();
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_passenger_origin := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::GEOGRAPHY;
v_passenger_destination := ST_SetSRID(
    ST_MakePoint(p_destination_lng, p_destination_lat),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    p.rating,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.is_women_only,
    -- Cálculo de Detour Score simplificado por ahora:
    -- (Distancia origen + Distancia destino) vs p_max_detour_km
    (
        1.0 - (
            GREATEST(
                ST_Distance(r.origin_location, v_passenger_origin),
                ST_Distance(r.destination_location, v_passenger_destination)
            ) / (p_max_detour_km * 1000.0)
        )
    ) AS detour_score
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status = 'scheduled'
    AND r.seats_available > 0 -- Filtro de Tiempo Flexible
    AND r.departure_time BETWEEN (
        p_departure_time - (p_time_flexibility_hours || ' hours')::INTERVAL
    )
    AND (
        p_departure_time + (p_time_flexibility_hours || ' hours')::INTERVAL
    ) -- Filtro Geográfico (Ambos puntos dentro del rango de desvío aceptable)
    AND ST_Distance(r.origin_location, v_passenger_origin) <= (p_max_detour_km * 1000)
    AND ST_Distance(r.destination_location, v_passenger_destination) <= (p_max_detour_km * 1000) -- Filtro de Género
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY detour_score DESC,
    r.departure_time ASC
LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;
-- 3. RPC: find_matching_requests_for_ride
-- Usado por el Edge Function para notificar pasajeros relevantes.
CREATE OR REPLACE FUNCTION public.find_matching_requests_for_ride(p_ride_id UUID) RETURNS TABLE(id UUID, requester_id UUID) AS $$
DECLARE v_ride_origin GEOGRAPHY;
v_ride_destination GEOGRAPHY;
v_ride_time TIMESTAMPTZ;
BEGIN
SELECT origin_location,
    destination_location,
    departure_time INTO v_ride_origin,
    v_ride_destination,
    v_ride_time
FROM public.rides
WHERE id = p_ride_id;
RETURN QUERY
SELECT rr.id,
    rr.requester_id
FROM public.ride_requests rr
WHERE rr.status = 'pending'
    AND ST_Distance(rr.origin_location, v_ride_origin) < 5000
    AND ST_Distance(rr.destination_location, v_ride_destination) < 5000
    AND ABS(
        EXTRACT(
            EPOCH
            FROM (rr.departure_time - v_ride_time)
        )
    ) < 7200;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 4. RPC: find_matching_rides_for_request
-- Usado por el Edge Function para notificar conductores relevantes.
CREATE OR REPLACE FUNCTION public.find_matching_rides_for_request(p_request_id UUID) RETURNS TABLE(id UUID, driver_id UUID) AS $$
DECLARE v_req_origin GEOGRAPHY;
v_req_destination GEOGRAPHY;
v_req_time TIMESTAMPTZ;
BEGIN
SELECT origin_location,
    destination_location,
    departure_time INTO v_req_origin,
    v_req_destination,
    v_req_time
FROM public.ride_requests
WHERE id = p_request_id;
RETURN QUERY
SELECT r.id,
    r.driver_id
FROM public.rides r
WHERE r.status = 'scheduled'
    AND r.seats_available > 0
    AND ST_Distance(r.origin_location, v_req_origin) < 5000
    AND ST_Distance(r.destination_location, v_req_destination) < 5000
    AND ABS(
        EXTRACT(
            EPOCH
            FROM (r.departure_time - v_req_time)
        )
    ) < 7200;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 5. TRIGGER / BACKGROUND MATCHING: notify_matches
-- Esta función debería ser llamada cuando se crea un ride o un request.
-- Sustituye la lógica ineficiente del match-engine actual.
CREATE OR REPLACE FUNCTION public.notify_matches() RETURNS TRIGGER AS $$ BEGIN IF (TG_TABLE_NAME = 'ride_requests') THEN -- Cuando alguien pide un viaje, buscar conductores compatibles y notificarles
INSERT INTO public.notifications (user_id, payload)
SELECT r.driver_id,
    jsonb_build_object(
        'title',
        '¡Pasajero compatible!',
        'content',
        'Alguien busca un viaje en tu ruta hacia ' || (NEW.destination->>'address'),
        'type',
        'match',
        'data',
        jsonb_build_object('request_id', NEW.id, 'ride_id', r.id)
    )
FROM public.rides r
WHERE r.status = 'scheduled'
    AND ST_Distance(r.origin_location, NEW.origin_location) < 5000
    AND ST_Distance(r.destination_location, NEW.destination_location) < 5000
    AND ABS(
        EXTRACT(
            EPOCH
            FROM (r.departure_time - NEW.departure_time)
        )
    ) < 7200;
ELSIF (TG_TABLE_NAME = 'rides') THEN -- Cuando un conductor publica, buscar pasajeros esperando y notificarles
INSERT INTO public.notifications (user_id, payload)
SELECT rr.requester_id,
    jsonb_build_object(
        'title',
        '¡Viaje encontrado!',
        'content',
        'Se ha publicado un viaje que coincide con tu solicitud a ' || (rr.destination->>'address'),
        'type',
        'match',
        'data',
        jsonb_build_object('ride_id', NEW.id, 'request_id', rr.id)
    )
FROM public.ride_requests rr
WHERE rr.status = 'pending'
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
    ) < 7200;
END IF;
RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;