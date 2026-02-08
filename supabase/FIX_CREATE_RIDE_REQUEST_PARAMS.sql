-- ==========================================
-- FIX: create_ride_request - Add missing parameters
-- Fecha: 2026-02-07
-- Descripción: Agregar parámetros p_distance y p_overview_polyline
--              que el frontend está enviando pero la función no acepta
-- ==========================================
-- Step 1: Add missing columns to ride_requests table if they don't exist
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS distance DECIMAL;
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS overview_polyline TEXT;
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS note TEXT;
-- Step 2: Drop the old function
DROP FUNCTION IF EXISTS public.create_ride_request(
    jsonb,
    jsonb,
    timestamptz,
    integer,
    decimal,
    text,
    boolean
);
-- Recreate with all required parameters
CREATE OR REPLACE FUNCTION public.create_ride_request(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats_needed INTEGER,
        p_suggested_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_is_women_only BOOLEAN DEFAULT FALSE,
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_requester_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
v_request_id UUID;
v_distance_meters FLOAT;
v_active_requests_count INTEGER;
BEGIN v_requester_id := auth.uid();
IF v_requester_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Validaciones de Entrada
IF p_origin IS NULL
OR p_destination IS NULL
OR p_departure_time IS NULL
OR p_seats_needed IS NULL THEN RAISE EXCEPTION 'Faltan datos esenciales para crear la solicitud';
END IF;
-- [SECURITY PATCH 1] Validación de Asientos (1-8)
IF p_seats_needed <= 0
OR p_seats_needed > 8 THEN RAISE EXCEPTION 'Número de asientos inválido (Máx 8)';
END IF;
-- [SECURITY PATCH 2] Rate Limiting (Máx 5 solicitudes pendientes)
SELECT COUNT(*) INTO v_active_requests_count
FROM public.ride_requests
WHERE requester_id = v_requester_id
    AND status = 'pending';
IF v_active_requests_count >= 5 THEN RAISE EXCEPTION 'Has alcanzado el límite de 5 solicitudes pendientes. Cancela alguna antes de crear nueva.';
END IF;
-- Crear puntos geográficos
v_origin_point := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_destination_point := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
-- [SECURITY PATCH 3] Validación de Precio Sugerido vs Distancia
IF p_suggested_price < 0 THEN RAISE EXCEPTION 'El precio sugerido no puede ser negativo.';
END IF;
-- Calcular distancia aproximada para validar precio "loco"
v_distance_meters := ST_Distance(v_origin_point, v_destination_point);
IF v_distance_meters > 0 THEN -- Límite: 1€/km (más flexible que oferta, pero evita lavado de dinero obvio)
IF (p_suggested_price / (v_distance_meters / 1000.0)) > 1.00 THEN RAISE EXCEPTION 'El precio sugerido es inusualmente alto (>1€/km). Revisión de seguridad.';
END IF;
END IF;
-- Insertar la solicitud con los nuevos campos
INSERT INTO public.ride_requests (
        requester_id,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_needed,
        suggested_price,
        note,
        is_women_only,
        distance,
        overview_polyline
    )
VALUES (
        v_requester_id,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats_needed,
        p_suggested_price,
        p_details,
        p_is_women_only,
        p_distance,
        p_overview_polyline
    )
RETURNING id INTO v_request_id;
RETURN json_build_object('success', true, 'requestId', v_request_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Verify the function was created correctly
DO $$ BEGIN IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'create_ride_request'
        AND pg_get_function_identity_arguments(oid) LIKE '%p_distance%'
) THEN RAISE NOTICE '✅ Function create_ride_request updated successfully with new parameters';
ELSE RAISE WARNING '⚠️ Function may not have been created correctly';
END IF;
END $$;