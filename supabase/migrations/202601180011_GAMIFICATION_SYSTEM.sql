-- ========================================================
-- SISTEMA DE GAMIFICACIÓN Y LEALTAD COMPLETO
-- EcoPoints, niveles, rachas, desafíos y recompensas
-- ========================================================
-- 1. Tabla de EcoPoints (transacciones de puntos)
CREATE TABLE IF NOT EXISTS public.ecopoints_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    -- Positivo para ganar, negativo para perder
    source_type TEXT NOT NULL CHECK (
        source_type IN (
            'ride_completed',
            'review_submitted',
            'badge_earned',
            'streak_milestone',
            'challenge_completed',
            'daily_login',
            'referral_bonus',
            'eco_bonus',
            'penalty',
            'refund'
        )
    ),
    source_id UUID,
    -- ID del objeto relacionado (ride, review, badge, etc.)
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    -- Datos adicionales
    balance_after INTEGER NOT NULL,
    -- Saldo después de la transacción
    expires_at TIMESTAMPTZ,
    -- Para puntos que expiran
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Tabla de niveles y progreso de usuario
CREATE TABLE IF NOT EXISTS public.user_levels (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
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
-- 3. Configuración de niveles (XP requerido por nivel)
CREATE TABLE IF NOT EXISTS public.level_config (
    level INTEGER PRIMARY KEY,
    xp_required INTEGER NOT NULL,
    rewards JSONB DEFAULT '{}'::jsonb,
    -- Recompensas al subir de nivel
    title TEXT NOT NULL,
    description TEXT,
    badge_icon TEXT,
    color TEXT DEFAULT '#10b981'
);
-- 4. Tabla de desafíos diarios/semanales
CREATE TABLE IF NOT EXISTS public.challenges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN ('daily', 'weekly', 'monthly', 'special')
    ),
    requirement_type TEXT NOT NULL CHECK (
        requirement_type IN (
            'complete_rides',
            'get_reviews',
            'save_co2',
            'refer_users',
            'maintain_streak',
            'use_app_daily',
            'complete_achievements'
        )
    ),
    requirement_value INTEGER NOT NULL,
    reward_points INTEGER NOT NULL,
    reward_badge TEXT,
    -- Badge especial al completar
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    difficulty TEXT DEFAULT 'medium' CHECK (
        difficulty IN ('easy', 'medium', 'hard', 'legendary')
    ),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 5. Progreso de desafíos por usuario
CREATE TABLE IF NOT EXISTS public.user_challenge_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
    current_progress INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    rewards_claimed BOOLEAN DEFAULT false,
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, challenge_id)
);
-- 6. Rachas (streaks) específicas
CREATE TABLE IF NOT EXISTS public.user_streaks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    streak_type TEXT NOT NULL CHECK (
        streak_type IN (
            'daily_login',
            'weekly_rides',
            'monthly_reviews',
            'eco_warrior'
        )
    ),
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_date DATE,
    streak_start_date DATE,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, streak_type)
);
-- 7. Tabla de recompensas canjeables
CREATE TABLE IF NOT EXISTS public.rewards (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN (
            'discount',
            'free_ride',
            'merchandise',
            'donation',
            'badge',
            'feature'
        )
    ),
    cost_points INTEGER NOT NULL,
    value DECIMAL,
    -- Valor monetario o porcentaje
    availability INTEGER DEFAULT -1,
    -- -1 = ilimitado
    is_active BOOLEAN DEFAULT true,
    requirements JSONB DEFAULT '{}'::jsonb,
    -- Requisitos para canjear
    image_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
-- 8. Historial de canjes de recompensas
CREATE TABLE IF NOT EXISTS public.reward_redemptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES public.rewards(id) ON DELETE CASCADE,
    points_spent INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected', 'expired')
    ),
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);
-- 9. Índices para performance
CREATE INDEX IF NOT EXISTS idx_ecopoints_user_id ON public.ecopoints_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ecopoints_created_at ON public.ecopoints_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_ecopoints_source_type ON public.ecopoints_transactions(source_type);
CREATE INDEX IF NOT EXISTS idx_user_levels_level ON public.user_levels(current_level);
CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON public.user_levels(total_xp);
CREATE INDEX IF NOT EXISTS idx_challenges_type ON public.challenges(type);
CREATE INDEX IF NOT EXISTS idx_challenges_active ON public.challenges(is_active);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_user ON public.user_challenge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_completed ON public.user_challenge_progress(is_completed);
CREATE INDEX IF NOT EXISTS idx_user_streaks_user ON public.user_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_streaks_type ON public.user_streaks(streak_type);
CREATE INDEX IF NOT EXISTS idx_rewards_active ON public.rewards(is_active);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON public.reward_redemptions(user_id);
-- 10. Función para añadir EcoPoints
CREATE OR REPLACE FUNCTION public.add_ecopoints(
        p_user_id UUID,
        p_amount INTEGER,
        p_source_type TEXT,
        p_source_id UUID DEFAULT NULL,
        p_description TEXT DEFAULT '',
        p_metadata JSONB DEFAULT '{}'::jsonb,
        p_expires_at TIMESTAMPTZ DEFAULT NULL
    ) RETURNS JSON AS $$
DECLARE v_current_balance INTEGER := 0;
v_new_balance INTEGER;
v_transaction_id UUID;
v_level_up BOOLEAN := FALSE;
v_new_level INTEGER;
BEGIN -- Obtener balance actual
SELECT COALESCE(SUM(amount), 0) INTO v_current_balance
FROM public.ecopoints_transactions
WHERE user_id = p_user_id
    AND (
        expires_at IS NULL
        OR expires_at > NOW()
    );
-- Calcular nuevo balance
v_new_balance := v_current_balance + p_amount;
-- Validar que no sea negativo (excepto para penalizaciones)
IF p_amount < 0
AND p_source_type NOT IN ('penalty', 'refund') THEN RAISE EXCEPTION 'Solo se pueden deducir puntos por penalizaciones o reembolsos';
END IF;
-- Insertar transacción
INSERT INTO public.ecopoints_transactions (
        user_id,
        amount,
        source_type,
        source_id,
        description,
        metadata,
        balance_after,
        expires_at
    )
VALUES (
        p_user_id,
        p_amount,
        p_source_type,
        p_source_id,
        p_description,
        p_metadata,
        v_new_balance,
        p_expires_at
    )
RETURNING id INTO v_transaction_id;
-- Actualizar nivel si es positivo
IF p_amount > 0 THEN -- Obtener XP actual del usuario
SELECT current_level,
    total_xp INTO v_new_level,
    v_current_balance
FROM public.user_levels
WHERE user_id = p_user_id;
-- Si no existe, crear registro
IF v_new_level IS NULL THEN
INSERT INTO public.user_levels (
        user_id,
        current_level,
        current_xp,
        total_xp
    )
VALUES (
        p_user_id,
        1,
        p_amount,
        p_amount
    );
v_new_level := 1;
ELSE -- Actualizar XP
UPDATE public.user_levels
SET current_xp = current_xp + p_amount,
    total_xp = total_xp + p_amount,
    updated_at = NOW()
WHERE user_id = p_user_id;
v_current_balance := v_current_balance + p_amount;
END IF;
-- Verificar si sube de nivel
SELECT xp_required INTO v_new_level
FROM public.level_config
WHERE level = v_new_level + 1;
IF v_new_level IS NOT NULL
AND v_current_balance >= v_new_level THEN -- Subir de nivel
UPDATE public.user_levels
SET current_level = current_level + 1,
    level_up_at = NOW(),
    updated_at = NOW()
WHERE user_id = p_user_id;
v_level_up := TRUE;
-- Notificar subida de nivel
PERFORM public.create_notification(
    p_user_id,
    'badge_earned',
    '¡Nuevo nivel desbloqueado!',
    'Has alcanzado el nivel ' || (v_new_level + 1) || '.',
    json_build_object(
        'new_level',
        v_new_level + 1,
        'action_url',
        '/profile/achievements'
    ),
    'high',
    'social'
);
END IF;
END IF;
RETURN json_build_object(
    'success',
    true,
    'transaction_id',
    v_transaction_id,
    'new_balance',
    v_new_balance,
    'level_up',
    v_level_up,
    'new_level',
    CASE
        WHEN v_level_up THEN v_new_level + 1
        ELSE NULL
    END
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 11. Función para obtener balance de EcoPoints
CREATE OR REPLACE FUNCTION public.get_ecopoints_balance(p_user_id UUID) RETURNS JSON AS $$
DECLARE v_available_points INTEGER;
v_total_earned INTEGER;
v_total_spent INTEGER;
v_expiring_soon JSONB;
BEGIN -- Puntos disponibles (no expirados)
SELECT COALESCE(SUM(amount), 0) INTO v_available_points
FROM public.ecopoints_transactions
WHERE user_id = p_user_id
    AND (
        expires_at IS NULL
        OR expires_at > NOW()
    );
-- Total ganados
SELECT COALESCE(
        SUM(
            CASE
                WHEN amount > 0 THEN amount
                ELSE 0
            END
        ),
        0
    ) INTO v_total_earned
FROM public.ecopoints_transactions
WHERE user_id = p_user_id;
-- Total gastados
SELECT COALESCE(
        SUM(
            CASE
                WHEN amount < 0 THEN ABS(amount)
                ELSE 0
            END
        ),
        0
    ) INTO v_total_spent
FROM public.ecopoints_transactions
WHERE user_id = p_user_id;
-- Puntos que expiran pronto (próximos 7 días)
SELECT jsonb_agg(
        json_build_object(
            'amount',
            amount,
            'expires_at',
            expires_at,
            'days_until_expiry',
            EXTRACT(
                DAYS
                FROM expires_at - NOW()
            )
        )
    ) INTO v_expiring_soon
FROM public.ecopoints_transactions
WHERE user_id = p_user_id
    AND expires_at IS NOT NULL
    AND expires_at > NOW()
    AND expires_at <= NOW() + INTERVAL '7 days';
RETURN json_build_object(
    'available_points',
    v_available_points,
    'total_earned',
    v_total_earned,
    'total_spent',
    v_total_spent,
    'expiring_soon',
    COALESCE(v_expiring_soon, '[]'::jsonb)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 12. Función para actualizar rachas
CREATE OR REPLACE FUNCTION public.update_streak(
        p_user_id UUID,
        p_streak_type TEXT,
        p_activity_date DATE DEFAULT CURRENT_DATE
    ) RETURNS JSON AS $$
DECLARE v_current_streak RECORD;
v_is_new_day BOOLEAN := FALSE;
v_milestone_rewarded BOOLEAN := FALSE;
BEGIN -- Obtener racha actual
SELECT * INTO v_current_streak
FROM public.user_streaks
WHERE user_id = p_user_id
    AND streak_type = p_streak_type;
-- Si no existe, crearla
IF v_current_streak IS NULL THEN
INSERT INTO public.user_streaks (
        user_id,
        streak_type,
        current_streak,
        last_activity_date,
        streak_start_date
    )
VALUES (
        p_user_id,
        p_streak_type,
        1,
        p_activity_date,
        p_activity_date
    );
v_current_streak.current_streak := 1;
v_current_streak.longest_streak := 1;
v_is_new_day := TRUE;
ELSE -- Verificar si es un día consecutivo
IF p_activity_date = v_current_streak.last_activity_date + INTERVAL '1 day' THEN -- Día consecutivo, incrementar racha
UPDATE public.user_streaks
SET current_streak = current_streak + 1,
    last_activity_date = p_activity_date,
    updated_at = NOW()
WHERE id = v_current_streak.id;
v_current_streak.current_streak := v_current_streak.current_streak + 1;
v_is_new_day := TRUE;
-- Actualizar longest streak si es necesario
IF v_current_streak.current_streak > v_current_streak.longest_streak THEN
UPDATE public.user_streaks
SET longest_streak = current_streak + 1
WHERE id = v_current_streak.id;
v_current_streak.longest_streak := v_current_streak.current_streak;
END IF;
ELSIF p_activity_date > v_current_streak.last_activity_date + INTERVAL '1 day' THEN -- Se rompió la racha, reiniciar
UPDATE public.user_streaks
SET current_streak = 1,
    last_activity_date = p_activity_date,
    streak_start_date = p_activity_date,
    updated_at = NOW()
WHERE id = v_current_streak.id;
v_current_streak.current_streak := 1;
v_is_new_day := TRUE;
END IF;
END IF;
-- Otorgar recompensas por hitos de racha
IF v_is_new_day THEN CASE
    v_current_streak.current_streak
    WHEN 7 THEN PERFORM public.add_ecopoints(
        p_user_id,
        50,
        'streak_milestone',
        NULL,
        'Racha de 7 días completada',
        json_build_object('streak_type', p_streak_type, 'days', 7)
    );
v_milestone_rewarded := TRUE;
WHEN 30 THEN PERFORM public.add_ecopoints(
    p_user_id,
    200,
    'streak_milestone',
    NULL,
    'Racha de 30 días completada',
    json_build_object('streak_type', p_streak_type, 'days', 30)
);
v_milestone_rewarded := TRUE;
WHEN 100 THEN PERFORM public.add_ecopoints(
    p_user_id,
    500,
    'streak_milestone',
    NULL,
    'Racha de 100 días completada',
    json_build_object('streak_type', p_streak_type, 'days', 100)
);
v_milestone_rewarded := TRUE;
END CASE
;
END IF;
RETURN json_build_object(
    'success',
    true,
    'current_streak',
    v_current_streak.current_streak,
    'longest_streak',
    v_current_streak.longest_streak,
    'is_new_day',
    v_is_new_day,
    'milestone_rewarded',
    v_milestone_rewarded
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 13. Insertar configuración de niveles por defecto
INSERT INTO public.level_config (
        level,
        xp_required,
        title,
        description,
        badge_icon,
        color
    )
VALUES (
        1,
        0,
        'Novato Eco',
        'Comienza tu viaje ecológico',
        '🌱',
        '#10b981'
    ),
    (
        2,
        100,
        'Viajero Verde',
        'Estás aprendiendo a ser ecológico',
        '🍃',
        '#22c55e'
    ),
    (
        3,
        300,
        'Conductor Consciente',
        'Tu impacto es notable',
        '🌿',
        '#16a34a'
    ),
    (
        4,
        600,
        'Guardián del Carbono',
        'Eres un ejemplo para otros',
        '🌳',
        '#15803d'
    ),
    (
        5,
        1000,
        'Héroe Ecológico',
        'Tu contribución es excepcional',
        '🌲',
        '#166534'
    ),
    (
        6,
        1500,
        'Maestro Sostenible',
        'Dominas el arte del viaje verde',
        '🏆',
        '#14532d'
    ),
    (
        7,
        2500,
        'Leyenda Verde',
        'Eres una inspiración',
        '💎',
        '#052e16'
    ),
    (
        8,
        4000,
        'Eco Maestro',
        'Has alcanzado la maestría ecológica',
        '👑',
        '#022c22'
    ),
    (
        9,
        6000,
        'Guardián del Planeta',
        'Tu legado es imborrable',
        '🌍',
        '#014737'
    ),
    (
        10,
        10000,
        'Eco Deidad',
        'Trascendiste en sostenibilidad',
        '✨',
        '#0f766e'
    ) ON CONFLICT (level) DO NOTHING;
-- Comentarios para auditoría
COMMENT ON TABLE public.ecopoints_transactions IS 'Transacciones de puntos del sistema de gamificación';
COMMENT ON TABLE public.user_levels IS 'Niveles y progreso de usuarios';
COMMENT ON TABLE public.challenges IS 'Desafíos diarios/semanales para usuarios';
COMMENT ON FUNCTION public.add_ecopoints IS 'Añade puntos con actualización automática de niveles';
COMMENT ON FUNCTION public.get_ecopoints_balance IS 'Obtiene balance y estadísticas de EcoPoints';
COMMENT ON FUNCTION public.update_streak IS 'Actualiza rachas diarias con recompensas';