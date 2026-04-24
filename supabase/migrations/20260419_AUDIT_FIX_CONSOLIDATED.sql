-- ========================================================
-- SHAREWAY V2 - AUDIT & INTEGRITY FIX CONSOLIDATED (V5 - STABLE SQL)
-- Fecha: 2026-04-19
-- Propósito: Versión final con sintaxis SQL optimizada para el editor de Supabase.
-- ========================================================

-- 0. LIMPIEZA TOTAL
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(UUID, UUID, JSONB, TEXT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.complete_ride(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_ride(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.start_ride(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.verify_passenger_boarding(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.verify_passenger_boarding(UUID, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fulfill_booking_after_payment(UUID, UUID, NUMERIC, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.trigger_emergency_alert(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_ride_pin(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.accept_passenger(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.reject_passenger(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.handle_passenger_no_show(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.remove_passenger(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_ride_details_secure(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.search_rides_by_corridor(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS public.search_rides_by_corridor(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.submit_review_v2(UUID, UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_rides() CASCADE;
DROP FUNCTION IF EXISTS public.sync_ride_chat_participants(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.award_achievement(TEXT) CASCADE;

-- 1. INICIALIZAR TESORERÍA
DO $$ 
DECLARE 
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    INSERT INTO public.profiles (id, display_name, email, role, is_admin)
    VALUES (v_treasury_id, 'PLATFORM_TREASURY', 'treasury@shareway.app', 'admin', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (v_treasury_id, 0.00, 0.00)
    ON CONFLICT (user_id) DO NOTHING;
END $$;

-- 2. HARDENING DE RLS
DROP POLICY IF EXISTS "Secure ride requests access" ON public.ride_requests;
CREATE POLICY "Secure ride requests access" ON public.ride_requests FOR SELECT 
USING (auth.uid() = requester_id OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND driver_id = auth.uid()));

DROP POLICY IF EXISTS "Public profile access" ON public.profiles;
-- Lectura solo con sesión válida (bloquea anon); datos sensibles siguen acotados por columnas y otras políticas.
CREATE POLICY "Public profile access" ON public.profiles FOR SELECT
USING (auth.uid() IS NOT NULL);

-- 3. DETALLES DE VIAJE
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT jsonb_build_object(
        'id', r.id, 'driver_id', r.driver_id, 'driver_name', p.display_name, 'driver_photo', p.photo_url, 
        'origin', r.origin, 'destination', r.destination, 'departure_time', r.departure_time, 
        'price', r.price, 'status', r.status, 'seats_available', r.seats_available,
        'passengers', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', (elem.val->>'id')::UUID, 'status', elem.val->>'status', 'displayName', prof.display_name, 
                'photoURL', prof.photo_url, 'pin', CASE WHEN (elem.val->>'id')::UUID = auth.uid() OR r.driver_id = auth.uid() THEN elem.val->>'pin' ELSE NULL END
            ))
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem(val)
            LEFT JOIN public.profiles prof ON (elem.val->>'id')::UUID = prof.id
        )
    )
    FROM public.rides r JOIN public.profiles p ON r.driver_id = p.id WHERE r.id = p_ride_id;
$$;

-- 4. RPC: confirm_trip_and_pay
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID, p_request_id UUID DEFAULT NULL, p_pickup_location JSONB DEFAULT NULL, p_pickup_address TEXT DEFAULT NULL, p_price NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ride_data AS (
        SELECT price, driver_id, seats_available, passengers, is_women_only, status FROM public.rides WHERE id = p_ride_id FOR UPDATE
    ),
    user_data AS (
        SELECT gender, is_suspended FROM public.profiles WHERE id = auth.uid()
    ),
    validation AS (
        SELECT CASE 
            WHEN u.is_suspended THEN 'USER_SUSPENDED'
            WHEN r.status != 'scheduled' THEN 'VIAJE_YA_INICIADO'
            WHEN r.seats_available <= 0 THEN 'SIN_PLAZAS_LIBRES'
            WHEN r.driver_id = auth.uid() THEN 'PROPIO_VIAJE'
            WHEN NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = auth.uid() AND balance >= r.price) THEN 'SALDO_INSUFICIENTE'
            ELSE NULL END as error_msg,
            r.price as ride_price, LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0') as new_pin, r.driver_id
        FROM ride_data r, user_data u
    ),
    wallet_upd AS (
        UPDATE public.wallets SET balance = balance - v.ride_price, held_balance = held_balance + v.ride_price, updated_at = NOW()
        FROM validation v WHERE user_id = auth.uid() AND v.error_msg IS NULL RETURNING user_id
    ),
    ride_upd AS (
        UPDATE public.rides SET seats_available = seats_available - 1,
            passengers = COALESCE(passengers, '[]'::jsonb) || jsonb_build_object('id', auth.uid(), 'status', 'confirmed', 'pin', v.new_pin, 'booked_price', v.ride_price, 'booked_at', NOW()),
            participant_ids = array_append(COALESCE(participant_ids, '{}'), auth.uid())
        FROM validation v WHERE id = p_ride_id AND v.error_msg IS NULL RETURNING id
    ),
    notify AS (
        INSERT INTO public.notifications (user_id, payload)
        SELECT v.driver_id, jsonb_build_object('type', 'ride_request', 'title', '¡Nueva reserva!', 'body', 'Un pasajero ha reservado una plaza.', 'data', jsonb_build_object('ride_id', p_ride_id))
        FROM validation v WHERE v.error_msg IS NULL RETURNING id
    )
    SELECT jsonb_build_object('success', (v.error_msg IS NULL), 'message', COALESCE(v.error_msg, 'Reserva completada'), 'pin', v.new_pin) FROM validation v;
$$;

-- 5. RPC: complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ride_to_complete AS (
        SELECT id, driver_id, status, passengers FROM public.rides WHERE id = p_ride_id FOR UPDATE
    ),
    passengers_to_pay AS (
        SELECT (p->>'id')::UUID as passenger_id, (p->>'booked_price')::NUMERIC as booked_price, ((p->>'booked_price')::NUMERIC * 0.85) as payout_amount, ((p->>'booked_price')::NUMERIC * 0.15) as fee_amount
        FROM ride_to_complete, jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p
        WHERE p->>'status' IN ('confirmed', 'verified', 'on_board') AND status != 'completed'
    ),
    upd_pax AS ( UPDATE public.wallets w SET held_balance = GREATEST(0, w.held_balance - p.booked_price), updated_at = NOW() FROM passengers_to_pay p WHERE w.user_id = p.passenger_id RETURNING w.user_id ),
    upd_drv AS ( UPDATE public.wallets w SET balance = balance + (SELECT COALESCE(SUM(payout_amount), 0) FROM passengers_to_pay), updated_at = NOW() FROM ride_to_complete r WHERE w.user_id = r.driver_id RETURNING w.user_id ),
    upd_trs AS ( UPDATE public.wallets SET balance = balance + (SELECT COALESCE(SUM(fee_amount), 0) FROM passengers_to_pay), updated_at = NOW() WHERE user_id = '00000000-0000-0000-0000-000000000000' RETURNING user_id ),
    final_ride AS (
        UPDATE public.rides r SET status = 'completed', completed_at = NOW(),
            passengers = (SELECT jsonb_agg(CASE WHEN p->>'status' != 'cancelled' THEN p || '{"status": "completed"}'::jsonb ELSE p END) FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) p)
        FROM ride_to_complete r_comp WHERE r.id = r_comp.id RETURNING r.id
    )
    SELECT jsonb_build_object('success', true, 'payout', COALESCE((SELECT SUM(payout_amount) FROM passengers_to_pay), 0));
$$;

-- 6. RPC: cancel_ride
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID) 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ride_data AS ( SELECT id, driver_id, status, departure_time, passengers FROM public.rides WHERE id = p_ride_id FOR UPDATE ),
    penalty_calc AS ( SELECT CASE WHEN EXTRACT(EPOCH FROM (departure_time - NOW())) / 3600 < 2 THEN 5.00 WHEN EXTRACT(EPOCH FROM (departure_time - NOW())) / 3600 < 24 THEN 2.00 ELSE 0.00 END as penalty FROM ride_data ),
    pax_data AS ( SELECT COUNT(*) as pax_count FROM ride_data, jsonb_array_elements(passengers) p WHERE p->>'status' = 'confirmed' ),
    distribution AS ( SELECT penalty, CASE WHEN pax_count > 0 THEN (penalty * 0.5) / pax_count ELSE 0.00 END as pax_comp, CASE WHEN pax_count > 0 THEN penalty * 0.5 ELSE penalty END as platform_fee FROM penalty_calc, pax_data ),
    upd_drv AS ( UPDATE public.wallets SET balance = balance - (SELECT penalty FROM distribution), updated_at = NOW() WHERE user_id = auth.uid() RETURNING user_id ),
    upd_pax AS ( UPDATE public.wallets w SET balance = balance + (p->>'booked_price')::NUMERIC + (SELECT pax_comp FROM distribution), held_balance = GREATEST(0, held_balance - (p->>'booked_price')::NUMERIC), updated_at = NOW() FROM ride_data r, jsonb_array_elements(r.passengers) p WHERE w.user_id = (p->>'id')::UUID AND p->>'status' = 'confirmed' RETURNING w.user_id ),
    upd_ride AS ( UPDATE public.rides SET status = 'cancelled', cancelled_at = NOW(), passengers = (SELECT jsonb_agg(jsonb_set(p, '{status}', '"cancelled"')) FROM ride_data, jsonb_array_elements(passengers) p) WHERE id = p_ride_id RETURNING id )
    SELECT jsonb_build_object('success', true, 'penalty', (SELECT penalty FROM distribution));
$$;

-- 7. RPC: cancel_booking_and_refund
CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID) 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ride_data AS ( SELECT id, driver_id, departure_time, passengers FROM public.rides WHERE id = p_ride_id FOR UPDATE ),
    pax_find AS ( SELECT p FROM ride_data, jsonb_array_elements(passengers) p WHERE (p->>'id')::UUID = auth.uid() AND p->>'status' != 'cancelled' LIMIT 1 ),
    refund_calc AS ( SELECT (p->>'booked_price')::NUMERIC as booked_price, CASE WHEN EXTRACT(EPOCH FROM (departure_time - NOW())) / 3600 > 24 THEN 1.0 WHEN EXTRACT(EPOCH FROM (departure_time - NOW())) / 3600 >= 2 THEN 0.5 ELSE 0.0 END as refund_percent FROM ride_data, pax_find ),
    amounts AS ( SELECT booked_price * refund_percent as refund_amount, booked_price * (1 - refund_percent) as penalty FROM refund_calc ),
    upd_pax AS ( UPDATE public.wallets SET balance = balance + (SELECT refund_amount FROM amounts), held_balance = GREATEST(0, held_balance - (SELECT booked_price FROM refund_calc)), updated_at = NOW() WHERE user_id = auth.uid() RETURNING user_id ),
    upd_ride AS ( UPDATE public.rides SET seats_available = seats_available + 1, passengers = (SELECT jsonb_agg(CASE WHEN (p->>'id')::UUID = auth.uid() THEN jsonb_set(p, '{status}', '"cancelled"') ELSE p END) FROM ride_data, jsonb_array_elements(passengers) p), participant_ids = array_remove(participant_ids, auth.uid()) WHERE id = p_ride_id RETURNING id )
    SELECT jsonb_build_object('success', true, 'refund', (SELECT refund_amount FROM amounts));
$$;

-- 8. RPC: start_ride
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH upd AS ( UPDATE public.rides SET status = 'active', started_at = NOW() WHERE id = p_ride_id AND driver_id = auth.uid() AND status = 'scheduled' RETURNING id )
    SELECT jsonb_build_object('success', EXISTS (SELECT 1 FROM upd));
$$;

-- 9. RPC: verify_passenger_boarding (p_passenger_id opcional: validación estricta cuando el conductor elige pasajero)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_pin TEXT,
    p_passenger_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Actualizar el estado del pasajero específico en el array JSONB
    UPDATE public.rides r
    SET
        status = 'in_progress',
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'pin' = p_pin)
                         AND (p_passenger_id IS NULL OR (p->>'id')::UUID = p_passenger_id)
                    THEN p || '{"status": "verified"}'::jsonb
                    ELSE p
                END
            )
            FROM jsonb_array_elements(r.passengers) p
        )
    WHERE r.id = p_ride_id
      AND r.driver_id = auth.uid()
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(r.passengers) p
          WHERE p->>'pin' = p_pin
            AND p->>'status' = 'confirmed'
            AND (p_passenger_id IS NULL OR (p->>'id')::UUID = p_passenger_id)
      );

    IF FOUND THEN
        RETURN jsonb_build_object('success', true);
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'PIN_INCORRECTO');
    END IF;
END;
$$;

-- 10. RPC: trigger_emergency_alert
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(p_ride_id UUID, p_location JSONB) 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ins AS ( INSERT INTO public.emergency_alerts (ride_id, user_id, location) VALUES (p_ride_id, auth.uid(), p_location) RETURNING id ),
    notify AS ( INSERT INTO public.notifications (user_id, payload) SELECT driver_id, jsonb_build_object('type', 'emergency', 'title', '¡ALERTA SOS!') FROM public.rides WHERE id = p_ride_id AND driver_id != auth.uid() RETURNING id )
    SELECT jsonb_build_object('success', true);
$$;

-- 11. RPC: get_my_ride_pin
CREATE OR REPLACE FUNCTION public.get_my_ride_pin(p_ride_id UUID) 
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT jsonb_build_object('success', true, 'pin', p->>'pin') FROM public.rides, jsonb_array_elements(passengers) p WHERE id = p_ride_id AND (p->>'id')::UUID = auth.uid() AND p->>'status' != 'cancelled' LIMIT 1;
$$;

-- 12. RPC: submit_review_v2
CREATE OR REPLACE FUNCTION public.submit_review_v2(p_ride_id UUID, p_reviewee_id UUID, p_rating INTEGER, p_comment TEXT DEFAULT '') 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH ins AS ( INSERT INTO public.reviews (ride_id, reviewer_id, reviewee_id, rating, comment) SELECT p_ride_id, auth.uid(), p_reviewee_id, p_rating, TRIM(p_comment) RETURNING id ),
    upd AS ( UPDATE public.profiles SET rating = (SELECT AVG(rating) FROM public.reviews WHERE reviewee_id = p_reviewee_id), review_count = (SELECT COUNT(*) FROM public.reviews WHERE reviewee_id = p_reviewee_id) WHERE id = p_reviewee_id RETURNING id )
    SELECT jsonb_build_object('success', true);
$$;

-- 13. LIMPIEZA DE VIAJES EXPIRADOS
CREATE OR REPLACE FUNCTION public.cleanup_expired_rides() 
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$
    WITH expired AS ( SELECT id, passengers FROM public.rides WHERE status = 'scheduled' AND departure_time < (NOW() - INTERVAL '2 hours') FOR UPDATE ),
    refund AS ( UPDATE public.wallets w SET balance = balance + (p->>'booked_price')::NUMERIC, held_balance = GREATEST(0, held_balance - (p->>'booked_price')::NUMERIC) FROM expired e, jsonb_array_elements(e.passengers) p WHERE w.user_id = (p->>'id')::UUID AND p->>'status' = 'confirmed' RETURNING w.user_id ),
    upd_ride AS ( UPDATE public.rides SET status = 'expired' WHERE id IN (SELECT id FROM expired) RETURNING id )
    SELECT jsonb_build_object('success', true, 'expired_count', (SELECT COUNT(*) FROM upd_ride));
$$;

-- 14. BÚSQUEDA POR CORREDOR (firma alineada con frontend: p_pax_* + p_max_detour_meters)
CREATE OR REPLACE FUNCTION public.search_rides_by_corridor(
    p_pax_origin_lat NUMERIC, p_pax_origin_lng NUMERIC,
    p_pax_dest_lat NUMERIC, p_pax_dest_lng NUMERIC,
    p_date TIMESTAMPTZ DEFAULT NULL, p_max_detour_meters NUMERIC DEFAULT 5000
) RETURNS TABLE (
    id UUID, driver_id UUID, origin JSONB, destination JSONB, price NUMERIC,
    seats_available INTEGER, departure_time TIMESTAMPTZ, status TEXT,
    is_women_only BOOLEAN, driver_name TEXT, driver_photo TEXT,
    driver_rating NUMERIC, driver_verified BOOLEAN, match_score FLOAT8
) AS $$
    SELECT
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time, r.status, r.is_women_only,
        p.display_name, p.photo_url, p.rating, p.is_verified,
        (ST_Distance(ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326), ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)) +
         ST_Distance(ST_SetSRID(ST_Point(p_pax_dest_lng, p_pax_dest_lat), 4326), ST_SetSRID(ST_Point((r.destination->'coordinates'->>'lng')::numeric, (r.destination->'coordinates'->>'lat')::numeric), 4326)))::FLOAT8 AS match_score
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.status = 'scheduled' AND r.seats_available > 0 AND (p_date IS NULL OR r.departure_time::date = p_date::date)
      AND r.departure_time >= NOW()
      AND ST_DWithin(
          ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326)::geography,
          ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)::geography,
          p_max_detour_meters
      )
    ORDER BY match_score ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
