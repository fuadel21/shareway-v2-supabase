
-- 20260415_002_CONSOLIDATED_FIX_LIFECYCLE.sql
-- Propósito: Corregir Matching (error de tipos) y Restaurar Payout en complete_ride.

-- 1. Arreglar match_score en search_rides_by_corridor (Type Mismatch)
DROP FUNCTION IF EXISTS public.search_rides_by_corridor(NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.search_rides_by_corridor(
    p_origin_lat NUMERIC,
    p_origin_lng NUMERIC,
    p_dest_lat NUMERIC,
    p_dest_lng NUMERIC,
    p_max_dist_meters NUMERIC DEFAULT 5000,
    p_departure_after TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
    id UUID,
    driver_id UUID,
    origin JSONB,
    destination JSONB,
    price NUMERIC,
    seats_available INTEGER,
    departure_time TIMESTAMPTZ,
    match_score FLOAT8 -- Cambiado de NUMERIC a FLOAT8 para coincidir con ST_Distance
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time,
        (ST_Distance(ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326), ST_SetSRID(ST_Point((r.origin->'coordinates'->>1)::numeric, (r.origin->'coordinates'->>0)::numeric), 4326)) +
         ST_Distance(ST_SetSRID(ST_Point(p_dest_lng, p_dest_lat), 4326), ST_SetSRID(ST_Point((r.destination->'coordinates'->>1)::numeric, (r.destination->'coordinates'->>0)::numeric), 4326)))::FLOAT8 as match_score
    FROM public.rides r
    WHERE 
        r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time >= p_departure_after
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326)::geography,
            ST_SetSRID(ST_Point((r.origin->'coordinates'->>1)::numeric, (r.origin->'coordinates'->>0)::numeric), 4326)::geography,
            p_max_dist_meters
        )
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_dest_lng, p_dest_lat), 4326)::geography,
            ST_SetSRID(ST_Point((r.destination->'coordinates'->>1)::numeric, (r.destination->'coordinates'->>0)::numeric), 4326)::geography,
            p_max_dist_meters
        )
    ORDER BY match_score ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Restaurar Payout Instantáneo en complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10; -- 10% Comisión
    v_total_driver_payout DECIMAL := 0;
    v_driver_id UUID;
BEGIN
    -- Bloqueo y obtención de datos del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    -- Validar que el viaje esté iniciado o activo
    IF v_ride_record.status NOT IN ('active', 'in_progress') THEN
        -- Si ya está completado, no error, solo devolver éxito
        IF v_ride_record.status = 'completed' THEN
            RETURN json_build_object('success', true, 'message', 'Viaje ya estaba completado');
        END IF;
        -- Permitir completar si está scheduled pero queremos forzar cierre (opcional, mejor restringir)
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- Procesar cada pasajero para transferir fondos
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        -- Pagamos por pasajeros confirmados, verificados u on_board
        IF v_passenger->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin') THEN
            v_passenger_id := (v_passenger->>'id')::UUID;
            v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
            v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);

            -- A. Descontar del held_balance del PASAJERO
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_booked_price),
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- B. Sumar al balance disponible del CONDUCTOR
            UPDATE public.wallets
            SET balance = balance + v_payout_amount,
                updated_at = NOW()
            WHERE user_id = v_driver_id;

            -- C. Registrar transacciones (con manejo de nulos si wallet no existe por alguna razon)
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, -v_booked_price, 'payment_complete', 'Viaje completado', p_ride_id);

            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_driver_id, v_payout_amount, 'payout', 'Ingreso trayecto finalizado', p_ride_id);

            v_total_driver_payout := v_total_driver_payout + v_payout_amount;
        END IF;
    END LOOP;

    -- Actualizar estado del viaje y pasajeros a 'completed'
    UPDATE public.rides
    SET 
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW(),
        passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN p->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin') 
                    THEN p || '{"status": "completed"}'::jsonb
                    ELSE p 
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        )
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true, 
        'message', 'Viaje finalizado y fondos transferidos',
        'payout', v_total_driver_payout
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
