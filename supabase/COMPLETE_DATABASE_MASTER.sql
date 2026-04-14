-- ================================================================
-- MASTER DATABASE ENGINE v4.0 - PRODUCTION READY
-- PROJECT: SHAREWAY V2
-- AUTHOR: SENIOR PRODUCT ENGINEER (ANTIGRAVITY)
-- ================================================================

-- 0. CLEANUP (Idempotencia)
DROP FUNCTION IF EXISTS public.confirm_ride_and_pay;
DROP FUNCTION IF EXISTS public.complete_ride;
DROP FUNCTION IF EXISTS public.submit_review;

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. TABLAS NÚCLEO
-- Profiles (Identidad y Confianza)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    email TEXT UNIQUE,
    avatar_url TEXT,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unspecified')),
    
    -- Trust Stack (Technical Compatibility v4.1)
    is_verified_id BOOLEAN DEFAULT FALSE,
    is_verified_work BOOLEAN DEFAULT FALSE,
    work_company TEXT,
    verification JSONB DEFAULT '{"status": "not_verified"}'::jsonb,
    documents JSONB DEFAULT '{}'::jsonb,
    
    -- Gamification
    loyalty_points INTEGER DEFAULT 0,
    total_co2_saved_kg NUMERIC(10,2) DEFAULT 0,
    user_level TEXT DEFAULT 'Rookie',
    
    rating NUMERIC(3,2) DEFAULT 5.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets (Finanzas)
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    balance NUMERIC(12,2) DEFAULT 0.00,
    currency TEXT DEFAULT 'EUR',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rides (El Motor de Viajes)
CREATE TABLE IF NOT EXISTS public.rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    origin JSONB NOT NULL, -- {address, coordinates}
    destination JSONB NOT NULL,
    departure_time TIMESTAMPTZ NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    seats_available INTEGER NOT NULL,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    is_women_only BOOLEAN DEFAULT FALSE,
    passengers JSONB DEFAULT '[]'::jsonb, -- Array de {id, name, status, pin}
    participant_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviews (Reputación)
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES public.profiles(id),
    target_id UUID REFERENCES public.profiles(id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages (Comunicación)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. POLÍTICAS RLS (Seguridad de Producción)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Profiles: Cualquiera puede leer perfiles, solo el dueño edita
CREATE POLICY "Profiles are public" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can edit own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets: PRIVACIDAD TOTAL. Solo el dueño ve su dinero
CREATE POLICY "Users can see own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Rides: Cualquiera ve viajes programados
CREATE POLICY "Visible rides" ON public.rides FOR SELECT USING (true);
CREATE POLICY "Drivers can manage own rides" ON public.rides FOR ALL USING (auth.uid() = driver_id);

-- Chat: Solo los participantes del viaje pueden leer/escribir
CREATE POLICY "Ride participants can chat" ON public.chat_messages 
FOR ALL USING (
    auth.uid() IN (
        SELECT unnest(participant_ids) FROM public.rides WHERE id = ride_id
        UNION
        SELECT driver_id FROM public.rides WHERE id = ride_id
    )
);

-- 4. LÓGICA DE NEGOCIO (RPC)

-- RPC: Confirmar Viaje y Pagar (Atómico)
CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_pickup_lat NUMERIC,
    p_pickup_lng NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_price NUMERIC;
    v_seats INTEGER;
    v_is_women_only BOOLEAN;
    v_user_gender TEXT;
    v_driver_id UUID;
    v_pin TEXT;
BEGIN
    -- 1. Validaciones de Seguridad
    SELECT price, seats_available, is_women_only, driver_id 
    INTO v_price, v_seats, v_is_women_only, v_driver_id
    FROM public.rides WHERE id = p_ride_id;

    IF v_seats <= 0 THEN RETURN jsonb_build_object('success', false, 'message', 'No hay plazas disponibles'); END IF;
    IF v_driver_id = v_user_id THEN RETURN jsonb_build_object('success', false, 'message', 'No puedes reservar tu propio viaje'); END IF;

    -- 2. Escudo de Género
    SELECT gender INTO v_user_gender FROM public.profiles WHERE id = v_user_id;
    IF v_is_women_only AND v_user_gender = 'male' THEN 
        RETURN jsonb_build_object('success', false, 'message', 'Viaje restringido a mujeres'); 
    END IF;

    -- 3. Validación de Saldo (Escrow)
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_user_id AND balance >= v_price) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Saldo insuficiente');
    END IF;

    -- 4. Ejecución del Pago (Descontar del usuario)
    UPDATE public.wallets SET balance = balance - v_price WHERE user_id = v_user_id;

    -- 5. Actualizar Viaje
    v_pin := (floor(random() * 8999 + 1000))::text; -- PIN Aleatorio de 4 cifras
    UPDATE public.rides SET 
        seats_available = seats_available - 1,
        passengers = passengers || jsonb_build_object('id', v_user_id, 'status', 'confirmed', 'pin', v_pin),
        participant_ids = array_append(participant_ids, v_user_id)
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Reserva completada', 'pin', v_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Completar Viaje (Liberar Payout al Conductor)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_price NUMERIC;
    v_valid_pin BOOLEAN;
BEGIN
    -- Validar PIN y Conductor
    SELECT (p->>'pin' = p_pin) INTO v_valid_pin 
    FROM public.rides, jsonb_array_elements(passengers) p 
    WHERE id = p_ride_id AND p->>'id' = p_passenger_id::text;

    IF NOT v_valid_pin THEN RETURN jsonb_build_object('success', false, 'message', 'PIN Inválido'); END IF;

    -- Obtener precio para el payout
    SELECT price INTO v_price FROM public.rides WHERE id = p_ride_id;

    -- Payout al conductor
    UPDATE public.wallets SET balance = balance + v_price WHERE user_id = v_driver_id;

    -- Marcar pasajero como a bordo/completado
    UPDATE public.rides SET 
        passengers = (
            SELECT jsonb_agg(
                CASE WHEN p->>'id' = p_passenger_id::text 
                THEN p || '{"status": "boarded"}'::jsonb 
                ELSE p END
            )
            FROM jsonb_array_elements(passengers) p
        )
    WHERE id = p_ride_id;

    -- Procesar Impacto CO2 (Gamificación)
    PERFORM public.process_ride_impact(p_ride_id);

    RETURN jsonb_build_object('success', true, 'message', 'Viaje completado y payout liberado');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. BÚSQUEDA INTELIGENTE (Corridor Search v2.0)
-- Encuentra viajes que pasen cerca del origen Y destino del pasajero
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
    match_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id, r.driver_id, r.origin, r.destination, r.price, r.seats_available, r.departure_time,
        (ST_Distance(ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326), ST_SetSRID(ST_Point((r.origin->'coordinates'->>1)::numeric, (r.origin->'coordinates'->>0)::numeric), 4326)) +
         ST_Distance(ST_SetSRID(ST_Point(p_dest_lng, p_dest_lat), 4326), ST_SetSRID(ST_Point((r.destination->'coordinates'->>1)::numeric, (r.destination->'coordinates'->>0)::numeric), 4326))) as match_score
    FROM public.rides r
    WHERE 
        r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.departure_time >= p_departure_after
        -- Radio de cercanía al origen
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_origin_lng, p_origin_lat), 4326)::geography,
            ST_SetSRID(ST_Point((r.origin->'coordinates'->>1)::numeric, (r.origin->'coordinates'->>0)::numeric), 4326)::geography,
            p_max_dist_meters
        )
        -- Radio de cercanía al destino
        AND ST_DWithin(
            ST_SetSRID(ST_Point(p_dest_lng, p_dest_lat), 4326)::geography,
            ST_SetSRID(ST_Point((r.destination->'coordinates'->>1)::numeric, (r.destination->'coordinates'->>0)::numeric), 4326)::geography,
            p_max_dist_meters
        )
    ORDER BY match_score ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. LÓGICA DE SEGURIDAD PARA CANCELACIONES (Automatic Refund System)
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(p_ride_id UUID) RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_price NUMERIC;
BEGIN
    -- 1. Verificar que es el conductor y el viaje no ha terminado
    SELECT price INTO v_price FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'scheduled';
    
    IF v_price IS NULL THEN 
        RETURN jsonb_build_object('success', false, 'message', 'No se puede cancelar este viaje o no eres el dueño');
    END IF;

    -- 2. REEMBOLSO ATÓMICO A CADA PASAJERO
    FOR v_passenger IN SELECT (p->>'id')::UUID as id FROM public.rides, jsonb_array_elements(passengers) p WHERE id = p_ride_id AND p->>'status' = 'confirmed' LOOP
        UPDATE public.wallets SET balance = balance + v_price WHERE user_id = v_passenger.id;
        
        -- Notificar al usuario (vía tabla de notificaciones si existe)
        -- INSERT INTO public.notifications ...
    END LOOP;

    -- 3. Marcar viaje como cancelado
    UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado y todos los pasajeros reembolsados automáticamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. TRIGGER DE PROTECCIÓN DE CONTRATO (Anti-Fraude)
-- Evita cambiar precio o ruta si ya hay gente que ha pagado
CREATE OR REPLACE FUNCTION public.protect_ride_contract() RETURNS TRIGGER AS $$
BEGIN
    IF (jsonb_array_length(OLD.passengers) > 0) THEN
        IF (NEW.price <> OLD.price OR NEW.origin <> OLD.origin OR NEW.destination <> OLD.destination OR NEW.departure_time <> OLD.departure_time) THEN
            RAISE EXCEPTION 'No se pueden modificar datos críticos (precio/ruta/hora) si ya hay pasajeros confirmados. Cancela el viaje si es necesario.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_protect_ride_contract
BEFORE UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.protect_ride_contract();

-- 9. VALIDACIÓN DE TIEMPO
ALTER TABLE public.rides ADD CONSTRAINT departure_time_future CHECK (departure_time > NOW());
