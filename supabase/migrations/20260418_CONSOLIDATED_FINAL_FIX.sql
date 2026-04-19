-- ========================================================
-- SHAREWAY V2 - CONSOLIDATED FIX (LOGIC & SCHEMA) - FINAL STABLE V2
-- Fecha: 2026-04-18
-- ========================================================

-- 1. ASEGURAR COLUMNAS EN TABLAS NÚCLEO
DO $$ BEGIN 
    -- Profiles: display_name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='display_name') THEN 
        ALTER TABLE public.profiles ADD COLUMN display_name TEXT;
    END IF;
    UPDATE public.profiles SET display_name = full_name WHERE display_name IS NULL;

    -- Rides: Género y finalización
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='is_women_only') THEN 
        ALTER TABLE public.rides ADD COLUMN is_women_only BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='completed_at') THEN 
        ALTER TABLE public.rides ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;

    -- Transactions: Wallet y trazabilidad
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='wallet_id') THEN 
        ALTER TABLE public.transactions ADD COLUMN wallet_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='balance_after') THEN 
        ALTER TABLE public.transactions ADD COLUMN balance_after NUMERIC(12,2);
    END IF;
END $$;

-- 2. RE-IMPLEMENTACIÓN DE RPC CRÍTICOS (Versiones Blindadas SQL)

-- A. DETALLES DE VIAJE (Seguro y con datos de perfiles)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
    SELECT json_build_object(
        'id', r.id, 
        'driver_id', r.driver_id, 
        'driver_name', p.display_name, 
        'driver_photo', p.photo_url, 
        'driver_vehicle', p.vehicle_info,
        'origin', r.origin, 
        'destination', r.destination, 
        'departure_time', r.departure_time, 
        'price', r.price, 
        'status', r.status, 
        'seats_available', r.seats_available,
        'is_women_only', r.is_women_only,
        'passengers', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', (elem.val->>'id')::UUID,
                    'status', elem.val->>'status',
                    'displayName', prof.display_name,
                    'photoURL', prof.photo_url,
                    'pickup_address', elem.val->>'pickup_address',
                    'booked_price', (elem.val->>'booked_price')::NUMERIC,
                    'pin', CASE 
                        WHEN (elem.val->>'id')::UUID = auth.uid() OR r.driver_id = auth.uid() 
                        THEN elem.val->>'pin' 
                        ELSE NULL 
                    END
                )
            )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem(val)
            LEFT JOIN public.profiles prof ON (elem.val->>'id')::UUID = prof.id
        ),
        'user_pin', (
            SELECT p_elem.val->>'pin' 
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS p_elem(val) 
            WHERE (p_elem.val->>'id')::UUID = auth.uid()
            LIMIT 1
        )
    )
    FROM public.rides r 
    JOIN public.profiles p ON r.driver_id = p.id 
    WHERE r.id = p_ride_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- B. CONFIRMAR VIAJE (Con bloqueo de saldo y prevención de condiciones de carrera)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID, 
    p_request_id UUID DEFAULT NULL, 
    p_pickup_location JSONB DEFAULT NULL, 
    p_pickup_address TEXT DEFAULT NULL, 
    p_price NUMERIC DEFAULT NULL
) RETURNS JSONB AS $$
    -- 1. Asegurar Wallet
    INSERT INTO public.wallets (user_id, balance, held_balance)
    SELECT auth.uid(), 0.00, 0.00
    WHERE NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = auth.uid());

    -- 2. Lógica Atómica
    WITH ride_data AS (
        SELECT price, driver_id, seats_available, passengers, is_women_only
        FROM public.rides WHERE id = p_ride_id FOR UPDATE
    ),
    user_data AS (
        SELECT gender FROM public.profiles WHERE id = auth.uid()
    ),
    validation AS (
        SELECT 
            CASE 
                WHEN r.price IS NULL THEN 'Viaje no encontrado'
                WHEN r.seats_available <= 0 THEN 'No hay plazas disponibles'
                WHEN r.driver_id = auth.uid() THEN 'No puedes reservar tu propio viaje'
                WHEN r.is_women_only AND u.gender = 'male' THEN 'Viaje restringido a mujeres'
                WHEN NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = auth.uid() AND balance >= r.price) THEN 'Saldo insuficiente'
                WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) p WHERE (p->>'id')::UUID = auth.uid() AND p->>'status' != 'cancelled') THEN 'Ya tienes una reserva activa'
                ELSE NULL
            END as error_msg,
            r.price as ride_price,
            LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0') as new_pin,
            r.driver_id as driver_id
        FROM ride_data r, user_data u
    ),
    wallet_upd AS (
        UPDATE public.wallets 
        SET balance = balance - v.ride_price, 
            held_balance = held_balance + v.ride_price,
            updated_at = NOW()
        FROM validation v
        WHERE user_id = auth.uid() AND v.error_msg IS NULL
    ),
    ride_upd AS (
        UPDATE public.rides 
        SET 
            seats_available = seats_available - 1,
            passengers = COALESCE(passengers, '[]'::jsonb) || jsonb_build_object(
                'id', auth.uid(), 'status', 'confirmed', 'pin', v.new_pin, 
                'booked_price', v.ride_price, 'booked_at', NOW(), 'pickup_address', p_pickup_address
            ),
            participant_ids = array_append(COALESCE(participant_ids, '{}'), auth.uid())
        FROM validation v
        WHERE id = p_ride_id AND v.error_msg IS NULL
    ),
    notify AS (
        INSERT INTO public.notifications (user_id, type, title, body, data)
        SELECT 
            v.driver_id, 
            'ride_request', 
            '¡Nueva reserva!', 
            'Un pasajero ha reservado una plaza en tu viaje.',
            jsonb_build_object('ride_id', p_ride_id, 'passenger_id', auth.uid())
        FROM validation v
        WHERE v.error_msg IS NULL
    )
    SELECT jsonb_build_object(
        'success', (v.error_msg IS NULL),
        'message', COALESCE(v.error_msg, 'Reserva completada'),
        'pin', CASE WHEN v.error_msg IS NULL THEN v.new_pin ELSE NULL END
    )
    FROM validation v;
$$ LANGUAGE sql SECURITY DEFINER;

-- C. FINALIZAR VIAJE (Blindado en SQL puro para evitar errores de relación)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
    WITH ride_to_complete AS (
        SELECT id, driver_id, status, passengers
        FROM public.rides WHERE id = p_ride_id FOR UPDATE
    ),
    -- Identificamos pasajeros a pagar (solo confirmados/en viaje)
    passengers_to_pay AS (
        SELECT 
            (p->>'id')::UUID as passenger_id,
            (p->>'booked_price')::NUMERIC as booked_price,
            ((p->>'booked_price')::NUMERIC * 0.90) as payout_amount
        FROM ride_to_complete, jsonb_array_elements(COALESCE(passengers, '[]'::jsonb)) p
        WHERE p->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin')
          AND status != 'completed'
    ),
    -- 1. Actualizar Wallet Pasajeros (Liberar Escrow)
    update_passengers AS (
        UPDATE public.wallets w
        SET held_balance = GREATEST(0, w.held_balance - p.booked_price),
            updated_at = NOW()
        FROM passengers_to_pay p
        WHERE w.user_id = p.passenger_id
    ),
    -- 2. Actualizar Wallet Conductor (Payout)
    update_driver AS (
        UPDATE public.wallets w
        SET balance = w.balance + (SELECT SUM(payout_amount) FROM passengers_to_pay),
            updated_at = NOW()
        FROM ride_to_complete r
        WHERE w.user_id = r.driver_id
    ),
    -- 3. Logs de Transacciones
    logs AS (
        INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id)
        SELECT passenger_id, passenger_id, -booked_price, 'payment_complete', 'Viaje finalizado', p_ride_id FROM passengers_to_pay
        UNION ALL
        SELECT r.driver_id, r.driver_id, (SELECT SUM(payout_amount) FROM passengers_to_pay), 'payout', 'Ingreso por viaje', p_ride_id 
        FROM ride_to_complete r WHERE EXISTS (SELECT 1 FROM passengers_to_pay)
    ),
    -- 4. Marcar Viaje como Completado
    final_update AS (
        UPDATE public.rides r SET 
            status = 'completed', 
            completed_at = NOW(),
            passengers = (
                SELECT jsonb_agg(CASE WHEN p->>'status' != 'cancelled' THEN p || '{"status": "completed"}'::jsonb ELSE p END)
                FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) p
            )
        FROM ride_to_complete r_comp
        WHERE r.id = r_comp.id
    ),
    -- 5. Notificación
    notification AS (
        INSERT INTO public.notifications (user_id, type, title, body, data)
        SELECT driver_id, 'ride_completed', '¡Viaje finalizado!', 'El pago ha sido procesado.', jsonb_build_object('ride_id', p_ride_id)
        FROM ride_to_complete
    )
    SELECT json_build_object(
        'success', true, 
        'payout', COALESCE((SELECT SUM(payout_amount) FROM passengers_to_pay), 0)
    );
$$ LANGUAGE sql SECURITY DEFINER;

-- D. BÚSQUEDA POR CORREDOR (PostGIS y Compatibilidad)
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
    SELECT 
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time, r.status, r.is_women_only,
        p.display_name, p.photo_url, p.rating, p.is_verified,
        (ST_Distance(ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326), ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)) +
         ST_Distance(ST_SetSRID(ST_Point(p_pax_dest_lng, p_pax_dest_lat), 4326), ST_SetSRID(ST_Point((r.destination->'coordinates'->>'lng')::numeric, (r.destination->'coordinates'->>'lat')::numeric), 4326)))::FLOAT8 as match_score
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE 
        r.status = 'scheduled'
        AND r.seats_available > 0
        AND (p_date IS NULL OR r.departure_time::date = p_date::date)
        AND r.departure_time >= NOW()
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_pax_origin_lng, p_pax_origin_lat), 4326)::geography,
            ST_SetSRID(ST_Point((r.origin->'coordinates'->>'lng')::numeric, (r.origin->'coordinates'->>'lat')::numeric), 4326)::geography,
            p_max_detour_meters
        )
    ORDER BY match_score ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
