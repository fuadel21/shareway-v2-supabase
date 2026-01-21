-- ==========================================
-- ECO_INCENTIVES_SYSTEM.sql
-- Sistema de Incentivos "Green Miles" y Gamificación
-- Autor: Climate Tech Product Lead
-- ==========================================

-- 1. ACTUALIZACIÓN DE PERFILES (Gamificación)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS eco_points INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS eco_tier TEXT DEFAULT 'Seed', -- Seed, Sapling, Tree, Forest
ADD COLUMN IF NOT EXISTS eco_badges TEXT[] DEFAULT '{}';

-- 2. ACTUALIZACIÓN DE AUDIT LOGS (Trazabilidad de Puntos)
ALTER TABLE public.climate_audit_logs
ADD COLUMN IF NOT EXISTS eco_points_earned INTEGER DEFAULT 0;

-- 3. FUNCIÓN PARA CALCULAR TIER
CREATE OR REPLACE FUNCTION public.calculate_user_tier(p_co2_saved DECIMAL)
RETURNS TEXT AS $$
BEGIN
    IF p_co2_saved >= 1000 THEN RETURN 'Forest';
    ELSIF p_co2_saved >= 500 THEN RETURN 'Tree';
    ELSIF p_co2_saved >= 100 THEN RETURN 'Sapling';
    ELSE RETURN 'Seed';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. TRIGGER PRINCIPAL DE INCENTIVOS
-- Se ejecuta después de que se inserta un log de auditoría climática (que ocurre al completar viaje)
CREATE OR REPLACE FUNCTION public.trigger_award_eco_incentives()
RETURNS TRIGGER AS $$
DECLARE
    v_driver_id UUID;
    v_points INTEGER;
    v_vehicle_factor DECIMAL := 1.0;
    v_occupancy_factor DECIMAL := 1.0;
    v_is_full BOOLEAN := FALSE;
    v_seats_total INTEGER;
    v_seats_taken INTEGER;
    v_new_total_co2 DECIMAL;
BEGIN
    v_driver_id := NEW.driver_id;

    -- A. Determinar Factor de Vehículo (Incentivo Vehículo Bajo en Emisiones)
    -- Asumimos que NEW.vehicle_fuel_type viene del log
    IF NEW.vehicle_fuel_type IN ('electric', 'hydrogen') THEN
        v_vehicle_factor := 2.0; -- Doble puntos para cero emisiones
    ELSIF NEW.vehicle_fuel_type IN ('hybrid', 'phev') THEN
        v_vehicle_factor := 1.5;
    ELSIF NEW.vehicle_fuel_type = 'diesel' THEN
        v_vehicle_factor := 0.8; -- Penalización suave
    END IF;

    -- B. Determinar Factor de Ocupación (Incentivo "Full House")
    SELECT seats_total, (seats_total - seats_available)
    INTO v_seats_total, v_seats_taken
    FROM public.rides
    WHERE id = NEW.ride_id;

    IF v_seats_total > 0 AND v_seats_taken = v_seats_total THEN
        v_occupancy_factor := 1.25; -- +25% si el coche va lleno
        v_is_full := TRUE;
    END IF;

    -- C. Calcular Puntos: (Distancia * Pasajeros) * Factores
    -- 1 km con 1 pax = 1 punto base
    v_points := ROUND(NEW.distance_km * NEW.passenger_count * v_vehicle_factor * v_occupancy_factor);
    
    -- Mínimo 10 puntos por viaje válido
    IF v_points < 10 THEN v_points := 10; END IF;

    -- D. Actualizar Audit Log con los puntos ganados
    UPDATE public.climate_audit_logs 
    SET eco_points_earned = v_points 
    WHERE id = NEW.id;

    -- E. Actualizar Perfil del Conductor (Acumular CO2 y Puntos)
    UPDATE public.profiles
    SET 
        eco_points = COALESCE(eco_points, 0) + v_points,
        total_co2_saved = COALESCE(total_co2_saved, 0) + NEW.co2_avoided_kg,
        eco_tier = public.calculate_user_tier(COALESCE(total_co2_saved, 0) + NEW.co2_avoided_kg),
        updated_at = NOW()
    WHERE id = v_driver_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Al crear un registro de auditoría (fin del viaje), calculamos incentivos
DROP TRIGGER IF EXISTS on_climate_log_created ON public.climate_audit_logs;
CREATE TRIGGER on_climate_log_created
    AFTER INSERT ON public.climate_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_award_eco_incentives();

-- 5. MEJORA DEL BUSCADOR (ECO-PRIORITY)
-- Reemplazamos search_rides para incluir ordenamiento por sostenibilidad
-- PRIMERO ELIMINAMOS LA FUNCIÓN ANTERIOR PARA EVITAR CONFLICTO DE TIPO DE RETORNO
DROP FUNCTION IF EXISTS public.search_rides_v2(FLOAT, FLOAT, FLOAT, FLOAT, DATE, FLOAT);

CREATE OR REPLACE FUNCTION public.search_rides_v2(
    p_origin_lat FLOAT,
    p_origin_lng FLOAT,
    p_destination_lat FLOAT,
    p_destination_lng FLOAT,
    p_departure_date DATE DEFAULT NULL,
    p_max_distance_km FLOAT DEFAULT 5.0
)
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_rating DECIMAL,
    driver_eco_tier TEXT, -- Nuevo campo
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    details TEXT,
    distance DECIMAL,
    origin_distance_km FLOAT,
    destination_distance_km FLOAT,
    co2_saved_estimate DECIMAL -- Nuevo campo visual
) AS $$
DECLARE
    v_origin_point GEOGRAPHY;
    v_destination_point GEOGRAPHY;
BEGIN
    v_origin_point := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::GEOGRAPHY;
    v_destination_point := ST_SetSRID(ST_MakePoint(p_destination_lng, p_destination_lat), 4326)::GEOGRAPHY;

    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        p.rating,
        p.eco_tier, -- Retornamos el tier
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.distance,
        ST_Distance(r.origin_location, v_origin_point) / 1000 AS origin_distance_km,
        ST_Distance(r.destination_location, v_destination_point) / 1000 AS destination_distance_km,
        -- Estimación simple de CO2 a ahorrar (para mostrar en lista)
        -- Asumiendo 100g/km de ahorro promedio por pasajero extra
        (r.distance * 0.1)::DECIMAL(10,2) as co2_saved_estimate
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time > NOW()
        AND ST_Distance(r.origin_location, v_origin_point) <= (p_max_distance_km * 1000)
        AND ST_Distance(r.destination_location, v_destination_point) <= (p_max_distance_km * 1000)
        AND (p_departure_date IS NULL OR DATE(r.departure_time) = p_departure_date)
    ORDER BY 
        -- 1. Prioridad: Fecha (lo más importante sigue siendo llegar)
        DATE(r.departure_time) ASC,
        -- 2. Prioridad: Sostenibilidad (Tier Forest/Tree primero)
        CASE 
            WHEN p.eco_tier = 'Forest' THEN 1 
            WHEN p.eco_tier = 'Tree' THEN 2 
            WHEN p.eco_tier = 'Sapling' THEN 3 
            ELSE 4 
        END ASC,
        -- 3. Prioridad: Distancia total al punto de encuentro
        (ST_Distance(r.origin_location, v_origin_point) + ST_Distance(r.destination_location, v_destination_point)) ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. ACTUALIZAR PERFIL PÚBLICO
-- Redefinimos get_public_profile para exponer los datos eco
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_profile JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', id,
        'display_name', display_name,
        'photo_url', photo_url,
        'avatar_url', avatar_url,
        'bio', bio,
        'rating', rating,
        'review_count', review_count,
        'rides_count', rides_count,
        'total_co2_saved', total_co2_saved,
        'eco_points', eco_points, -- NUEVO
        'eco_tier', eco_tier,     -- NUEVO
        'verification_status', (verification->>'status'),
        'created_at', created_at,
        'vehicle', CASE 
            WHEN vehicle IS NOT NULL AND vehicle != '{}'::jsonb 
            THEN vehicle 
            ELSE NULL 
        END
    ) INTO v_profile
    FROM public.profiles
    WHERE id = p_user_id;
    
    RETURN v_profile;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 7. ACTUALIZAR FEED GLOBAL
-- Redefinimos get_available_rides_v2 para incluir eco_tier
-- PRIMERO ELIMINAMOS LA FUNCIÓN ANTERIOR PARA EVITAR CONFLICTO DE TIPO DE RETORNO
DROP FUNCTION IF EXISTS public.get_available_rides_v2();

CREATE OR REPLACE FUNCTION public.get_available_rides_v2()
RETURNS TABLE (
    id UUID,
    driver_id UUID,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    driver_rating DECIMAL,
    driver_verified TEXT,
    driver_eco_tier TEXT, -- NUEVO
    origin JSONB,
    destination JSONB,
    departure_time TIMESTAMPTZ,
    seats_available INTEGER,
    price DECIMAL,
    details TEXT,
    is_women_only BOOLEAN,
    distance DECIMAL
) AS $$
DECLARE
    v_searcher_id UUID;
    v_searcher_gender TEXT;
BEGIN
    v_searcher_id := auth.uid();
    
    IF v_searcher_id IS NOT NULL THEN
        SELECT gender INTO v_searcher_gender FROM public.profiles WHERE id = v_searcher_id;
    END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.driver_id,
        r.driver_display_name,
        r.driver_photo_url,
        p.rating,
        (p.verification->>'status')::TEXT as driver_verified,
        p.eco_tier, -- Retornamos el tier
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.price,
        r.details,
        r.is_women_only,
        r.distance
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time > NOW()
        AND r.driver_id != v_searcher_id
        AND (
            NOT r.is_women_only 
            OR (v_searcher_gender IS NULL OR v_searcher_gender = 'female')
        )
    ORDER BY 
        -- Prioridad Eco en Feed Global también
        CASE 
            WHEN p.eco_tier = 'Forest' THEN 1 
            WHEN p.eco_tier = 'Tree' THEN 2 
            WHEN p.eco_tier = 'Sapling' THEN 3 
            ELSE 4 
        END ASC,
        r.departure_time ASC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;
