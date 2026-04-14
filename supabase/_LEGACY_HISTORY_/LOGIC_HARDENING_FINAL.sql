-- ==========================================
-- SHAREWAY V2: MASTER LOGIC HARDENING (PHASE 4)
-- ==========================================

-- 1. UNIFICACIÓN DE VERIFICACIÓN (A)
-- Eliminamos funciones antiguas para evitar confusión
DROP FUNCTION IF EXISTS public.verify_passenger(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.verify_passenger_boarding(UUID, TEXT);

-- Función Unificada y Hardened (Inyectada con GPS y estados)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(p_ride_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_pax JSONB;
    v_dist_meters FLOAT;
    v_pax_lat FLOAT;
    v_pax_lng FLOAT;
BEGIN
    -- Bloqueo de fila para consistencia
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;
    
    IF v_ride.id IS NULL THEN 
        RAISE EXCEPTION 'VIAJE_NO_ENCONTRADO_O_NO_AUTORIZADO'; 
    END IF;

    -- Localizar pasajero por PIN dentro del viaje
    SELECT p INTO v_pax FROM jsonb_array_elements(v_ride.passengers) p 
    WHERE TRIM(p->>'pin') = TRIM(p_pin) AND p->>'status' = 'confirmed' LIMIT 1;
    
    IF v_pax IS NULL THEN 
        RAISE EXCEPTION 'PIN_INVALIDO: Asegúrate de que el pasajero tenga estado CONFIRMADO.'; 
    END IF;

    -- GEO-VALIDATION (Risk Mitigation Phase 2 Re-enforced)
    IF v_ride.current_location IS NOT NULL THEN
        -- Prioridad: Recogida personalizada (Detour), sino origen del viaje
        IF v_pax->'pickup_location' IS NOT NULL THEN
            v_pax_lat := (v_pax->'pickup_location'->>'lat')::FLOAT;
            v_pax_lng := (v_pax->'pickup_location'->>'lng')::FLOAT;
        ELSE
            v_pax_lat := (v_ride.origin->>'lat')::FLOAT;
            v_pax_lng := (v_ride.origin->>'lng')::FLOAT;
        END IF;

        IF v_pax_lat IS NOT NULL THEN
            v_dist_meters := ST_Distance(
                ST_SetSRID(ST_MakePoint((v_ride.current_location->>'lng')::FLOAT, (v_ride.current_location->>'lat')::FLOAT), 4326)::GEOGRAPHY,
                ST_SetSRID(ST_MakePoint(v_pax_lng, v_pax_lat), 4326)::GEOGRAPHY
            );
            
            -- Bloqueo: Radio máximo de 1000m
            IF v_dist_meters > 1000 THEN
                RAISE EXCEPTION 'GPS_OUT_OF_RANGE: Estás a %m. Debes estar a menos de 1000m para verificar.', ROUND(v_dist_meters::NUMERIC, 0);
            END IF;
        END IF;
    END IF;

    -- Marcado atómico como VERIFICADO
    UPDATE public.rides SET passengers = (
        SELECT jsonb_agg(
            CASE WHEN (p->>'pin') = p_pin THEN jsonb_set(p, '{status}', '"verified"') ELSE p END
        ) FROM jsonb_array_elements(v_ride.passengers) p
    ) WHERE id = p_ride_id;
    
    RETURN json_build_object('success', true, 'passenger_id', v_pax->>'id');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. MECANISMO NO-SHOW (B)
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_pax JSONB;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;
    
    IF v_ride.id IS NULL THEN RAISE EXCEPTION 'No autorizado.'; END IF;

    -- Comprobar que el pasajero está en el viaje y no ha subido
    SELECT p INTO v_pax FROM jsonb_array_elements(v_ride.passengers) p 
    WHERE (p->>'id')::UUID = p_passenger_id AND p->>'status' = 'confirmed' LIMIT 1;

    IF v_pax IS NULL THEN RAISE EXCEPTION 'Pasajero no encontrado o ya verificado.'; END IF;

    -- Cambiar estado a NO_SHOW
    UPDATE public.rides SET passengers = (
        SELECT jsonb_agg(
            CASE WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"no_show"') ELSE p END
        ) FROM jsonb_array_elements(v_ride.passengers) p
    ) WHERE id = p_ride_id;

    -- Notificar al sistema de tesorería (complete_ride ya gestiona el cobro del no-show)
    RETURN json_build_object('success', true, 'status', 'no_show_recorded');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. HARDENING PAYOUTS (C)
CREATE OR REPLACE FUNCTION public.create_payout_request(p_amount NUMERIC) RETURNS JSON AS $$
DECLARE 
    v_user_id UUID := auth.uid();
    v_profile RECORD;
    v_current_balance NUMERIC;
    v_payout_id UUID;
BEGIN 
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. Verificación de seguridad de Stripe Connect
    SELECT stripe_account_id, stripe_account_verified INTO v_profile 
    FROM public.profiles WHERE id = v_user_id;

    IF v_profile.stripe_account_id IS NULL OR v_profile.stripe_account_verified = FALSE THEN
        RAISE EXCEPTION 'STRIPE_ONBOARDING_REQUIRED: Debes vincular y verificar tu cuenta bancaria vía Stripe antes de solicitar un retiro.';
    END IF;

    -- 2. Verificación de fondos
    SELECT balance INTO v_current_balance FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
    
    IF v_current_balance IS NULL OR v_current_balance < p_amount THEN 
        RAISE EXCEPTION 'Saldo insuficiente.'; 
    END IF;

    IF p_amount < 5 THEN RAISE EXCEPTION 'Mínimo de retiro: 5€.'; END IF;

    -- 3. Ejecución
    UPDATE public.wallets SET balance = balance - p_amount WHERE user_id = v_user_id;
    
    INSERT INTO public.payout_requests (user_id, amount, status, stripe_account_id)
    VALUES (v_user_id, p_amount, 'pending', v_profile.stripe_account_id)
    RETURNING id INTO v_payout_id;

    RETURN json_build_object('success', true, 'payoutId', v_payout_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. ATOMIC SEAT RESERVATION (D - RE-ENFORCED)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL,
        p_pickup_location JSONB DEFAULT NULL,
        p_pickup_address TEXT DEFAULT NULL,
        p_price DECIMAL DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE 
    v_passenger_id UUID := auth.uid();
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_seats_to_book INTEGER := 1;
    v_final_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger JSONB;
    v_participant_ids UUID [];
BEGIN 
    IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

    -- 1. Obtener datos del pasajero
    SELECT display_name, photo_url INTO v_passenger_name, v_passenger_photo
    FROM public.profiles WHERE id = v_passenger_id;

    -- 2. Bloqueo duro del viaje
    SELECT price, seats_available, driver_id, participant_ids INTO v_final_price, v_seats_available, v_driver_id, v_participant_ids
    FROM public.rides WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    IF v_final_price IS NULL THEN RAISE EXCEPTION 'Viaje no disponible.'; END IF;
    
    -- Si se envía un precio dinámico (por desvío), lo usamos; si no, el base del viaje.
    v_final_price := COALESCE(p_price, v_final_price);

    -- 3. Manejo de asientos múltiples si viene de solicitud
    IF p_request_id IS NOT NULL THEN
        SELECT seats_needed INTO v_seats_to_book FROM public.ride_requests WHERE id = p_request_id;
    END IF;
    v_seats_to_book := COALESCE(v_seats_to_book, 1);

    IF v_seats_available < v_seats_to_book THEN 
        RAISE EXCEPTION 'SOLDOUT: Solo quedan % asientos.', v_seats_available; 
    END IF;

    IF v_driver_id = v_passenger_id THEN RAISE EXCEPTION 'PROPIO_VIAJE'; END IF;
    IF v_passenger_id = ANY(v_participant_ids) THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;

    -- 4. Verificación de fondos
    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
    IF v_wallet_balance < v_final_price THEN RAISE EXCEPTION 'SALDO_INSUFICIENTE'; END IF;

    -- 5. Generación de PIN y Registro
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_new_passenger := json_build_object(
        'id', v_passenger_id,
        'displayName', v_passenger_name,
        'photoURL', v_passenger_photo,
        'status', 'confirmed',
        'pin', v_ride_pin,
        'booked_price', v_final_price,
        'booked_at', NOW(),
        'pickup_location', p_pickup_location,
        'pickup_address', p_pickup_address
    )::JSONB;

    -- 6. Transacción Atómica
    UPDATE public.wallets 
    SET balance = balance - v_final_price,
        held_balance = held_balance + v_final_price
    WHERE user_id = v_passenger_id;

    INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id, balance_after)
    VALUES (v_passenger_id, v_passenger_id, -v_final_price, 'hold', 'Reserva de viaje (Escrow)', p_ride_id, v_wallet_balance - v_final_price);

    UPDATE public.rides 
    SET passengers = COALESCE(passengers, '[]'::jsonb) || v_new_passenger,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - v_seats_to_book
    WHERE id = p_ride_id;

    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    RETURN json_build_object('success', true, 'pin', v_ride_pin);
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.rpc_error_logs (function_name, error_message, error_detail, user_id, params)
    VALUES ('confirm_trip_and_pay', SQLERRM, SQLSTATE, v_passenger_id, json_build_object('ride_id', p_ride_id));
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
