-- ========================================================
-- MIGRACIÓN: ELITE BOOKING & SAFETY UPGRADE v1.1
-- Objetivo: Multi-plaza, Puntos de encuentro, SOS Alert y Protección No-Show.
-- ========================================================

-- 1. TABLA DE ALERTAS DE EMERGENCIA (Para SOS)
CREATE TABLE IF NOT EXISTS public.emergency_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id),
    user_id UUID REFERENCES public.profiles(id),
    location JSONB,
    status TEXT DEFAULT 'active', -- active, resolved, false_alarm
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MEJORA: confirm_trip_and_pay (Versión "Uber-Grade" Blindada)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_seats_to_book INTEGER DEFAULT 1,
    p_pickup_point JSONB DEFAULT NULL,
    p_dropoff_point JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_pax_profile RECORD;
    v_ride RECORD;
    v_total_price DECIMAL;
    v_platform_fee DECIMAL;
    v_wallet_balance DECIMAL;
    v_ride_pin TEXT;
    v_new_passenger_entry JSONB;
BEGIN
    -- 1. Validaciones de entrada y duplicados
    IF p_seats_to_book < 1 THEN RAISE EXCEPTION 'Mínimo 1 plaza.'; END IF;

    -- 2. Bloqueo de concurrencia
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride.id IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_ENCONTRADO'; END IF;
    
    -- [SHIELD] Evitar reservas dobles del mismo usuario
    IF v_passenger_id = ANY(v_ride.participant_ids) THEN
        RAISE EXCEPTION 'YA_TIENES_RESERVA: Ya estás inscrito en este viaje.';
    END IF;

    IF v_ride.status NOT IN ('scheduled', 'active') THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_ride.seats_available < p_seats_to_book THEN RAISE EXCEPTION 'PLAZAS_INSUFICIENTES'; END IF;

    -- 3. Validación de Perfil y Género
    SELECT display_name, photo_url, gender INTO v_pax_profile FROM public.profiles WHERE id = v_passenger_id;
    IF v_ride.is_women_only AND (v_pax_profile.gender IS NULL OR v_pax_profile.gender != 'female') THEN
        RAISE EXCEPTION 'SOLO_MUJERES';
    END IF;

    -- 4. Cálculo Financiero con Desglose (Invoice Logic)
    v_total_price := v_ride.price * p_seats_to_book;
    v_platform_fee := ROUND(v_total_price * 0.15, 2); -- 15% Fee

    SELECT balance INTO v_wallet_balance FROM public.wallets WHERE user_id = v_passenger_id FOR UPDATE;
    IF v_wallet_balance < v_total_price THEN RAISE EXCEPTION 'SALDO_INSUFICIENTE'; END IF;

    -- 5. Generación de PIN y Entrada de Pasajero con Breakdown
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_new_passenger_entry := jsonb_build_object(
        'id', v_passenger_id,
        'displayName', v_pax_profile.display_name,
        'photoURL', v_pax_profile.photo_url,
        'status', CASE WHEN v_ride.approval_mode = 'manual' THEN 'pending' ELSE 'confirmed' END,
        'seats_booked', p_seats_to_book,
        'booked_price', v_total_price,
        'invoice_breakdown', jsonb_build_object(
            'base_price', v_total_price - v_platform_fee,
            'service_fee', v_platform_fee,
            'total', v_total_price
        ),
        'pin', v_ride_pin,
        'pickup', COALESCE(p_pickup_point, v_ride.origin),
        'dropoff', COALESCE(p_dropoff_point, v_ride.destination),
        'booked_at', NOW()
    );

    -- 6. Ejecución de Transacción
    UPDATE public.wallets 
    SET balance = balance - v_total_price, held_balance = held_balance + v_total_price
    WHERE user_id = v_passenger_id;

    UPDATE public.rides 
    SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_passenger_entry,
        participant_ids = array_append(participant_ids, v_passenger_id),
        seats_available = seats_available - p_seats_to_book
    WHERE id = p_ride_id;

    -- Registrar auditoría del pago
    INSERT INTO public.transactions (wallet_id, user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, v_passenger_id, -v_total_price, 'hold', 'Retención de reserva: ' || p_seats_to_book || ' plazas', p_ride_id);

    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests SET status = 'fulfilled' WHERE id = p_request_id;
    END IF;

    RETURN json_build_object('success', true, 'pin', v_ride_pin, 'status', v_new_passenger_entry->>'status');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. NUEVA FUNCIÓN: trigger_emergency_alert (Botón de Pánico)
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(
    p_ride_id UUID,
    p_current_location JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_alert_id UUID;
BEGIN
    -- 1. Registrar la alerta
    INSERT INTO public.emergency_alerts (ride_id, user_id, location)
    VALUES (p_ride_id, v_user_id, p_current_location)
    RETURNING id INTO v_alert_id;

    -- 2. Notificar a los contactos de emergencia del usuario
    INSERT INTO public.notifications (user_id, payload)
    SELECT user_id, jsonb_build_object(
        'title', '🚨 ALERTA SOS: Emergencia en viaje',
        'content', 'Tu contacto ha activado el botón de pánico en un viaje de ShareWay. Ubicación enviada al centro de control.',
        'type', 'emergency',
        'data', jsonb_build_object('alert_id', v_alert_id, 'ride_id', p_ride_id, 'location', p_current_location)
    )
    FROM public.emergency_contacts
    WHERE user_id = v_user_id;

    -- 3. Notificar a los administradores de la plataforma
    INSERT INTO public.notifications (user_id, payload)
    SELECT id, jsonb_build_object(
        'title', '🔴 EMERGENCIA CRÍTICA',
        'content', 'Un usuario ha activado el SOS. Revisa el panel de control inmediatamente.',
        'type', 'admin_alert',
        'data', jsonb_build_object('alert_id', v_alert_id, 'user_id', v_user_id)
    )
    FROM public.profiles WHERE is_admin = true;

    RETURN json_build_object('success', true, 'alertId', v_alert_id, 'message', 'Ayuda en camino. Tus contactos han sido alertados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
