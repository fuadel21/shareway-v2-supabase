-- ==========================================
-- SHAREWAY V2: RISK MITIGATION PHASE 2
-- BLOQUEOS FÍSICOS Y ANTI-BLANQUEO DE DINERO
-- ==========================================

-- 1. START RIDE: Bloqueo de Tiempo
-- Evita iniciar el viaje con demasiada antelación
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_mins_to_departure FLOAT;
BEGIN
    SELECT * INTO v_ride 
    FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'scheduled' FOR UPDATE;
    
    IF v_ride.id IS NULL THEN 
        RAISE EXCEPTION 'Viaje no encontrado o ya iniciado.'; 
    END IF;
    
    v_mins_to_departure := EXTRACT(EPOCH FROM (v_ride.departure_time - NOW())) / 60;
    
    -- Restricción estricta: Máximo 15 minutos antes de la hora acordada.
    IF v_mins_to_departure > 15 THEN 
        RAISE EXCEPTION 'Aún es pronto. Solo puedes iniciar el viaje 15 minutos antes de la salida programada (faltan % mi).', ROUND(v_mins_to_departure::NUMERIC, 0);
    END IF;
    
    UPDATE public.rides 
    SET status = 'active', started_at = NOW() 
    WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. VERIFY PASSENGER: Bloqueo Geográfico (GPS Enforcer)
-- Impide robar pasajeros o verificarlos desde el sofá de casa
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_pax JSONB;
    v_dist_meters FLOAT;
    v_pax_lat FLOAT;
    v_pax_lng FLOAT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;
    IF v_ride.passengers IS NULL THEN RAISE EXCEPTION 'No autorizado.'; END IF;
    
    SELECT p INTO v_pax FROM jsonb_array_elements(v_ride.passengers) p 
    WHERE (p->>'id')::UUID = p_passenger_id AND TRIM(p->>'pin') = TRIM(p_pin);
    
    IF v_pax IS NULL THEN RAISE EXCEPTION 'PIN_INCORRECTO o pasajero inexistente.'; END IF;
    
    -- GEO-VALIDATION
    IF v_ride.current_location IS NOT NULL THEN
        -- Usar la coordenada individual de recogida si pasaron por desvío, o la general de origen
        IF v_pax->'pickup_location' IS NOT NULL THEN
            v_pax_lat := (v_pax->'pickup_location'->>'lat')::FLOAT;
            v_pax_lng := (v_pax->'pickup_location'->>'lng')::FLOAT;
        ELSE
            v_pax_lat := (v_ride.origin->>'lat')::FLOAT;
            v_pax_lng := (v_ride.origin->>'lng')::FLOAT;
        END IF;

        IF v_pax_lat IS NOT NULL THEN
            -- Cálculo de distancia geodésica estricta
            v_dist_meters := ST_Distance(
                ST_SetSRID(ST_MakePoint((v_ride.current_location->>'lng')::FLOAT, (v_ride.current_location->>'lat')::FLOAT), 4326)::GEOGRAPHY,
                ST_SetSRID(ST_MakePoint(v_pax_lng, v_pax_lat), 4326)::GEOGRAPHY
            );
            
            -- Bloqueo: Radio máximo de 1000 metros (1km) para dar holgura a caídas de cobertura GPS
            IF v_dist_meters > 1000 THEN
                RAISE EXCEPTION 'FRAUDE GPS: Estás a % metros del punto de recogida del pasajero. Acércate físicamente a él para pedirle el PIN.', ROUND(v_dist_meters::NUMERIC, 0);
            END IF;
        END IF;
    END IF;

    UPDATE public.rides SET passengers = (
        SELECT jsonb_agg(
            CASE WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"verified"') ELSE p END
        ) FROM jsonb_array_elements(v_ride.passengers) p
    ) WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. COMPLETE RIDE: Escudo Anti Blanqueo y Auto-viajes (Time-Travel Check)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_total_payout DECIMAL := 0;
    v_p JSONB;
    v_d_wallet_balance DECIMAL;
    v_minutes_elapsed FLOAT;
    v_min_duration_required FLOAT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'active' FOR UPDATE;
    IF v_ride.id IS NULL THEN RAISE EXCEPTION 'El viaje no está activo o no eres el conductor'; END IF;
    
    -- LÓGICA ANTI FRAUDE
    v_minutes_elapsed := EXTRACT(EPOCH FROM (NOW() - v_ride.started_at)) / 60;
    
    -- Ningún viaje real se completa en menos de 5 minutos, ni aunque cruces la calle
    IF v_minutes_elapsed < 5 THEN
        RAISE EXCEPTION 'ANOMALÍA DETECTADA: Imposible completar un viaje en menos de 5 minutos. Posible caso de blanqueo o colusión.';
    END IF;

    -- Si conocemos la distancia total del viaje (metros), comprobamos que el conductor no ha volado a 160km/h
    IF v_ride.distance > 0 THEN
        -- Tiempo minimo fisico = (Distancia_km / 120kmh_limite) * 60_minutos
        v_min_duration_required := ((v_ride.distance / 1000) / 120.0) * 60;
        
        -- Damos una tolerancia ridícula por si viaja por aeropista, pero atamos en corto teletransportes.
        IF v_minutes_elapsed < (v_min_duration_required * 0.6) THEN
           RAISE EXCEPTION 'FRAUDE TIEMPO/VELOCIDAD: Es matemáticamente imposible haber recorrido el trayecto en tan solo % minutos.', ROUND(v_minutes_elapsed::NUMERIC, 0);
        END IF;
    END IF;

    -- Todo legal. Procedemos a desembolsar.
    FOR v_p IN SELECT * FROM jsonb_array_elements(v_ride.passengers) LOOP 
        IF v_p->>'status' IN ('confirmed', 'verified') THEN 
            v_total_payout := v_total_payout + (v_p->>'booked_price')::DECIMAL;
            UPDATE public.wallets SET held_balance = held_balance - (v_p->>'booked_price')::DECIMAL WHERE user_id = (v_p->>'id')::UUID;
        END IF;
    END LOOP;

    IF v_total_payout > 0 THEN
        UPDATE public.wallets SET balance = balance + (v_total_payout * 0.85) WHERE user_id = v_driver_id RETURNING balance INTO v_d_wallet_balance;
        -- Transferimos el 15% a la plataforma internamente...
        UPDATE public.wallets SET balance = balance + (v_total_payout * 0.15) WHERE user_id = '00000000-0000-0000-0000-000000000000';
        
        -- Audit (Driver 85%)
        INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_driver_id, v_total_payout * 0.85, 'payout', 'Ingreso 85% por viaje', p_ride_id);
    END IF;

    UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;
    RETURN json_build_object('success', true, 'payout', v_total_payout * 0.85);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
