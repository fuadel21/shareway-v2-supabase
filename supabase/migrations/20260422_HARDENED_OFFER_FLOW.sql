-- ==============================================================================
-- HARDENED OFFER FLOW: SEGURIDAD, IDEMPOTENCIA Y ANTI-FRAUDE
-- ==============================================================================

-- 1. Añadimos columna de idempotencia si no existe para evitar duplicados
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='idempotency_key') THEN
        ALTER TABLE public.rides ADD COLUMN idempotency_key UUID UNIQUE;
    END IF;
END $$;

-- 2. REFACTOR: create_ride con protección total
CREATE OR REPLACE FUNCTION public.create_ride(
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT DEFAULT '',
    p_distance DECIMAL DEFAULT 0,
    p_overview_polyline TEXT DEFAULT '',
    p_waypoints JSONB DEFAULT '[]'::JSONB,
    p_idempotency_key UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_id UUID;
    v_overlapping_id UUID;
BEGIN
    -- A. Validación de antelación (Mínimo 20 minutos)
    IF p_departure_time < (NOW() + INTERVAL '20 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'TIEMPO_INSUFICIENTE', 'message', 'El viaje debe programarse con al menos 20 min de antelación.');
    END IF;

    -- B. Control de Idempotencia (Evita duplicados por lag/doble clic)
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_ride_id FROM public.rides WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'rideId', v_ride_id, 'note', 'duplicate_prevented');
        END IF;
    END IF;

    -- C. Anti-Solapamiento (No dos viajes a la vez del mismo conductor)
    -- Buscamos viajes en un rango de +/- 2 horas del nuevo viaje
    SELECT id INTO v_overlapping_id FROM public.rides
    WHERE driver_id = v_driver_id
      AND status IN ('scheduled', 'active', 'in_progress')
      AND departure_time BETWEEN (p_departure_time - INTERVAL '2 hours') AND (p_departure_time + INTERVAL '2 hours')
    LIMIT 1;

    IF v_overlapping_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_SOLAPADO', 'message', 'Ya tienes otro viaje programado a una hora similar.');
    END IF;

    -- D. Creación del Viaje
    INSERT INTO public.rides (
        driver_id, origin, destination, departure_time,
        seats_available, price, details, distance,
        overview_polyline, waypoints, status, participant_ids, idempotency_key
    ) VALUES (
        v_driver_id, p_origin, p_destination, p_departure_time,
        p_seats, p_price, p_details, p_distance,
        p_overview_polyline, p_waypoints, 'scheduled', ARRAY[v_driver_id], p_idempotency_key
    ) RETURNING id INTO v_ride_id;

    RETURN jsonb_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. REFACTOR: update_ride con Lógica de Contrato Blindado
CREATE OR REPLACE FUNCTION public.update_ride_v2(
    p_ride_id UUID,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_details TEXT,
    p_is_women_only BOOLEAN DEFAULT false
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ride_record RECORD;
    v_has_passengers BOOLEAN;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.driver_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_AUTORIZADO');
    END IF;

    -- Verificamos si hay pasajeros confirmados
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_ride_record.passengers, '[]'::jsonb)) p
        WHERE p->>'status' IN ('confirmed', 'verified', 'on_board')
    ) INTO v_has_passengers;

    -- Si hay pasajeros, BLOQUEAMOS cambios estructurales (Precio, Hora)
    IF v_has_passengers THEN
        IF p_price != v_ride_record.price OR p_departure_time != v_ride_record.departure_time THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'CONTRATO_BLOQUEADO',
                'message', 'No puedes cambiar el precio ni la hora porque ya tienes pasajeros confirmados.'
            );
        END IF;
    END IF;

    -- Actualización permitida
    UPDATE public.rides SET
        departure_time = p_departure_time,
        seats_available = (p_seats - (v_ride_record.seats_total - v_ride_record.seats_available)), -- Ajuste inteligente de plazas
        price = p_price,
        details = p_details,
        is_women_only = p_is_women_only,
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
