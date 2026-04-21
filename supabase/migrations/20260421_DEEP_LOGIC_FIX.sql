-- ========================================================
-- SHAREWAY V2 - DEEP LOGIC & FINANCIAL INTEGRITY FIX
-- Fecha: 2026-04-21
-- ========================================================

-- LIMPIEZA DE VERSIONES ANTERIORES (Para evitar error de cambio de tipo de retorno)
DROP FUNCTION IF EXISTS public.complete_ride(uuid);
DROP FUNCTION IF EXISTS public.search_rides_by_corridor(numeric, numeric, numeric, numeric, timestamptz, numeric);

-- 1. CORRECCIÓN DE COMPLETE_RIDE (Protección de Saldo y Doble Payout)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_status TEXT;
    v_driver_id UUID;
    v_total_payout NUMERIC;
BEGIN
    -- Bloquear fila y verificar estado
    SELECT status, driver_id INTO v_ride_status, v_driver_id
    FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'El viaje ya ha sido completado previamente');
    END IF;

    IF v_ride_status = 'cancelled' THEN
        RETURN json_build_object('success', false, 'message', 'No se puede completar un viaje cancelado');
    END IF;

    -- Lógica de Payout Segura
    WITH passengers_to_pay AS (
        SELECT
            (p->>'id')::UUID as passenger_id,
            (p->>'booked_price')::NUMERIC as booked_price,
            ((p->>'booked_price')::NUMERIC * 0.90) as payout_amount
        FROM public.rides, jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p
        WHERE id = p_ride_id
          AND p->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin')
    ),
    update_passengers AS (
        UPDATE public.wallets w
        SET held_balance = GREATEST(0, w.held_balance - p.booked_price),
            updated_at = NOW()
        FROM passengers_to_pay p
        WHERE w.user_id = p.passenger_id
    ),
    calculated_payout AS (
        SELECT COALESCE(SUM(payout_amount), 0) as total FROM passengers_to_pay
    ),
    update_driver AS (
        UPDATE public.wallets
        SET balance = balance + (SELECT total FROM calculated_payout),
            updated_at = NOW()
        WHERE user_id = v_driver_id
    )
    INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id)
    SELECT v_driver_id, v_driver_id, (SELECT total FROM calculated_payout), 'payout', 'Ingreso por viaje finalizado', p_ride_id
    WHERE (SELECT total FROM calculated_payout) > 0;

    -- Actualizar Viaje
    UPDATE public.rides SET
        status = 'completed',
        completed_at = NOW(),
        passengers = (
            SELECT jsonb_agg(CASE WHEN p->>'status' NOT IN ('cancelled', 'no_show') THEN p || '{"status": "completed"}'::jsonb ELSE p END)
            FROM jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p
        )
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Viaje completado con éxito',
        'payout', (SELECT COALESCE(SUM(payout_amount), 0) FROM (SELECT payout_amount FROM public.rides, jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p WHERE id = p_ride_id AND p->>'status' = 'completed') as sub)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. CORRECCIÓN DE BÚSQUEDA POR CORREDOR (Métrica en Metros Reales)
CREATE OR REPLACE FUNCTION public.search_rides_by_corridor(
    p_pax_origin_lat NUMERIC,
    p_pax_origin_lng NUMERIC,
    p_pax_dest_lat NUMERIC,
    p_pax_dest_lng NUMERIC,
    p_date TIMESTAMPTZ DEFAULT NULL,
    p_max_detour_meters NUMERIC DEFAULT 5000
) RETURNS TABLE (
    id UUID,
    driver_id UUID,
    origin JSONB,
    destination JSONB,
    price NUMERIC,
    seats_available INTEGER,
    departure_time TIMESTAMPTZ,
    status TEXT,
    is_women_only BOOLEAN,
    driver_name TEXT,
    driver_photo TEXT,
    driver_rating NUMERIC,
    driver_verified BOOLEAN,
    match_score FLOAT8
) AS $$
DECLARE
    v_pax_origin GEOGRAPHY := ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326)::GEOGRAPHY;
    v_pax_dest GEOGRAPHY := ST_SetSRID(ST_Point(p_pax_dest_lng, p_pax_dest_lat), 4326)::GEOGRAPHY;
BEGIN
    RETURN QUERY
    SELECT
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time, r.status, r.is_women_only,
        p.display_name, p.photo_url, p.rating, p.is_verified,
        -- Distancia total en metros (Desvío de origen + Desvío de destino)
        (ST_Distance(v_pax_origin, ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)::GEOGRAPHY) +
         ST_Distance(v_pax_dest, ST_SetSRID(ST_Point((r.destination->'coordinates'->>'lng')::numeric, (r.destination->'coordinates'->>'lat')::numeric), 4326)::GEOGRAPHY))::FLOAT8 as match_score
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE
        r.status = 'scheduled'
        AND r.seats_available > 0
        AND (p_date IS NULL OR r.departure_time::date = p_date::date)
        AND r.departure_time >= NOW()
        -- Filtro estricto por cercanía (geography usa metros)
        AND ST_DWithin(v_pax_origin, ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)::GEOGRAPHY, p_max_detour_meters)
    ORDER BY match_score ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
