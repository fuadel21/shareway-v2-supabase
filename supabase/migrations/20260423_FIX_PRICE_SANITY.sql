-- ==============================================================================
-- FIX: SANEAMIENTO DE PRECIOS ABSURDOS Y BLINDAJE DE RPCs
-- Resuelve: viajes mostrando 999999€ u otros precios imposibles en el dashboard
-- ==============================================================================

-- ─── 1. LIMPIEZA DE DATOS CORRUPTOS ───────────────────────────────────────────
-- Cancelar y marcar como corruptos los viajes con precio > 300€ (MAX_PRICE de la app)
-- que aún están 'scheduled'. No los eliminamos para preservar el historial de auditoría.
UPDATE public.rides
SET
    status      = 'cancelled',
    details     = COALESCE(details, '') || ' [AUTO-CANCELLED: precio inválido > 300€]',
    updated_at  = NOW()
WHERE
    status    = 'scheduled'
    AND price > 300;

-- ─── 2. CONSTRAINT DE INTEGRIDAD EN TABLA rides ───────────────────────────────
-- Añadimos un CHECK constraint para que la BD rechace directamente precios imposibles.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'rides_price_sanity_check'
    ) THEN
        ALTER TABLE public.rides
            ADD CONSTRAINT rides_price_sanity_check
            CHECK (price >= 0 AND price <= 300);
    END IF;
END $$;

-- ─── 3. REFACTOR get_available_rides_v2 CON FILTRO DE PRECIO ──────────────────
-- Añadimos AND r.price <= 300 y p.is_suspended IS NOT TRUE para mayor seguridad
DROP FUNCTION IF EXISTS public.get_available_rides_v2();
CREATE OR REPLACE FUNCTION public.get_available_rides_v2()
RETURNS TABLE (
    ride_id         UUID,
    driver_id       UUID,
    driver_name     TEXT,
    driver_photo    TEXT,
    driver_rating   NUMERIC,
    origin          JSONB,
    destination     JSONB,
    departure_time  TIMESTAMPTZ,
    price           NUMERIC,
    seats_available INTEGER,
    seats_total     INTEGER,
    distance        NUMERIC,
    is_women_only   BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id            AS ride_id,
        r.driver_id,
        p.display_name  AS driver_name,
        p.photo_url     AS driver_photo,
        p.rating        AS driver_rating,
        r.origin,
        r.destination,
        r.departure_time,
        r.price,
        r.seats_available,
        r.seats_total,
        r.distance,
        r.is_women_only
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status          = 'scheduled'
      AND r.seats_available > 0
      AND r.departure_time  > NOW()
      AND r.price           > 0          -- Filtro: precio positivo
      AND r.price           <= 300       -- Filtro: precio máximo permitido por la app
      AND (p.verification->>'is_suspended')::BOOLEAN IS NOT TRUE
    ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 4. REFACTOR create_ride CON VALIDACIÓN DE PRECIO EN BD ──────────────────
-- Reemplazamos la función hardened con validación de precio máximo antes de insertar.
-- Mantiene idempotency_key para evitar duplicados.
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin            JSONB,
    p_destination       JSONB,
    p_departure_time    TIMESTAMPTZ,
    p_seats             INTEGER,
    p_price             DECIMAL,
    p_details           TEXT    DEFAULT '',
    p_distance          DECIMAL DEFAULT 0,
    p_overview_polyline TEXT    DEFAULT '',
    p_waypoints         JSONB   DEFAULT '[]'::JSONB,
    p_idempotency_key   UUID    DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_driver_id     UUID := auth.uid();
    v_ride_id       UUID;
    v_overlapping   UUID;
BEGIN
    -- A. Validación de antelación (≥ 20 min)
    IF p_departure_time < (NOW() + INTERVAL '20 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'TIEMPO_INSUFICIENTE',
            'message', 'El viaje debe programarse con al menos 20 min de antelación.');
    END IF;

    -- B. Validación de precio (0.50 – 300€)
    IF p_price < 0.50 THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRECIO_INVALIDO',
            'message', 'El precio mínimo es de 0,50 €.');
    END IF;
    IF p_price > 300 THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRECIO_EXCESIVO',
            'message', 'El precio no puede superar los 300 €.');
    END IF;

    -- C. Control de Idempotencia
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    -- D. Anti-Solapamiento (± 2 horas)
    SELECT id INTO v_overlapping FROM public.rides
    WHERE driver_id = v_driver_id
      AND status IN ('scheduled', 'active', 'in_progress')
      AND departure_time BETWEEN (p_departure_time - INTERVAL '2 hours')
                             AND (p_departure_time + INTERVAL '2 hours')
    LIMIT 1;

    IF v_overlapping IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_SOLAPADO',
            'message', 'Ya tienes otro viaje programado a una hora similar.');
    END IF;

    -- E. Inserción
    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time,
        seats_available, seats_total,
        price, details, distance,
        overview_polyline, waypoints, status, participant_ids, idempotency_key
    ) VALUES (
        v_driver_id, p_origin, p_destination, p_departure_time,
        p_seats, p_seats,
        p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_driver_id], p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
