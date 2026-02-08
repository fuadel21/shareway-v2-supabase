-- ========================================================
-- SHAREWAY - TODAS LAS MIGRACIONES COMBINADAS
-- Aplicar en orden en el SQL Editor de Supabase
-- ========================================================

-- ========================================================
-- FASE 1: FIXES CRÍTICOS
-- ========================================================

-- 1. FIX RACE CONDITIONS
-- ========================================================
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid);

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
        p_ride_id UUID,
        p_request_id UUID DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_passenger_name TEXT;
    v_passenger_photo TEXT;
    v_passenger_gender TEXT;
    v_ride_price DECIMAL;
    v_seats_available INTEGER;
    v_driver_id UUID;
    v_is_women_only BOOLEAN;
    v_payment_expires_at TIMESTAMPTZ;
    v_request_status TEXT;
    v_payment_status TEXT;
    v_wallet_balance DECIMAL;
    v_held_amount DECIMAL;
    v_new_held_balance DECIMAL;
    v_ride_status TEXT;
    v_index INTEGER := 0;
    v_max_attempts INTEGER := 3;
    v_lock_acquired BOOLEAN := FALSE;
BEGIN
    -- Validación de autenticación
    IF v_passenger_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Bucle de reintento con bloqueo atómico
    WHILE v_index < v_max_attempts AND NOT v_lock_acquired LOOP
        BEGIN
            -- Bloquear el ride para prevenir race conditions
            SELECT 
                r.price, r.seats_available, r.driver_id, r.is_women_only,
                r.status, r.payment_expires_at
            INTO 
                v_ride_price, v_seats_available, v_driver_id, v_is_women_only,
                v_ride_status, v_payment_expires_at
            FROM public.rides r
            WHERE r.id = p_ride_id
            FOR UPDATE NOWAIT;

            v_lock_acquired := TRUE;

        EXCEPTION
            WHEN lock_not_available THEN
                v_index := v_index + 1;
                IF v_index < v_max_attempts THEN
                    -- Esperar un tiempo aleatorio antes de reintentar
                    PERFORM pg_sleep(0.1 * (1 + RANDOM()));
                END IF;
        END;
    END LOOP;

    -- Si no se pudo adquirir el bloqueo después de los intentos
    IF NOT v_lock_acquired THEN
        RAISE EXCEPTION 'No se pudo procesar la solicitud. Inténtalo nuevamente.';
    END IF;

    -- Validaciones del ride
    IF v_ride_status != 'scheduled' THEN
        RAISE EXCEPTION 'El viaje no está disponible para reserva';
    END IF;

    IF v_seats_available <= 0 THEN
        RAISE EXCEPTION 'No hay asientos disponibles';
    END IF;

    -- Validar request si se proporciona
    IF p_request_id IS NOT NULL THEN
        SELECT status INTO v_request_status
        FROM public.ride_requests
        WHERE id = p_request_id AND requester_id = v_passenger_id;

        IF v_request_status != 'accepted' THEN
            RAISE EXCEPTION 'La solicitud no está aceptada o no existe';
        END IF;
    END IF;

    -- Obtener datos del pasajero
    SELECT display_name, photo_url, gender
    INTO v_passenger_name, v_passenger_photo, v_passenger_gender
    FROM public.profiles
    WHERE id = v_passenger_id;

    -- Validación de género para viajes women_only
    IF v_is_women_only AND (v_passenger_gender IS NULL OR LOWER(v_passenger_gender) != 'female') THEN
        RAISE EXCEPTION 'Este viaje es exclusivo para mujeres';
    END IF;

    -- Obtener balance del wallet del pasajero
    SELECT balance, held_balance
    INTO v_wallet_balance, v_held_amount
    FROM public.wallets
    WHERE user_id = v_passenger_id;

    IF v_wallet_balance IS NULL THEN
        RAISE EXCEPTION 'Wallet no encontrado';
    END IF;

    -- Calcular monto a retener (precio por asiento)
    v_held_amount := v_ride_price;

    -- Verificar fondos suficientes
    IF v_wallet_balance < v_held_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    -- Actualizar wallet (deducir fondos y poner en hold)
    v_new_held_balance := v_held_amount + v_held_amount;
    
    UPDATE public.wallets
    SET 
        balance = balance - v_held_amount,
        held_balance = v_new_held_balance,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- Actualizar ride (reducir asientos disponibles y agregar pasajero)
    UPDATE public.rides
    SET 
        seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_passenger_id),
        updated_at = NOW()
    WHERE id = p_ride_id;

    -- Crear registro de pasajero
    INSERT INTO public.ride_passengers (
        ride_id, passenger_id, passenger_name, passenger_photo_url,
        pickup_point, status, payment_status, held_amount,
        payment_expires_at, created_at
    ) VALUES (
        p_ride_id, v_passenger_id, v_passenger_name, v_passenger_photo,
        NULL, 'confirmed', 'pending', v_held_amount,
        NOW() + INTERVAL '15 minutes', NOW()
    );

    -- Actualizar request si se proporcionó
    IF p_request_id IS NOT NULL THEN
        UPDATE public.ride_requests
        SET status = 'confirmed', updated_at = NOW()
        WHERE id = p_request_id;
    END IF;

    -- Si el ride está lleno, cambiar estado
    IF v_seats_available - 1 = 0 THEN
        UPDATE public.rides
        SET status = 'full', updated_at = NOW()
        WHERE id = p_ride_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'rideId', p_ride_id,
        'passengerId', v_passenger_id,
        'heldAmount', v_held_amount,
        'paymentExpiresAt', NOW() + INTERVAL '15 minutes'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. ADMIN PERMISSIONS
-- ========================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator'));

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID := COALESCE(p_user_id, auth.uid());
    v_user_role TEXT;
BEGIN
    SELECT role INTO v_user_role
    FROM public.profiles
    WHERE id = v_user_id;

    RETURN v_user_role IN ('admin', 'moderator');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    action_type TEXT NOT NULL,
    window_minutes INTEGER NOT NULL,
    max_actions INTEGER NOT NULL,
    current_count INTEGER DEFAULT 0,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, action_type)
);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_action_type TEXT,
    p_window_minutes INTEGER DEFAULT 60,
    p_max_actions INTEGER DEFAULT 10
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_count INTEGER;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
BEGIN
    -- Obtener registro actual de rate limit
    SELECT current_count, window_start
    INTO v_current_count, v_window_start
    FROM public.rate_limits
    WHERE user_id = auth.uid() AND action_type = p_action_type;

    -- Si no existe registro, crear uno nuevo
    IF v_current_count IS NULL THEN
        INSERT INTO public.rate_limits (
            user_id, action_type, window_minutes, max_actions,
            current_count, window_start
        ) VALUES (
            auth.uid(), p_action_type, p_window_minutes, p_max_actions,
            1, NOW()
        );
        RETURN TRUE;
    END IF;

    -- Verificar si la ventana ha expirado
    v_window_end := v_window_start + (p_window_minutes || ' minutes')::INTERVAL;
    
    IF NOW() > v_window_end THEN
        -- Reiniciar contador
        UPDATE public.rate_limits
        SET 
            current_count = 1,
            window_start = NOW(),
            updated_at = NOW()
        WHERE user_id = auth.uid() AND action_type = p_action_type;
        RETURN TRUE;
    END IF;

    -- Verificar si se excede el límite
    IF v_current_count >= p_max_actions THEN
        RETURN FALSE;
    END IF;

    -- Incrementar contador
    UPDATE public.rate_limits
    SET 
        current_count = current_count + 1,
        updated_at = NOW()
    WHERE user_id = auth.uid() AND action_type = p_action_type;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. ESCROW SYSTEM
-- ========================================================
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS escrow_balance DECIMAL DEFAULT 0;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS escrow_release_date TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.move_to_escrow(
    p_user_id UUID,
    p_amount DECIMAL,
    p_ride_id UUID,
    p_release_date TIMESTAMPTZ DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_current_balance DECIMAL;
    v_current_escrow DECIMAL;
BEGIN
    -- Obtener balance actual
    SELECT balance, escrow_balance
    INTO v_current_balance, v_current_escrow
    FROM public.wallets
    WHERE user_id = p_user_id;

    -- Validar fondos suficientes
    IF v_current_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente para mover a escrow';
    END IF;

    -- Mover fondos a escrow
    UPDATE public.wallets
    SET 
        balance = balance - p_amount,
        escrow_balance = escrow_balance + p_amount,
        escrow_release_date = COALESCE(p_release_date, NOW() + INTERVAL '24 hours'),
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Registrar transacción
    INSERT INTO public.wallet_transactions (
        user_id, type, amount, reference_id, description, metadata
    ) VALUES (
        p_user_id, 'escrow_hold', -p_amount, p_ride_id,
        'Fondos movidos a escrow',
        json_build_object('escrow_release_date', COALESCE(p_release_date, NOW() + INTERVAL '24 hours'))
    );

    RETURN json_build_object('success', true, 'amount', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. VALIDACIONES ADICIONALES
-- ========================================================
CREATE OR REPLACE FUNCTION public.validate_coordinates(p_lat DECIMAL, p_lng DECIMAL)
RETURNS BOOLEAN AS $$
BEGIN
    -- Validar rangos de coordenadas
    IF p_lat IS NULL OR p_lng IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_lat < -90 OR p_lat > 90 THEN
        RETURN FALSE;
    END IF;

    IF p_lng < -180 OR p_lng > 180 THEN
        RETURN FALSE;
    END IF;

    -- Validar que no sean coordenadas inválidas (0,0)
    IF p_lat = 0 AND p_lng = 0 THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.validate_distance(p_distance DECIMAL)
RETURNS BOOLEAN AS $$
BEGIN
    -- Validar distancia razonable (máximo 500km)
    IF p_distance IS NULL OR p_distance <= 0 OR p_distance > 500 THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================
-- FASE 2: SISTEMA DE RATING
-- ========================================================

-- Eliminar tabla si existe para recrearla con estructura correcta
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.user_rating_stats CASCADE;

-- Crear la tabla de reviews con todas las columnas
CREATE TABLE public.reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reviewer_id UUID NOT NULL,
    reviewee_id UUID NOT NULL,
    ride_id UUID,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(reviewer_id, reviewee_id, ride_id)
);

-- Crear la tabla de estadísticas
CREATE TABLE public.user_rating_stats (
    user_id UUID PRIMARY KEY,
    average_rating DECIMAL(3,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    rating_1_count INTEGER DEFAULT 0,
    rating_2_count INTEGER DEFAULT 0,
    rating_3_count INTEGER DEFAULT 0,
    rating_4_count INTEGER DEFAULT 0,
    rating_5_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Añadir las restricciones foreign key
ALTER TABLE public.reviews 
    ADD CONSTRAINT reviews_reviewer_id_fkey 
    FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.reviews 
    ADD CONSTRAINT reviews_reviewee_id_fkey 
    FOREIGN KEY (reviewee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.reviews 
    ADD CONSTRAINT reviews_ride_id_fkey 
    FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;

ALTER TABLE public.user_rating_stats 
    ADD CONSTRAINT user_rating_stats_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.calculate_user_rating(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_avg_rating DECIMAL;
    v_total_reviews INTEGER;
    v_rating_counts JSONB;
BEGIN
    -- Calcular rating promedio
    SELECT 
        AVG(rating)::DECIMAL(3,2),
        COUNT(*)
    INTO v_avg_rating, v_total_reviews
    FROM public.reviews
    WHERE reviewee_id = p_user_id;

    -- Obtener distribución de ratings
    SELECT jsonb_build_object(
        'rating_1_count', COUNT(CASE WHEN rating = 1 THEN 1 END),
        'rating_2_count', COUNT(CASE WHEN rating = 2 THEN 1 END),
        'rating_3_count', COUNT(CASE WHEN rating = 3 THEN 1 END),
        'rating_4_count', COUNT(CASE WHEN rating = 4 THEN 1 END),
        'rating_5_count', COUNT(CASE WHEN rating = 5 THEN 1 END)
    ) INTO v_rating_counts
    FROM public.reviews
    WHERE reviewee_id = p_user_id;

    -- Actualizar o insertar estadísticas
    INSERT INTO public.user_rating_stats (
        user_id, average_rating, total_reviews,
        rating_1_count, rating_2_count, rating_3_count,
        rating_4_count, rating_5_count, updated_at
    ) VALUES (
        p_user_id, COALESCE(v_avg_rating, 0), COALESCE(v_total_reviews, 0),
        COALESCE((v_rating_counts->>'rating_1_count')::INTEGER, 0),
        COALESCE((v_rating_counts->>'rating_2_count')::INTEGER, 0),
        COALESCE((v_rating_counts->>'rating_3_count')::INTEGER, 0),
        COALESCE((v_rating_counts->>'rating_4_count')::INTEGER, 0),
        COALESCE((v_rating_counts->>'rating_5_count')::INTEGER, 0),
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        average_rating = EXCLUDED.average_rating,
        total_reviews = EXCLUDED.total_reviews,
        rating_1_count = EXCLUDED.rating_1_count,
        rating_2_count = EXCLUDED.rating_2_count,
        rating_3_count = EXCLUDED.rating_3_count,
        rating_4_count = EXCLUDED.rating_4_count,
        rating_5_count = EXCLUDED.rating_5_count,
        updated_at = NOW();

    RETURN json_build_object(
        'success', true,
        'average_rating', COALESCE(v_avg_rating, 0),
        'total_reviews', COALESCE(v_total_reviews, 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================
-- FASE 3: SISTEMA DE NOTIFICACIONES
-- ========================================================

-- Eliminar tablas si existen para recrearlas con estructura correcta
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.notification_preferences CASCADE;

-- Crear la tabla de notifications
CREATE TABLE public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'read', 'failed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category TEXT DEFAULT 'general',
    expires_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crear tabla de preferencias
CREATE TABLE public.notification_preferences (
    user_id UUID PRIMARY KEY,
    ride_requests BOOLEAN DEFAULT true,
    ride_accepted BOOLEAN DEFAULT true,
    ride_cancelled BOOLEAN DEFAULT true,
    ride_completed BOOLEAN DEFAULT true,
    payment_required BOOLEAN DEFAULT true,
    payment_confirmed BOOLEAN DEFAULT true,
    payment_failed BOOLEAN DEFAULT true,
    review_reminder BOOLEAN DEFAULT true,
    new_review BOOLEAN DEFAULT true,
    badge_earned BOOLEAN DEFAULT true,
    message_received BOOLEAN DEFAULT true,
    trip_reminder BOOLEAN DEFAULT true,
    driver_arriving BOOLEAN DEFAULT true,
    emergency_alert BOOLEAN DEFAULT true,
    system_update BOOLEAN DEFAULT true,
    promotion BOOLEAN DEFAULT false,
    push_enabled BOOLEAN DEFAULT true,
    email_enabled BOOLEAN DEFAULT true,
    sms_enabled BOOLEAN DEFAULT false,
    do_not_disturb BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '08:00',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Añadir las restricciones foreign key para notificaciones
ALTER TABLE public.notifications 
    ADD CONSTRAINT notifications_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.notification_preferences 
    ADD CONSTRAINT notification_preferences_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ========================================================
-- FASE 4: SISTEMA DE GAMIFICACIÓN
-- ========================================================

-- Eliminar tablas si existen para recrearlas con estructura correcta
DROP TABLE IF EXISTS public.ecopoints_transactions CASCADE;
DROP TABLE IF EXISTS public.user_levels CASCADE;

-- Crear tabla de ecopoints
CREATE TABLE public.ecopoints_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    amount INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'ride_completed', 'review_submitted', 'badge_earned', 
        'streak_milestone', 'challenge_completed', 'daily_login',
        'referral_bonus', 'eco_bonus', 'penalty', 'refund'
    )),
    source_id UUID,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    balance_after INTEGER NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crear tabla de niveles
CREATE TABLE public.user_levels (
    user_id UUID PRIMARY KEY,
    current_level INTEGER DEFAULT 1,
    current_xp INTEGER DEFAULT 0,
    total_xp INTEGER DEFAULT 0,
    level_up_at TIMESTAMPTZ,
    streak_days INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date DATE,
    total_rides INTEGER DEFAULT 0,
    total_reviews_given INTEGER DEFAULT 0,
    total_reviews_received INTEGER DEFAULT 0,
    total_co2_saved DECIMAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Añadir las restricciones foreign key para gamificación
ALTER TABLE public.ecopoints_transactions 
    ADD CONSTRAINT ecopoints_transactions_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.user_levels 
    ADD CONSTRAINT user_levels_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.level_config (
    level INTEGER PRIMARY KEY,
    xp_required INTEGER NOT NULL,
    rewards JSONB DEFAULT '{}'::jsonb,
    title TEXT NOT NULL,
    description TEXT,
    badge_icon TEXT,
    color TEXT DEFAULT '#10b981'
);

INSERT INTO public.level_config (level, xp_required, title, description, badge_icon, color) VALUES
(1, 0, 'Novato Eco', 'Comienza tu viaje ecológico', '🌱', '#10b981'),
(2, 100, 'Viajero Verde', 'Estás aprendiendo a ser ecológico', '🍃', '#22c55e'),
(3, 300, 'Conductor Consciente', 'Tu impacto es notable', '🌿', '#16a34a'),
(4, 600, 'Guardián del Carbono', 'Eres un ejemplo para otros', '🌳', '#15803d'),
(5, 1000, 'Héroe Ecológico', 'Tu contribución es excepcional', '🌲', '#166534'),
(6, 1500, 'Maestro Sostenible', 'Dominas el arte del viaje verde', '🏆', '#14532d'),
(7, 2500, 'Leyenda Verde', 'Eres una inspiración', '💎', '#052e16'),
(8, 4000, 'Eco Maestro', 'Has alcanzado la maestría ecológica', '👑', '#022c22'),
(9, 6000, 'Guardián del Planeta', 'Tu legado es imborrable', '🌍', '#014737'),
(10, 10000, 'Eco Deidad', 'Trascendiste en sostenibilidad', '✨', '#0f766e')
ON CONFLICT (level) DO NOTHING;

-- ========================================================
-- ÍNDICES PARA PERFORMANCE
-- ========================================================

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_ride ON public.reviews(ride_id);
CREATE INDEX IF NOT EXISTS idx_user_rating_stats_user ON public.user_rating_stats(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_ecopoints_user_id ON public.ecopoints_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ecopoints_created_at ON public.ecopoints_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_ecopoints_source_type ON public.ecopoints_transactions(source_type);

CREATE INDEX IF NOT EXISTS idx_user_levels_level ON public.user_levels(current_level);
CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON public.user_levels(total_xp);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON public.rate_limits(user_id, action_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.rate_limits(window_start);

-- ========================================================
-- FUNCIONES DE GAMIFICACIÓN
-- ========================================================

CREATE OR REPLACE FUNCTION public.add_ecopoints(
    p_user_id UUID,
    p_amount INTEGER,
    p_source_type TEXT,
    p_source_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT '',
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_current_balance INTEGER := 0;
    v_new_balance INTEGER;
    v_transaction_id UUID;
    v_level_up BOOLEAN := FALSE;
    v_new_level INTEGER;
BEGIN
    -- Obtener balance actual
    SELECT COALESCE(SUM(amount), 0) INTO v_current_balance
    FROM public.ecopoints_transactions
    WHERE user_id = p_user_id
        AND (expires_at IS NULL OR expires_at > NOW());
    
    -- Calcular nuevo balance
    v_new_balance := v_current_balance + p_amount;
    
    -- Validar que no sea negativo (excepto para penalizaciones)
    IF p_amount < 0 AND p_source_type NOT IN ('penalty', 'refund') THEN
        RAISE EXCEPTION 'Solo se pueden deducir puntos por penalizaciones o reembolsos';
    END IF;
    
    -- Insertar transacción
    INSERT INTO public.ecopoints_transactions (
        user_id, amount, source_type, source_id, description,
        metadata, balance_after, expires_at
    )
    VALUES (
        p_user_id, p_amount, p_source_type, p_source_id, p_description,
        p_metadata, v_new_balance, p_expires_at
    )
    RETURNING id INTO v_transaction_id;
    
    -- Actualizar nivel si es positivo
    IF p_amount > 0 THEN
        -- Obtener XP actual del usuario
        SELECT current_level, total_xp INTO v_new_level, v_current_balance
        FROM public.user_levels
        WHERE user_id = p_user_id;
        
        -- Si no existe, crear registro
        IF v_new_level IS NULL THEN
            INSERT INTO public.user_levels (
                user_id, current_level, current_xp, total_xp
            ) VALUES (
                p_user_id, 1, p_amount, p_amount
            );
            v_new_level := 1;
        ELSE
            -- Actualizar XP
            UPDATE public.user_levels
            SET 
                current_xp = current_xp + p_amount,
                total_xp = total_xp + p_amount,
                updated_at = NOW()
            WHERE user_id = p_user_id;
            
            v_current_balance := v_current_balance + p_amount;
        END IF;
        
        -- Verificar si sube de nivel
        SELECT xp_required INTO v_new_level
        FROM public.level_config
        WHERE level = v_new_level + 1;
        
        IF v_new_level IS NOT NULL AND v_current_balance >= v_new_level THEN
            -- Subir de nivel
            UPDATE public.user_levels
            SET 
                current_level = current_level + 1,
                level_up_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id;
            
            v_level_up := TRUE;
        END IF;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'transaction_id', v_transaction_id,
        'new_balance', v_new_balance,
        'level_up', v_level_up,
        'new_level', CASE WHEN v_level_up THEN v_new_level + 1 ELSE NULL END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================
-- COMPLETADO: TODAS LAS MIGRACIONES APLICADAS
-- ========================================================
