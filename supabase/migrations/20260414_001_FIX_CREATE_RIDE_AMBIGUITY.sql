-- ==============================================================================
-- 20260414_001_FIX_CREATE_RIDE_AMBIGUITY.sql
-- Propósito: Eliminar versiones antiguas y ambiguas de la función create_ride
-- que causan el error "Could not choose the best candidate function".
-- ==============================================================================

-- 1. DROPEAR TODAS LAS FUNCIONES CON EL MISMO NOMBRE (Limpieza Absoluta)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure as proto
        FROM pg_proc
        WHERE proname IN ('create_ride')
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION ' || r.proto || ' CASCADE';
    END LOOP;
END $$;

-- 2. RE-CREAR LA ÚNICA VERSIÓN OFICIAL (15 parámetros con defaults)
-- Esta es la versión maestra del archivo 202601180007_FINAL_UNIFIED_RIDE_LIFECYCLE.sql
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
DECLARE v_driver_id UUID := auth.uid();
v_driver_name TEXT;
v_driver_photo TEXT;
v_driver_gender TEXT;
v_ride_id UUID;
v_verification_status TEXT;
BEGIN 
    IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
    END IF;

    SELECT display_name,
        photo_url,
        gender,
        (verification->>'status') INTO v_driver_name,
        v_driver_photo,
        v_driver_gender,
        v_verification_status
    FROM public.profiles
    WHERE id = v_driver_id;

    -- Fair Price (0.60€/km)
    IF p_price > 0 AND p_distance > 0 THEN 
        IF (p_price / p_distance) > 0.60 THEN 
            RAISE EXCEPTION 'Política de Precio Justo: El precio supera el límite de 0.60€/km.';
        END IF;
    END IF;

    -- Overlap Prevention (±2h)
    IF EXISTS (
        SELECT 1
        FROM public.rides
        WHERE driver_id = v_driver_id
            AND status IN ('scheduled', 'in_progress', 'active')
            AND ABS(
                EXTRACT(
                    EPOCH
                    FROM (departure_time - p_departure_time)
                )
            ) < 7200
    ) THEN RAISE EXCEPTION 'Conflicto de horario: Ya tienes un viaje en un margen de 2h.';
    END IF;

    -- Gender Shield
    IF p_is_women_only AND (v_driver_gender IS NULL OR LOWER(v_driver_gender) != 'female') THEN 
        RAISE EXCEPTION 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres.';
    END IF;

    INSERT INTO public.rides (
            driver_id,
            driver_display_name,
            driver_photo_url,
            origin,
            destination,
            departure_time,
            seats_total,
            seats_available,
            price,
            details,
            distance,
            overview_polyline,
            is_women_only,
            participant_ids,
            approval_mode,
            waypoints,
            preferences,
            status
        )
    VALUES (
            v_driver_id,
            v_driver_name,
            v_driver_photo,
            p_origin,
            p_destination,
            p_departure_time,
            p_seats,
            p_seats,
            p_price,
            p_details,
            p_distance,
            p_overview_polyline,
            p_is_women_only,
            ARRAY [v_driver_id],
            p_approval_mode,
            p_waypoints,
            p_preferences,
            'scheduled'
        )
    RETURNING id INTO v_ride_id;
    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
