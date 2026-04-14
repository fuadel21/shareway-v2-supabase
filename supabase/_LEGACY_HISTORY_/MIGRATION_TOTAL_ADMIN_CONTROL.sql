-- ========================================================
-- MIGRACIÓN: TOTAL ADMIN CONTROL v1.0
-- Objetivo: Centralizar todos los parámetros críticos de la plataforma
-- ========================================================
-- 1. Asegurar tabla de configuración
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'General',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);
-- 2. Poblar Configuraciones Críticas
INSERT INTO public.platform_settings (key, value, description, category)
VALUES -- Financiero
    (
        'platform_fee_percent',
        '10',
        'Porcentaje de comisión que se queda la plataforma por cada viaje.',
        'Finanzas'
    ),
    (
        'min_price_per_km',
        '0.05',
        'Precio mínimo permitido por kilómetro (Eur).',
        'Finanzas'
    ),
    (
        'max_price_per_km',
        '0.60',
        'Precio máximo permitido por kilómetro (Eur).',
        'Finanzas'
    ),
    -- Caducidad (Smart Expiry)
    (
        'scheduled_ride_expiry_hours',
        '2',
        'Horas tras la salida para ocultar viajes no iniciados.',
        'Caducidad'
    ),
    (
        'active_ride_buffer_hours',
        '3',
        'Margen extra tras el tiempo estimado de viaje para viajes activos.',
        'Caducidad'
    ),
    (
        'ride_request_expiry_hours',
        '1',
        'Horas tras la salida para ocultar solicitudes del radar.',
        'Caducidad'
    ),
    -- Reglas y Seguridad
    (
        'max_seats_per_car',
        '8',
        'Número máximo de plazas que un conductor puede ofrecer.',
        'Seguridad'
    ),
    (
        'min_driver_rating_for_search',
        '0.0',
        'Valoración mínima necesaria para aparecer en búsquedas (0 = desactivado).',
        'Seguridad'
    ),
    -- Estado Global
    (
        'platform_maintenance_mode',
        'false',
        'Si es true, la app mostrará un banner y limitará acciones críticas.',
        'Sistema'
    ) ON CONFLICT (key) DO
UPDATE
SET description = EXCLUDED.description,
    category = EXCLUDED.category;
-- 3. Actualizar Motor de Búsqueda para respetar Min Rating y Expiry
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_eco_tier TEXT,
        driver_verified TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL,
        is_women_only BOOLEAN,
        passengers_count INTEGER,
        match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID;
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
v_exp_hours_scheduled FLOAT;
v_exp_hours_active_buffer FLOAT;
v_min_rating FLOAT;
BEGIN v_searcher_id := auth.uid();
-- Cargar preferencias dinámicas
SELECT (value->>0)::FLOAT INTO v_exp_hours_scheduled
FROM public.platform_settings
WHERE key = 'scheduled_ride_expiry_hours';
SELECT (value->>0)::FLOAT INTO v_exp_hours_active_buffer
FROM public.platform_settings
WHERE key = 'active_ride_buffer_hours';
SELECT (value->>0)::FLOAT INTO v_min_rating
FROM public.platform_settings
WHERE key = 'min_driver_rating_for_search';
-- Valores por defecto
v_exp_hours_scheduled := COALESCE(v_exp_hours_scheduled, 2.0);
v_exp_hours_active_buffer := COALESCE(v_exp_hours_active_buffer, 3.0);
v_min_rating := COALESCE(v_min_rating, 0.0);
IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL,
    p.eco_tier,
    (p.verification->>'status')::TEXT,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0),
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active') -- Filtro de Mantenimiento / Expiry
    AND (
        (
            r.status = 'scheduled'
            AND r.departure_time > (
                NOW() - (v_exp_hours_scheduled || ' hours')::INTERVAL
            )
        )
        OR (
            r.status = 'active'
            AND r.departure_time > (
                NOW() - (COALESCE(r.distance, 100) / 40.0 || ' hours')::INTERVAL - (v_exp_hours_active_buffer || ' hours')::INTERVAL
            )
        )
    ) -- Filtro por Rating Mínimo del Conductor
    AND COALESCE(p.rating, 0.0) >= v_min_rating
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price
    AND (
        ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
        OR ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
    )
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY match_score DESC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 4. Nueva RPC para Limpieza Profunda Manual
CREATE OR REPLACE FUNCTION public.run_manual_maintenance_tasks() RETURNS JSON AS $$
DECLARE v_count_notif INTEGER;
v_count_rides INTEGER;
v_main_mode BOOLEAN;
BEGIN -- 1. Limpiar notificaciones de hace más de 30 días
DELETE FROM public.notifications
WHERE created_at < (NOW() - INTERVAL '30 days');
GET DIAGNOSTICS v_count_notif = ROW_COUNT;
-- 2. Limpiar logs o elementos temporales si existen (ej. chat_messages de viajes cancelados hace mucho)
-- Opcional según schema
RETURN json_build_object(
    'success',
    true,
    'notifications_cleaned',
    v_count_notif,
    'suspensions_lifted',
    0,
    'message',
    'Limpieza profunda completada.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;