-- ==========================================
-- SCRIPT DE ESQUEMA COMPLETO PARA SHAREWAY
-- Migración de Firebase a Supabase
-- ==========================================
-- Habilitar la extensión PostGIS para geolocalización
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS http;
-- 1. TABLA DE PERFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE,
    full_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    photo_url TEXT,
    phone TEXT,
    is_phone_verified BOOLEAN DEFAULT FALSE,
    bio TEXT,
    gender TEXT DEFAULT 'unspecified',
    vehicle JSONB DEFAULT '{}'::jsonb,
    preferences JSONB DEFAULT '{"smoking": "any", "pets": "any", "music": "any", "talkativeness": "any"}'::jsonb,
    verification JSONB DEFAULT '{"status": "not_verified"}'::jsonb,
    documents JSONB DEFAULT '{}'::jsonb,
    security_settings JSONB DEFAULT '{"share_trip_enabled": false, "audio_recording_enabled": false, "pin_verification_enabled": true}'::jsonb,
    rating NUMERIC(3, 2) DEFAULT 0.0,
    review_count INTEGER DEFAULT 0,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'driver')),
    is_admin BOOLEAN DEFAULT FALSE,
    -- Agregado para compatibilidad con rpc_functions.sql
    fcm_token TEXT,
    -- Columna para el token de notificaciones
    stripe_customer_id TEXT,
    -- Para pagos
    stripe_account_verified BOOLEAN DEFAULT FALSE,
    -- Para pagos
    total_co2_saved DECIMAL DEFAULT 0,
    -- Para gamificación
    rides_count INTEGER DEFAULT 0,
    -- Total de viajes completados
    is_suspended BOOLEAN DEFAULT FALSE,
    -- Suspensión temporal
    suspension_until TIMESTAMPTZ,
    -- Fecha de fin de suspensión
    cancellation_count_30d INTEGER DEFAULT 0,
    -- Cancelaciones en últimos 30 días
    last_cancellation_check TIMESTAMPTZ DEFAULT NOW(),
    -- Última vez que se verificó
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. TABLA DE COMUNIDADES
CREATE TABLE IF NOT EXISTS public.communities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    allowed_domain TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 3. TABLA DE VIAJES (RIDES)
CREATE TABLE IF NOT EXISTS public.rides (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    origin_location GEOGRAPHY(POINT, 4326),
    destination_location GEOGRAPHY(POINT, 4326),
    departure_time TIMESTAMPTZ NOT NULL,
    seats_total INTEGER NOT NULL CHECK (seats_total > 0),
    seats_available INTEGER NOT NULL,
    price NUMERIC(10, 2) DEFAULT 0.00,
    details TEXT,
    distance NUMERIC,
    overview_polyline TEXT,
    bounds JSONB,
    status TEXT DEFAULT 'scheduled' CHECK (
        status IN (
            'scheduled',
            'active',
            'in_progress',
            'completed',
            'cancelled',
            'expired'
        )
    ),
    is_women_only BOOLEAN DEFAULT FALSE,
    is_exclusive_community BOOLEAN DEFAULT FALSE,
    allowed_communities TEXT [] DEFAULT '{}',
    approval_mode TEXT DEFAULT 'automatic' CHECK (approval_mode IN ('automatic', 'manual')),
    participant_ids UUID [] DEFAULT '{}',
    initial_price NUMERIC(10, 2) DEFAULT 0.00,
    modification_window_start TIMESTAMPTZ DEFAULT NOW(),
    modification_window_count INTEGER DEFAULT 0,
    last_modified_at TIMESTAMPTZ,
    passengers JSONB DEFAULT '[]'::jsonb,
    pending_passenger_ids UUID [] DEFAULT '{}',
    passenger_ids UUID [] DEFAULT '{}',
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    co2_saved DECIMAL,
    -- Ahorro de CO2
    current_location JSONB,
    -- Ubicación actual del conductor
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT rides_unique_driver_departure UNIQUE (driver_id, departure_time)
);
-- 4. TABLA DE SOLICITUDES/RESERVAS (RIDE_REQUESTS)
CREATE TABLE IF NOT EXISTS public.ride_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE
    SET NULL,
        requester_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
        requester_display_name TEXT,
        requester_photo_url TEXT,
        origin JSONB,
        destination JSONB,
        origin_location GEOGRAPHY(POINT, 4326),
        destination_location GEOGRAPHY(POINT, 4326),
        departure_time TIMESTAMPTZ,
        seats_needed INTEGER DEFAULT 1,
        suggested_price NUMERIC,
        status TEXT DEFAULT 'pending' CHECK (
            status IN (
                'pending',
                'accepted',
                'rejected',
                'cancelled',
                'expired',
                'fulfilled'
            )
        ),
        payment_intent_id TEXT,
        pin TEXT,
        matched_ride_id UUID REFERENCES public.rides(id) ON DELETE
    SET NULL,
        expires_at TIMESTAMPTZ,
        payment_expires_at TIMESTAMPTZ,
        -- Límite para pagar tras ser aceptado
        created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 5. TABLA DE RUTAS FAVORITAS
CREATE TABLE IF NOT EXISTS public.favorite_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    days INTEGER [] NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 6. TABLA DE CONTACTOS DE EMERGENCIA
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    relationship TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 7. TABLA DE WALLETS
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
    balance NUMERIC(10, 2) DEFAULT 0.00,
    held_balance NUMERIC(10, 2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 8. TABLA DE TRANSACCIONES
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_id UUID REFERENCES public.wallets(user_id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    balance_after NUMERIC(10, 2),
    type TEXT,
    description TEXT,
    related_ride_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 9. TABLA DE CHATS
CREATE TABLE IF NOT EXISTS public.chats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE
    SET NULL,
        participants UUID [] NOT NULL,
        participant_names JSONB DEFAULT '{}'::jsonb,
        last_message JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 10. TABLA DE MENSAJES
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.profiles(id) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 11. TABLA DE VALORACIONES (REVIEWS)
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE
    SET NULL,
        author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
        target_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
        rating INTEGER NOT NULL CHECK (
            rating >= 1
            AND rating <= 5
        ),
        comment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(ride_id, author_id, target_id)
);
-- 12. TABLA DE NOTIFICACIONES
CREATE TABLE IF NOT EXISTS public.notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 13. TABLAS DE GAMIFICACIÓN
CREATE TABLE IF NOT EXISTS public.achievements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT
);
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);
INSERT INTO public.achievements (id, name, description, icon)
VALUES (
        'FIRST_RIDE',
        'Pionero del Asfalto',
        'Completa tu primer viaje como conductor o pasajero.',
        'award'
    ),
    (
        'CO2_SAVER_1',
        'Héroe del Carbono',
        'Ahorra 10kg de CO2.',
        'leaf'
    ),
    (
        'CO2_SAVER_2',
        'Guardián del Planeta',
        'Ahorra 50kg de CO2.',
        'shield'
    ),
    (
        'FIVE_STAR_DRIVER',
        'Conductor 5 Estrellas',
        'Recibe tu primera calificación de 5 estrellas.',
        'star'
    ),
    (
        'GREEN_WASH',
        'Lavado Verde',
        'Completa 10 viajes compartidos.',
        'umbrella'
    ) ON CONFLICT (id) DO NOTHING;
-- 14. TABLA DE SOLICITUDES DE PAGO (PAYOUTS)
CREATE TABLE IF NOT EXISTS public.payout_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    stripe_transfer_id TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 15. TABLA DE DISPUTAS POR CANCELACIÓN (FUERZA MAYOR)
CREATE TABLE IF NOT EXISTS public.cancellation_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    user_type TEXT NOT NULL CHECK (user_type IN ('driver', 'passenger')),
    reason TEXT NOT NULL,
    evidence_urls TEXT [],
    refund_amount NUMERIC(10, 2),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_id UUID REFERENCES public.profiles(id) ON DELETE
    SET NULL,
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
);
-- 14. TABLA DE PAQUETES (PACKAGES)
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    driver_id UUID REFERENCES public.profiles(id) ON DELETE
    SET NULL,
        ride_id UUID REFERENCES public.rides(id) ON DELETE
    SET NULL,
        origin JSONB,
        destination JSONB,
        origin_address TEXT NOT NULL,
        destination_address TEXT NOT NULL,
        origin_location GEOGRAPHY(POINT, 4326),
        destination_location GEOGRAPHY(POINT, 4326),
        delivery_by TIMESTAMPTZ NOT NULL,
        size TEXT CHECK (
            size IN ('small', 'medium', 'large', 'extra_large')
        ),
        weight DECIMAL,
        price DECIMAL NOT NULL CHECK (price >= 0),
        description TEXT,
        status TEXT DEFAULT 'pending' CHECK (
            status IN (
                'pending',
                'accepted',
                'picked_up',
                'completed',
                'cancelled',
                'expired'
            )
        ),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Asegurar columnas si la tabla ya existía sin ellas
ALTER TABLE IF EXISTS public.packages
ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES public.profiles(id) ON DELETE
SET NULL;
ALTER TABLE IF EXISTS public.packages
ADD COLUMN IF NOT EXISTS ride_id UUID REFERENCES public.rides(id) ON DELETE
SET NULL;
-- ==========================================
-- CONFIGURACIÓN DE SEGURIDAD (RLS)
-- ==========================================
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorite_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
-- RLS Policies
-- Wallets: cada usuario puede ver su propia wallet
DROP POLICY IF EXISTS wallets_select_own ON public.wallets;
CREATE POLICY wallets_select_own ON public.wallets FOR
SELECT USING (user_id = auth.uid());
-- Transactions: cada usuario puede ver sus propias transacciones
DROP POLICY IF EXISTS transactions_select_own ON public.transactions;
CREATE POLICY transactions_select_own ON public.transactions FOR
SELECT USING (user_id = auth.uid());
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.notifications;
CREATE POLICY "Enable read access for all users" ON public.notifications FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Enable read access for all users" ON public.achievements;
CREATE POLICY "Enable read access for all users" ON public.achievements FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Users can view their own achievements" ON public.user_achievements;
CREATE POLICY "Users can view their own achievements" ON public.user_achievements FOR
SELECT USING (auth.uid() = user_id);
-- Policies for packages
DROP POLICY IF EXISTS "Users can view their own packages (sender or driver)" ON public.packages;
CREATE POLICY "Users can view their own packages (sender or driver)" ON public.packages FOR
SELECT USING (
        auth.uid() = sender_id
        OR auth.uid() = driver_id
    );
DROP POLICY IF EXISTS "Users can create packages" ON public.packages;
CREATE POLICY "Users can create packages" ON public.packages FOR
INSERT WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "Senders can update their pending packages" ON public.packages;
CREATE POLICY "Senders can update their pending packages" ON public.packages FOR
UPDATE USING (
        auth.uid() = sender_id
        AND status = 'pending'
    );
DROP POLICY IF EXISTS "Drivers can update packages they accepted" ON public.packages;
CREATE POLICY "Drivers can update packages they accepted" ON public.packages FOR
UPDATE USING (auth.uid() = driver_id);
-- Note: Logic for accepting valid packages (setting driver_id) might need a function or broader policy, keeping it simple for now or handling via RPC if needed.
-- For now allowing update if you ARE the driver implies you are already set. To accept, we might rely on initial NULL.
-- Let's add a policy for acceptance:
DROP POLICY IF EXISTS "Drivers can accept pending packages" ON public.packages;
CREATE POLICY "Drivers can accept pending packages" ON public.packages FOR
UPDATE USING (
        status = 'pending'
        AND driver_id IS NULL
    );
-- ==========================================
-- TRIGGERS Y FUNCIONES AUTOMÁTICAS
-- ==========================================
-- Trigger para crear perfil automáticamente
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN
INSERT INTO public.profiles (id, email)
VALUES (new.id, new.email);
INSERT INTO public.wallets (user_id)
VALUES (new.id);
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Triggers para notificaciones y gamificación
-- Triggers para notificaciones y gamificación
CREATE OR REPLACE FUNCTION public.handle_ride_update_notifications() RETURNS TRIGGER AS $$
DECLARE v_passenger JSONB;
v_passenger_id UUID;
v_total_co2_saved_for_user DECIMAL;
v_passenger_co2 DECIMAL;
v_passenger_count INTEGER;
BEGIN IF TG_OP = 'UPDATE' THEN -- Lógica de Gamificación al completar un viaje
IF NEW.status = 'completed'
AND OLD.status != 'completed' THEN -- 1. ACTUALIZAR CONDUCTOR
UPDATE public.profiles
SET total_co2_saved = total_co2_saved + NEW.co2_saved,
    rides_count = rides_count + 1
WHERE id = NEW.driver_id;
-- Logro de Primer Viaje (Conductor)
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (NEW.driver_id, 'FIRST_RIDE') ON CONFLICT DO NOTHING;
-- Verificar Logros de CO2 para el Conductor
SELECT total_co2_saved INTO v_total_co2_saved_for_user
FROM public.profiles
WHERE id = NEW.driver_id;
IF v_total_co2_saved_for_user >= 10 THEN
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (NEW.driver_id, 'CO2_SAVER_1') ON CONFLICT DO NOTHING;
PERFORM public.create_notification(
    NEW.driver_id,
    '¡Nuevo Logro! 🏆',
    'Has alcanzado el nivel "Héroe del Carbono" al ahorrar 10kg de CO2. ¡Sigue así!',
    'achievement',
    jsonb_build_object('achievement_id', 'CO2_SAVER_1')
);
END IF;
IF v_total_co2_saved_for_user >= 50 THEN
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (NEW.driver_id, 'CO2_SAVER_2') ON CONFLICT DO NOTHING;
PERFORM public.create_notification(
    NEW.driver_id,
    '¡Maestría Ecológica! 🌍',
    'Increíble: Has ahorrado 50kg de CO2. Eres un "Guardián del Planeta".',
    'achievement',
    jsonb_build_object('achievement_id', 'CO2_SAVER_2')
);
END IF;
-- 2. ACTUALIZAR PASAJEROS
v_passenger_count := jsonb_array_length(NEW.passengers);
IF v_passenger_count > 0 THEN v_passenger_co2 := NEW.co2_saved / v_passenger_count;
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(NEW.passengers) LOOP v_passenger_id := (v_passenger->>'id')::UUID;
-- Solo a los confirmados (o verificados)
IF v_passenger->>'status' IN ('confirmed', 'verified', 'confirmed_by_pin') THEN
UPDATE public.profiles
SET total_co2_saved = total_co2_saved + v_passenger_co2,
    rides_count = rides_count + 1
WHERE id = v_passenger_id;
-- Logro de Primer Viaje (Pasajero)
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (v_passenger_id, 'FIRST_RIDE') ON CONFLICT DO NOTHING;
-- Verificar Logros de CO2 para el Pasajero
SELECT total_co2_saved INTO v_total_co2_saved_for_user
FROM public.profiles
WHERE id = v_passenger_id;
IF v_total_co2_saved_for_user >= 10 THEN
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (v_passenger_id, 'CO2_SAVER_1') ON CONFLICT DO NOTHING;
PERFORM public.create_notification(
    v_passenger_id,
    '¡Nuevo Logro! 🏆',
    'Has ahorrado 10kg de CO2 compartiendo trayectos. ¡Nivel "Héroe del Carbono" alcanzado!',
    'achievement',
    jsonb_build_object('achievement_id', 'CO2_SAVER_1')
);
END IF;
IF v_total_co2_saved_for_user >= 50 THEN
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (v_passenger_id, 'CO2_SAVER_2') ON CONFLICT DO NOTHING;
PERFORM public.create_notification(
    v_passenger_id,
    '¡Leyenda Verde! 🍃',
    'Has ahorrado 50kg de CO2. La tierra te lo agradece, "Guardián del Planeta".',
    'achievement',
    jsonb_build_object('achievement_id', 'CO2_SAVER_2')
);
END IF;
END IF;
END LOOP;
END IF;
END IF;
-- Lógica de Notificaciones de Estado de Viaje
IF NEW.status != OLD.status THEN -- Notificar a todos los participantes del cambio de estado
-- (Omitido para brevedad ya que se maneja en el logic flow o puede añadirse aquí)
END IF;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_ride_update_send_notification ON public.rides;
CREATE TRIGGER on_ride_update_send_notification
AFTER
UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.handle_ride_update_notifications();
DROP TRIGGER IF EXISTS on_package_updated ON public.packages;
CREATE TRIGGER on_package_updated BEFORE
UPDATE ON public.packages FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
-- Triggers para matching
CREATE OR REPLACE FUNCTION public.invoke_match_engine() RETURNS TRIGGER AS $$
DECLARE v_service_key TEXT;
BEGIN v_service_key := current_setting('app.secrets.service_role_key', true);
IF v_service_key IS NULL
OR v_service_key = '' THEN RAISE WARNING 'Match Engine: service_role_key no configurada.';
RETURN NEW;
END IF;
PERFORM net.http_post(
    url := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/match-engine',
    headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || v_service_key,
        'Content-Type',
        'application/json'
    ),
    body := jsonb_build_object(
        'table',
        TG_TABLE_NAME,
        'record',
        NEW
    )
);
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS on_new_ride_invoke_match_engine ON public.rides;
CREATE TRIGGER on_new_ride_invoke_match_engine
AFTER
INSERT ON public.rides FOR EACH ROW EXECUTE FUNCTION public.invoke_match_engine();
DROP TRIGGER IF EXISTS on_new_ride_request_invoke_match_engine ON public.ride_requests;
CREATE TRIGGER on_new_ride_request_invoke_match_engine
AFTER
INSERT ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.invoke_match_engine();