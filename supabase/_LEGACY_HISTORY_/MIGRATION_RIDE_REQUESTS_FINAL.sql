-- ==========================================
-- MIGRACIÓN FINAL: RIDE REQUESTS DEFENSIVE SYNC
-- Propósito: Garantizar integridad de columnas y firma de RPC
-- ==========================================
-- 1. Actualizar tabla ride_requests con todas las columnas necesarias
DO $$ BEGIN -- Columna: details (unificando 'note' y 'details')
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ride_requests'
        AND column_name = 'details'
) THEN
ALTER TABLE public.ride_requests
ADD COLUMN details TEXT DEFAULT '';
END IF;
-- Columna: distance
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ride_requests'
        AND column_name = 'distance'
) THEN
ALTER TABLE public.ride_requests
ADD COLUMN distance NUMERIC DEFAULT 0;
END IF;
-- Columna: overview_polyline
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ride_requests'
        AND column_name = 'overview_polyline'
) THEN
ALTER TABLE public.ride_requests
ADD COLUMN overview_polyline TEXT DEFAULT '';
END IF;
-- Columna: is_women_only
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ride_requests'
        AND column_name = 'is_women_only'
) THEN
ALTER TABLE public.ride_requests
ADD COLUMN is_women_only BOOLEAN DEFAULT FALSE;
END IF;
END $$;
-- 2. Redefinir la función create_ride_request con la firma EXACTA que usa el frontend
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE,
        p_distance DECIMAL DEFAULT 0,
        p_overview_polyline TEXT DEFAULT ''
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_requester_gender TEXT;
v_requester_name TEXT;
v_requester_photo TEXT;
v_request_id UUID;
BEGIN -- Verificación de Sesión
v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'Sesión no válida o expirada.';
END IF;
-- Obtener datos de perfil para denormalización rápida
SELECT display_name,
    photo_url,
    gender INTO v_requester_name,
    v_requester_photo,
    v_requester_gender
FROM public.profiles
WHERE id = v_requester_id;
-- Validaciones de Negocio
IF p_is_women_only
AND (
    v_requester_gender IS NULL
    OR LOWER(v_requester_gender) != 'female'
) THEN RAISE EXCEPTION 'Restricción de género: Solo mujeres pueden activar este filtro.';
END IF;
IF p_departure_time <= NOW() THEN RAISE EXCEPTION 'La fecha del viaje no puede ser en el pasado.';
END IF;
-- Inserción Blindada
INSERT INTO public.ride_requests (
        requester_id,
        requester_display_name,
        requester_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_needed,
        suggested_price,
        details,
        is_women_only,
        distance,
        overview_polyline,
        status
    )
VALUES (
        v_requester_id,
        v_requester_name,
        v_requester_photo,
        p_origin,
        p_destination,
        ST_SetSRID(
            ST_MakePoint(
                (p_origin->>'lng')::FLOAT,
                (p_origin->>'lat')::FLOAT
            ),
            4326
        )::GEOGRAPHY,
        ST_SetSRID(
            ST_MakePoint(
                (p_destination->>'lng')::FLOAT,
                (p_destination->>'lat')::FLOAT
            ),
            4326
        )::GEOGRAPHY,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only,
        p_distance,
        p_overview_polyline,
        'pending'
    )
RETURNING id INTO v_request_id;
RETURN json_build_object(
    'success',
    true,
    'requestId',
    v_request_id,
    'message',
    'Solicitud creada en radar activo.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;