-- ========================================================
-- MIGRACIÓN: PROACTIVE MATCH ENGINE & SAFETY BUFFER v1.0
-- Objetivo: Notificaciones automáticas de coincidencia y cierre de ventana.
-- ========================================================

-- 1. MEJORA: confirm_trip_and_pay (Añadiendo Safety Buffer)
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
    v_ride_pin TEXT;
    v_new_pax JSONB;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride.id IS NULL THEN RAISE EXCEPTION 'VIAJE_NO_ENCONTRADO'; END IF;

    -- [SAFETY BUFFER] No permitir reservas si el viaje sale en menos de 15 minutos
    IF v_ride.departure_time < (NOW() + INTERVAL '15 minutes') THEN
        RAISE EXCEPTION 'VENTANA_CERRADA: Demasiado tarde para reservar. El viaje sale en menos de 15 minutos.';
    END IF;

    IF v_ride.status NOT IN ('scheduled', 'active') THEN RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE'; END IF;
    IF v_passenger_id = ANY(v_ride.participant_ids) THEN RAISE EXCEPTION 'YA_TIENES_RESERVA'; END IF;
    IF v_ride.seats_available < p_seats_to_book THEN RAISE EXCEPTION 'PLAZAS_INSUFICIENTES'; END IF;

    SELECT display_name, photo_url, gender INTO v_pax_profile FROM public.profiles WHERE id = v_passenger_id;
    IF v_ride.is_women_only AND (v_pax_profile.gender IS NULL OR v_pax_profile.gender != 'female') THEN
        RAISE EXCEPTION 'SOLO_MUJERES';
    END IF;

    v_total_price := v_ride.price * p_seats_to_book;
    v_platform_fee := ROUND(v_total_price * 0.15, 2);

    UPDATE public.wallets SET balance = balance - v_total_price, held_balance = held_balance + v_total_price WHERE user_id = v_passenger_id;
    
    v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
    v_new_pax := jsonb_build_object(
        'id', v_passenger_id, 'status', CASE WHEN v_ride.approval_mode = 'manual' THEN 'pending' ELSE 'confirmed' END,
        'seats_booked', p_seats_to_book, 'booked_price', v_total_price, 'pin', v_ride_pin,
        'pickup', COALESCE(p_pickup_point, v_ride.origin), 'dropoff', COALESCE(p_dropoff_point, v_ride.destination), 'booked_at', NOW()
    );

    UPDATE public.rides SET passengers = COALESCE(passengers, '[]'::JSONB) || v_new_pax, 
           participant_ids = array_append(participant_ids, v_passenger_id), 
           seats_available = seats_available - p_seats_to_book WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'pin', v_ride_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. FUNCIÓN DE AUTO-MATCHING (Proactiva)
-- Busca pasajeros con solicitudes que coincidan con el nuevo viaje publicado.
CREATE OR REPLACE FUNCTION public.notify_matches_for_new_ride()
RETURNS TRIGGER AS $$
DECLARE
    v_match RECORD;
BEGIN
    FOR v_match IN 
        SELECT 
            rr.requester_id,
            rr.origin->>'name' as req_origin
        FROM public.ride_requests rr
        WHERE rr.status = 'pending'
          -- Mismo género si es women_only
          AND (NOT NEW.is_women_only OR (SELECT gender FROM public.profiles WHERE id = rr.requester_id) = 'female')
          -- Misma fecha (margen 2h)
          AND rr.departure_time BETWEEN NEW.departure_time - INTERVAL '2 hours' AND NEW.departure_time + INTERVAL '2 hours'
          -- Cercanía geográfica Origen
          AND ST_Distance(rr.origin_location, NEW.origin_location) < 5000 -- 5km
          -- Cercanía geográfica Destino
          AND ST_Distance(rr.destination_location, NEW.destination_location) < 5000 -- 5km
    LOOP
        PERFORM public.create_notification(
            v_match.requester_id,
            '¡Viaje encontrado! 🚗',
            'Se ha publicado un viaje de ' || NEW.origin->>'name' || ' a ' || NEW.destination->>'name' || ' que coincide con tu solicitud. ¡Reserva rápido!',
            'match_found',
            jsonb_build_object('ride_id', NEW.id)
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. TRIGGER VINCULADO
DROP TRIGGER IF EXISTS tr_on_new_ride_match ON public.rides;
CREATE TRIGGER tr_on_new_ride_match
AFTER INSERT ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.notify_matches_for_new_ride();
