-- ==========================================
-- MIGRATION: FIX_CREATE_RIDE_FLOW
-- Fixes parameters, table columns, and price policies
-- ==========================================
-- 1. Extend the rides table to support missing data types
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS waypoints JSONB DEFAULT '[]'::jsonb;
-- 2. Redefine create_ride with ALL parameters and updated policy
CREATE OR REPLACE FUNCTION public.create_ride(
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_bounds JSONB DEFAULT NULL,
        p_is_women_only BOOLEAN DEFAULT FALSE,
        p_is_exclusive_community BOOLEAN DEFAULT FALSE,
        p_allowed_communities TEXT [] DEFAULT '{}',
        p_approval_mode TEXT DEFAULT 'automatic',
        p_waypoints JSONB DEFAULT '[]'::jsonb,
        p_preferences JSONB DEFAULT '{}'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_driver_name TEXT;
v_driver_photo TEXT;
v_ride_id UUID;
v_origin_point GEOGRAPHY;
v_destination_point GEOGRAPHY;
v_active_rides_count INTEGER;
BEGIN -- Auth verification
v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- Basic Validations
IF p_origin IS NULL
OR p_destination IS NULL
OR p_departure_time IS NULL
OR p_seats IS NULL
OR p_price IS NULL THEN RAISE EXCEPTION 'Faltan datos esenciales para crear el viaje';
END IF;
IF p_seats <= 0
OR p_seats > 8 THEN RAISE EXCEPTION 'Número de asientos inválido (Máx 8)';
END IF;
IF p_price < 0 THEN RAISE EXCEPTION 'Precio inválido';
END IF;
-- [POLICY UPDATE] Fair Price Policy: 0.60€/km (Frontend/Backend parity)
IF p_distance IS NOT NULL
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'El precio excede el máximo permitido de 0.60€/km (Política de Precio Justo)';
END IF;
END IF;
-- [SECURITY] Rate Limiting (Máx 10 active rides)
SELECT COUNT(*) INTO v_active_rides_count
FROM public.rides
WHERE driver_id = v_driver_id
    AND status = 'scheduled';
IF v_active_rides_count >= 10 THEN RAISE EXCEPTION 'Límite alcanzado: Máximo 10 viajes activos simultáneos.';
END IF;
-- [SECURITY] Prevention of overlap
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status = 'scheduled'
        AND departure_time BETWEEN p_departure_time - INTERVAL '2 hours'
        AND p_departure_time + INTERVAL '2 hours'
) THEN RAISE EXCEPTION 'Ya tienes un viaje programado en un horario cercano (+/- 2h).';
END IF;
-- Get driver info
SELECT display_name,
    photo_url INTO v_driver_name,
    v_driver_photo
FROM public.profiles
WHERE id = v_driver_id;
IF v_driver_name IS NULL THEN RAISE EXCEPTION 'Perfil de conductor no encontrado';
END IF;
-- [BYPASS REQUESTED] Verification check is commented out for testing
/*
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_driver_id AND (verification->>'status') IN ('verified', 'approved')) THEN
 RAISE EXCEPTION 'Tu cuenta no está verificada.';
 END IF;
 */
-- Geography points
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
-- Insert ride
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        driver_photo_url,
        origin,
        destination,
        origin_location,
        destination_location,
        departure_time,
        seats_total,
        seats_available,
        price,
        initial_price,
        details,
        distance,
        overview_polyline,
        bounds,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        approval_mode,
        participant_ids,
        waypoints,
        preferences
    )
VALUES (
        v_driver_id,
        v_driver_name,
        v_driver_photo,
        p_origin,
        p_destination,
        v_origin_point,
        v_destination_point,
        p_departure_time,
        p_seats,
        p_seats,
        p_price,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        COALESCE(p_approval_mode, 'automatic'),
        ARRAY [v_driver_id],
        p_waypoints,
        p_preferences
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Redefine fulfill_ride_request with matching params
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_details TEXT DEFAULT '',
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_ride_result JSON;
v_ride_id UUID;
BEGIN -- Call create_ride internally
v_ride_result := public.create_ride(
    p_origin := p_origin,
    p_destination := p_destination,
    p_departure_time := p_departure_time,
    p_seats := p_seats,
    p_price := p_price,
    p_details := p_details,
    p_distance := p_distance,
    p_overview_polyline := p_overview_polyline,
    p_waypoints := p_waypoints
);
IF (v_ride_result->>'success')::BOOLEAN THEN v_ride_id := (v_ride_result->>'rideId')::UUID;
-- Update request
UPDATE public.ride_requests
SET status = 'fulfilled',
    matched_ride_id = v_ride_id,
    updated_at = NOW()
WHERE id = p_request_id;
RETURN v_ride_result;
ELSE RETURN v_ride_result;
END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;