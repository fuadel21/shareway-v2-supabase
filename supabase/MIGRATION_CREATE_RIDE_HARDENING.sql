-- ==========================================
-- MIGRATION: CREATE_RIDE_HARDENING
-- Robust "Offer Seat" flow with security, consistency, and fair play checks.
-- ==========================================
-- 1. Redefine create_ride with strict business rules
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
BEGIN -- A. AUTHENTICATION
v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- B. IDENTITY VERIFICATION (Elite Mobility Requirement)
IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_driver_id
        AND (verification->>'status') = 'verified'
) THEN RAISE EXCEPTION 'Para publicar viajes, tu cuenta debe estar verificada en los Ajustes de Perfil.';
END IF;
-- C. RATE LIMITING (Anti-Spam)
SELECT COUNT(*) INTO v_active_rides_count
FROM public.rides
WHERE driver_id = v_driver_id
    AND status IN ('scheduled', 'active');
IF v_active_rides_count >= 10 THEN RAISE EXCEPTION 'Límite alcanzado: Tienes demasiados viajes activos (Máx 10).';
END IF;
-- D. OVERLAP PREVENTION (Operational Safety)
IF EXISTS (
    SELECT 1
    FROM public.rides
    WHERE driver_id = v_driver_id
        AND status IN ('scheduled', 'active')
        AND departure_time BETWEEN p_departure_time - INTERVAL '2 hours'
        AND p_departure_time + INTERVAL '2 hours'
) THEN RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje programado en un horario muy cercano (+/- 2h).';
END IF;
-- E. FAIR PRICE POLICY (Shared Economy)
-- Max 0.60€ per km to prevent professional commercial activity
IF p_distance IS NOT NULL
AND p_distance > 0 THEN IF (p_price / p_distance) > 0.60 THEN RAISE EXCEPTION 'El precio indicado supera el máximo permitido por la Política de Precio Justo (0.60€/km).';
END IF;
END IF;
-- F. DATA PREPARATION
SELECT display_name,
    photo_url INTO v_driver_name,
    v_driver_photo
FROM public.profiles
WHERE id = v_driver_id;
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
-- G. ATOMIC INSERT
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
        is_women_only,
        approval_mode,
        participant_ids,
        waypoints,
        preferences,
        status,
        created_at,
        last_modified_at
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
        p_is_women_only,
        COALESCE(p_approval_mode, 'automatic'),
        ARRAY [v_driver_id],
        p_waypoints,
        p_preferences,
        'scheduled',
        NOW(),
        NOW()
    )
RETURNING id INTO v_ride_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;