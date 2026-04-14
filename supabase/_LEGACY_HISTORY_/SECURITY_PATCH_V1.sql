-- ===============================================================
-- SECURITY PATCH V1
-- Fecha: 2026-01-13
-- Auditor: Senior Product Engineer & QA Lead
-- Descripción: Corrección de vulnerabilidades detectadas en auditoría.
-- 1. Validación de Precio Máximo (Anti-Abuso)
-- 2. Prevención de Solapamiento de Viajes (Lógica Física)
-- 3. Límite de Viajes Activos (Rate Limiting)
-- ===============================================================

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
    p_allowed_communities TEXT[] DEFAULT '{}'
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_driver_name TEXT;
    v_driver_photo TEXT;
    v_ride_id UUID;
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
    v_verification_status TEXT;
    v_active_rides_count INTEGER;
BEGIN
    -- Obtener el ID del usuario autenticado
    v_driver_id := auth.uid();
    
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;
    
    -- Validaciones Básicas
    IF p_origin IS NULL OR p_destination IS NULL OR p_departure_time IS NULL OR p_seats IS NULL OR p_price IS NULL THEN
        RAISE EXCEPTION 'Faltan datos esenciales para crear el viaje';
    END IF;
    
    IF p_seats <= 0 OR p_seats > 8 THEN
        RAISE EXCEPTION 'Número de asientos inválido (Máx 8)';
    END IF;
    
    IF p_price < 0 THEN
        RAISE EXCEPTION 'Precio inválido';
    END IF;

    -- [SECURITY PATCH 1] Validación de Precio Máximo (0.50€/km)
    -- Previene lavado de dinero o errores de input
    IF p_distance IS NOT NULL AND p_distance > 0 THEN
        -- Convertimos metros a km
        IF (p_price / (p_distance/1000.0)) > 0.50 THEN
             RAISE EXCEPTION 'El precio excede el máximo permitido de 0.50€/km (Política de Precio Justo)';
        END IF;
    END IF;

    -- [SECURITY PATCH 2] Rate Limiting (Máx 10 viajes activos)
    SELECT COUNT(*) INTO v_active_rides_count
    FROM public.rides
    WHERE driver_id = v_driver_id AND status = 'scheduled';

    IF v_active_rides_count >= 10 THEN
        RAISE EXCEPTION 'Has alcanzado el límite máximo de 10 viajes activos simultáneos.';
    END IF;

    -- [SECURITY PATCH 3] Prevención de Solapamiento (Driver Overlap)
    -- No permitir viajes con menos de 2 horas de diferencia
    IF EXISTS (
        SELECT 1 FROM public.rides
        WHERE driver_id = v_driver_id
        AND status = 'scheduled'
        AND departure_time BETWEEN p_departure_time - INTERVAL '2 hours' AND p_departure_time + INTERVAL '2 hours'
    ) THEN
        RAISE EXCEPTION 'Ya tienes un viaje programado en un horario cercano (+/- 2h). Imposible realizar ambos.';
    END IF;
    
    -- Obtener información del conductor y su estado de verificación
    SELECT display_name, photo_url, (verification->>'status')
    INTO v_driver_name, v_driver_photo, v_verification_status
    FROM public.profiles
    WHERE id = v_driver_id;
    
    IF v_driver_name IS NULL THEN
        RAISE EXCEPTION 'Perfil de conductor no encontrado';
    END IF;

    -- SEGURIDAD FASE 3: Validación de Identidad
    IF v_verification_status IS NULL OR v_verification_status != 'verified' THEN
        RAISE EXCEPTION 'Tu cuenta no está verificada. Para publicar viajes, debes completar la validación de identidad en Ajustes.';
    END IF;
    
    -- Crear puntos geográficos
    v_origin_point := ST_SetSRID(ST_MakePoint((p_origin->>'lng')::FLOAT, (p_origin->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint((p_destination->>'lng')::FLOAT, (p_destination->>'lat')::FLOAT), 4326)::GEOGRAPHY;
    
    -- Insertar el viaje
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
        details,
        distance,
        overview_polyline,
        bounds,
        is_women_only,
        is_exclusive_community,
        allowed_communities,
        participant_ids
    ) VALUES (
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
        p_details,
        p_distance,
        p_overview_polyline,
        p_bounds,
        p_is_women_only,
        p_is_exclusive_community,
        p_allowed_communities,
        ARRAY[v_driver_id]
    )
    RETURNING id INTO v_ride_id;
    
    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
