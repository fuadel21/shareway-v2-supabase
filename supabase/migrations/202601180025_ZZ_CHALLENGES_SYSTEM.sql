-- ========================================================
-- DESAFÍOS Y SISTEMA DE PROGRESIÓN
-- Configuración de desafíos dinámicos y sistema de recompensas
-- ========================================================
-- 1. Insertar desafíos predefinidos
INSERT INTO public.challenges (
        name,
        description,
        type,
        requirement_type,
        requirement_value,
        reward_points,
        reward_badge,
        difficulty,
        metadata
    )
VALUES -- Desafíos Diarios
    (
        'Viajero del Día',
        'Completa al menos 1 viaje hoy',
        'daily',
        'complete_rides',
        1,
        10,
        NULL,
        'easy',
        '{"icon": "🚗", "category": "rides"}'
    ),
    (
        'Feedback Constructivo',
        'Deja 1 valoración hoy',
        'daily',
        'get_reviews',
        1,
        15,
        NULL,
        'easy',
        '{"icon": "⭐", "category": "reviews"}'
    ),
    (
        'Eco Warrior Diario',
        'Ahorra 5kg de CO2 hoy',
        'daily',
        'save_co2',
        5,
        20,
        NULL,
        'medium',
        '{"icon": "🌱", "category": "eco"}'
    ),
    (
        'Social Activo',
        'Usa la app durante 3 días seguidos',
        'daily',
        'use_app_daily',
        3,
        25,
        NULL,
        'medium',
        '{"icon": "📱", "category": "engagement"}'
    ),
    -- Desafíos Semanales
    (
        'Semana Productiva',
        'Completa 5 viajes esta semana',
        'weekly',
        'complete_rides',
        5,
        50,
        'weekly_warrior',
        'medium',
        '{"icon": "📅", "category": "rides"}'
    ),
    (
        'Crítico Constructivo',
        'Deja 3 valoraciones esta semana',
        'weekly',
        'get_reviews',
        3,
        40,
        'helpful_critic',
        'medium',
        '{"icon": "💬", "category": "reviews"}'
    ),
    (
        'Héroe Verde Semanal',
        'Ahorra 20kg de CO2 esta semana',
        'weekly',
        'save_co2',
        20,
        75,
        'eco_hero',
        'hard',
        '{"icon": "🌿", "category": "eco"}'
    ),
    (
        'Conductor Social',
        'Refiere 2 nuevos usuarios esta semana',
        'weekly',
        'refer_users',
        2,
        100,
        'social_butterfly',
        'hard',
        '{"icon": "👥", "category": "social"}'
    ),
    -- Desafíos Mensuales
    (
        'Maratón de Viajes',
        'Completa 20 viajes este mes',
        'monthly',
        'complete_rides',
        20,
        200,
        'monthly_marathoner',
        'hard',
        '{"icon": "🏃", "category": "rides"}'
    ),
    (
        'Maestro de las Valoraciones',
        'Deja 10 valoraciones este mes',
        'monthly',
        'get_reviews',
        10,
        150,
        'review_master',
        'hard',
        '{"icon": "📝", "category": "reviews"}'
    ),
    (
        'Guardián del Clima',
        'Ahorra 100kg de CO2 este mes',
        'monthly',
        'save_co2',
        100,
        300,
        'climate_guardian',
        'legendary',
        '{"icon": "🌍", "category": "eco"}'
    ),
    -- Desafíos Especiales
    (
        'Primer Paso',
        'Completa tu primer viaje',
        'special',
        'complete_achievements',
        1,
        50,
        'first_ride',
        'easy',
        '{"icon": "🎯", "category": "milestone", "one_time": true}'
    ),
    (
        'Reputación Inmaculada',
        'Consigue 5 valoraciones de 5 estrellas',
        'special',
        'get_reviews',
        5,
        100,
        'five_star',
        'hard',
        '{"icon": "⭐", "category": "reputation", "min_rating": 5}'
    ),
    (
        'Leyenda de la Carretera',
        'Alcanza el nivel 10',
        'special',
        'complete_achievements',
        1,
        500,
        'road_legend',
        'legendary',
        '{"icon": "👑", "category": "level", "target_level": 10}'
    ),
    (
        'Embajador Eco',
        'Refiere 10 usuarios activos',
        'special',
        'refer_users',
        10,
        1000,
        'eco_ambassador',
        'legendary',
        '{"icon": "🌟", "category": "social", "min_referrals": 10}'
    ),
    -- Desafíos de Rachas
    (
        'Racha de Oro',
        'Mantén una racha de 7 días',
        'special',
        'maintain_streak',
        7,
        100,
        'golden_streak',
        'medium',
        '{"icon": "🔥", "category": "streak", "streak_type": "daily_login"}'
    ),
    (
        'Racha Semanal Perfecta',
        'Viaja cada día de una semana',
        'special',
        'maintain_streak',
        7,
        150,
        'perfect_week',
        'hard',
        '{"icon": "📆", "category": "streak", "streak_type": "weekly_rides"}'
    ) ON CONFLICT DO NOTHING;
-- 2. Función para generar desafíos diarios automáticamente
DROP FUNCTION IF EXISTS public.generate_daily_challenges();
CREATE OR REPLACE FUNCTION public.generate_daily_challenges() RETURNS JSON AS $$
DECLARE v_date DATE := CURRENT_DATE;
v_challenge RECORD;
v_user_id UUID;
v_existing_progress INTEGER;
BEGIN -- Obtener desafíos diarios activos
FOR v_challenge IN
SELECT *
FROM public.challenges
WHERE type = 'daily'
    AND is_active = true LOOP -- Asignar desafío a usuarios activos (que usaron la app en los últimos 7 días)
    FOR v_user_id IN
SELECT DISTINCT user_id
FROM public.user_streaks
WHERE last_activity_date >= v_date - INTERVAL '7 days'
    AND streak_type = 'daily_login' LOOP -- Verificar si ya tiene progreso en este desafío hoy
SELECT COUNT(*) INTO v_existing_progress
FROM public.user_challenge_progress ucp
    JOIN public.challenges c ON c.id = ucp.challenge_id
WHERE ucp.user_id = v_user_id
    AND c.type = 'daily'
    AND DATE(ucp.started_at) = v_date
    AND c.id = v_challenge.id;
-- Si no tiene progreso, crearlo
IF v_existing_progress = 0 THEN
INSERT INTO public.user_challenge_progress (
        user_id,
        challenge_id,
        started_at
    )
VALUES (
        v_user_id,
        v_challenge.id,
        v_date::TIMESTAMPTZ
    );
END IF;
END LOOP;
END LOOP;
RETURN json_build_object('success', true, 'date', v_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Función para actualizar progreso de desafíos
DROP FUNCTION IF EXISTS public.update_challenge_progress(UUID, TEXT, INTEGER, JSONB);
CREATE OR REPLACE FUNCTION public.update_challenge_progress(
        p_user_id UUID,
        p_requirement_type TEXT,
        p_increment INTEGER DEFAULT 1,
        p_metadata JSONB DEFAULT '{}'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_updated_challenges JSONB := '[]'::jsonb;
v_challenge_progress RECORD;
v_completed_challenges INTEGER := 0;
BEGIN -- Actualizar todos los desafíos activos del usuario que coincidan con el tipo
FOR v_challenge_progress IN
SELECT ucp.id,
    ucp.challenge_id,
    ucp.current_progress,
    c.requirement_value,
    c.reward_points,
    c.reward_badge,
    c.name,
    ucp.is_completed
FROM public.user_challenge_progress ucp
    JOIN public.challenges c ON c.id = ucp.challenge_id
WHERE ucp.user_id = p_user_id
    AND c.requirement_type = p_requirement_type
    AND ucp.is_completed = false
    AND (
        c.end_date IS NULL
        OR c.end_date > NOW()
    )
    AND (
        c.start_date IS NULL
        OR c.start_date <= NOW()
    ) LOOP -- Actualizar progreso
UPDATE public.user_challenge_progress
SET current_progress = LEAST(
        current_progress + p_increment,
        requirement_value
    ),
    updated_at = NOW()
WHERE id = v_challenge_progress.id;
-- Verificar si se completó
IF (
    v_challenge_progress.current_progress + p_increment
) >= v_challenge_progress.requirement_value THEN -- Marcar como completado
UPDATE public.user_challenge_progress
SET is_completed = true,
    completed_at = NOW(),
    current_progress = requirement_value
WHERE id = v_challenge_progress.id;
-- Otorgar recompensas
PERFORM public.add_ecopoints(
    p_user_id,
    v_challenge_progress.reward_points,
    'challenge_completed',
    v_challenge_progress.challenge_id,
    'Desafío completado: ' || v_challenge_progress.name,
    json_build_object(
        'challenge_name',
        v_challenge_progress.name,
        'challenge_type',
        p_requirement_type,
        'metadata',
        p_metadata
    )
);
-- Otorgar badge si aplica
IF v_challenge_progress.reward_badge IS NOT NULL THEN PERFORM public.check_reputation_badges(p_user_id);
END IF;
-- Notificar completion
PERFORM public.create_notification(
    p_user_id,
    'badge_earned',
    '¡Desafío Completado!',
    'Has completado el desafío: ' || v_challenge_progress.name,
    json_build_object(
        'challenge_name',
        v_challenge_progress.name,
        'points_earned',
        v_challenge_progress.reward_points,
        'badge_earned',
        v_challenge_progress.reward_badge,
        'action_url',
        '/challenges'
    ),
    'normal',
    'social'
);
v_completed_challenges := v_completed_challenges + 1;
END IF;
-- Agregar a lista de actualizados
v_updated_challenges := v_updated_challenges || jsonb_build_object(
    'challenge_id',
    v_challenge_progress.challenge_id,
    'challenge_name',
    v_challenge_progress.name,
    'old_progress',
    v_challenge_progress.current_progress,
    'new_progress',
    LEAST(
        v_challenge_progress.current_progress + p_increment,
        v_challenge_progress.requirement_value
    ),
    'completed',
    (
        v_challenge_progress.current_progress + p_increment
    ) >= v_challenge_progress.requirement_value
);
END LOOP;
RETURN json_build_object(
    'success',
    true,
    'updated_challenges',
    v_updated_challenges,
    'completed_count',
    v_completed_challenges
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Función para obtener desafíos activos de un usuario
DROP FUNCTION IF EXISTS public.get_user_challenges(UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION public.get_user_challenges(
        p_user_id UUID,
        p_include_completed BOOLEAN DEFAULT FALSE
    ) RETURNS JSON AS $$
DECLARE v_challenges JSONB := '[]'::jsonb;
v_challenge RECORD;
BEGIN -- Obtener desafíos del usuario
FOR v_challenge IN
SELECT c.id,
    c.name,
    c.description,
    c.type,
    c.requirement_type,
    c.requirement_value,
    c.reward_points,
    c.reward_badge,
    c.difficulty,
    c.metadata,
    COALESCE(ucp.current_progress, 0) as current_progress,
    COALESCE(ucp.is_completed, false) as is_completed,
    ucp.completed_at,
    ucp.started_at,
    CASE
        WHEN ucp.is_completed THEN true
        WHEN c.end_date IS NOT NULL
        AND c.end_date < NOW() THEN false
        ELSE true
    END as is_active
FROM public.challenges c
    LEFT JOIN public.user_challenge_progress ucp ON (
        ucp.challenge_id = c.id
        AND ucp.user_id = p_user_id
        AND DATE(ucp.started_at) = CURRENT_DATE
    )
WHERE c.is_active = true
    AND (
        c.end_date IS NULL
        OR c.end_date >= NOW()
    )
    AND (
        c.start_date IS NULL
        OR c.start_date <= NOW()
    )
    AND (
        p_include_completed = true
        OR COALESCE(ucp.is_completed, false) = false
    )
ORDER BY CASE
        c.type
        WHEN 'daily' THEN 1
        WHEN 'weekly' THEN 2
        WHEN 'monthly' THEN 3
        ELSE 4
    END,
    c.difficulty,
    c.name LOOP v_challenges := v_challenges || jsonb_build_object(
        'id',
        v_challenge.id,
        'name',
        v_challenge.name,
        'description',
        v_challenge.description,
        'type',
        v_challenge.type,
        'requirement_type',
        v_challenge.requirement_type,
        'requirement_value',
        v_challenge.requirement_value,
        'reward_points',
        v_challenge.reward_points,
        'reward_badge',
        v_challenge.reward_badge,
        'difficulty',
        v_challenge.difficulty,
        'metadata',
        v_challenge.metadata,
        'current_progress',
        v_challenge.current_progress,
        'progress_percentage',
        ROUND(
            (
                v_challenge.current_progress::DECIMAL / v_challenge.requirement_value
            ) * 100,
            2
        ),
        'is_completed',
        v_challenge.is_completed,
        'completed_at',
        v_challenge.completed_at,
        'started_at',
        v_challenge.started_at,
        'is_active',
        v_challenge.is_active
    );
END LOOP;
RETURN json_build_object(
    'success',
    true,
    'challenges',
    v_challenges,
    'total_count',
    jsonb_array_length(v_challenges)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. Función para obtener leaderboard de gamificación
DROP FUNCTION IF EXISTS public.get_gamification_leaderboard(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.get_gamification_leaderboard(
        p_type TEXT DEFAULT 'points',
        -- 'points', 'level', 'streak'
        p_limit INTEGER DEFAULT 50
    ) RETURNS JSON AS $$
DECLARE v_leaderboard JSONB;
BEGIN CASE
    p_type
    WHEN 'points' THEN
    SELECT jsonb_agg(
            json_build_object(
                'user_id',
                ul.user_id,
                'display_name',
                p.display_name,
                'photo_url',
                p.photo_url,
                'available_points',
                balance.available_points,
                'total_earned',
                balance.total_earned,
                'level',
                ul.current_level,
                'rank',
                ROW_NUMBER() OVER (
                    ORDER BY balance.available_points DESC,
                        ul.total_xp DESC
                )
            )
        ) INTO v_leaderboard
    FROM public.user_levels ul
        JOIN public.profiles p ON p.id = ul.user_id
        CROSS JOIN LATERAL public.get_ecopoints_balance(ul.user_id) balance
    WHERE balance.available_points > 0
    ORDER BY balance.available_points DESC,
        ul.total_xp DESC
    LIMIT p_limit;
WHEN 'level' THEN
SELECT jsonb_agg(
        json_build_object(
            'user_id',
            ul.user_id,
            'display_name',
            p.display_name,
            'photo_url',
            p.photo_url,
            'current_level',
            ul.current_level,
            'total_xp',
            ul.total_xp,
            'level_up_at',
            ul.level_up_at,
            'rank',
            ROW_NUMBER() OVER (
                ORDER BY ul.current_level DESC,
                    ul.total_xp DESC
            )
        )
    ) INTO v_leaderboard
FROM public.user_levels ul
    JOIN public.profiles p ON p.id = ul.user_id
WHERE ul.current_level > 1
ORDER BY ul.current_level DESC,
    ul.total_xp DESC
LIMIT p_limit;
WHEN 'streak' THEN
SELECT jsonb_agg(
        json_build_object(
            'user_id',
            us.user_id,
            'display_name',
            p.display_name,
            'photo_url',
            p.photo_url,
            'current_streak',
            us.current_streak,
            'longest_streak',
            us.longest_streak,
            'streak_type',
            us.streak_type,
            'last_activity_date',
            us.last_activity_date,
            'rank',
            ROW_NUMBER() OVER (
                ORDER BY us.current_streak DESC,
                    us.longest_streak DESC
            )
        )
    ) INTO v_leaderboard
FROM public.user_streaks us
    JOIN public.profiles p ON p.id = us.user_id
WHERE us.current_streak > 1
    AND us.is_active = true
    AND us.streak_type = 'daily_login'
ORDER BY us.current_streak DESC,
    us.longest_streak DESC
LIMIT p_limit;
ELSE RAISE EXCEPTION 'Tipo de leaderboard inválido. Use: points, level, o streak';
END CASE
;
RETURN json_build_object(
    'success',
    true,
    'type',
    p_type,
    'leaderboard',
    COALESCE(v_leaderboard, '[]'::jsonb),
    'limit',
    p_limit
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. Función para obtener estadísticas de gamificación de un usuario
DROP FUNCTION IF EXISTS public.get_user_gamification_stats(UUID);
CREATE OR REPLACE FUNCTION public.get_user_gamification_stats(p_user_id UUID) RETURNS JSON AS $$
DECLARE v_points_balance JSONB;
v_user_level RECORD;
v_active_challenges INTEGER;
v_completed_challenges INTEGER;
v_current_streaks JSONB;
v_achievements JSONB;
BEGIN -- Balance de puntos
v_points_balance := public.get_ecopoints_balance(p_user_id);
-- Nivel actual
SELECT * INTO v_user_level
FROM public.user_levels
WHERE user_id = p_user_id;
-- Contador de desafíos
SELECT COUNT(
        CASE
            WHEN is_completed = false
            AND is_active = true THEN 1
        END
    ),
    COUNT(
        CASE
            WHEN is_completed = true THEN 1
        END
    ) INTO v_active_challenges,
    v_completed_challenges
FROM public.get_user_challenges(p_user_id, true) challenges,
    jsonb_array_elements(challenges.challenges) challenge
WHERE (challenge->>'is_completed')::BOOLEAN = true
    OR (challenge->>'is_active')::BOOLEAN = true;
-- Rachas actuales
SELECT jsonb_agg(
        json_build_object(
            'type',
            streak_type,
            'current',
            current_streak,
            'longest',
            longest_streak,
            'last_activity',
            last_activity_date
        )
    ) INTO v_current_streaks
FROM public.user_streaks
WHERE user_id = p_user_id
    AND is_active = true;
-- Logros (badges)
SELECT jsonb_agg(
        json_build_object(
            'badge_type',
            badge_type,
            'level',
            badge_level,
            'earned_at',
            earned_at
        )
    ) INTO v_achievements
FROM public.reputation_badges
WHERE user_id = p_user_id
    AND is_active = true
ORDER BY earned_at DESC
LIMIT 10;
RETURN json_build_object(
    'success',
    true,
    'points_balance',
    v_points_balance,
    'current_level',
    COALESCE(v_user_level.current_level, 1),
    'current_xp',
    COALESCE(v_user_level.current_xp, 0),
    'total_xp',
    COALESCE(v_user_level.total_xp, 0),
    'active_challenges',
    COALESCE(v_active_challenges, 0),
    'completed_challenges',
    COALESCE(v_completed_challenges, 0),
    'current_streaks',
    COALESCE(v_current_streaks, '[]'::jsonb),
    'recent_achievements',
    COALESCE(v_achievements, '[]'::jsonb),
    'total_rides',
    COALESCE(v_user_level.total_rides, 0),
    'total_reviews_given',
    COALESCE(v_user_level.total_reviews_given, 0),
    'total_reviews_received',
    COALESCE(v_user_level.total_reviews_received, 0),
    'total_co2_saved',
    COALESCE(v_user_level.total_co2_saved, 0)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 7. Job diario para resetear desafíos y generar nuevos
DROP FUNCTION IF EXISTS public.daily_challenge_reset();
CREATE OR REPLACE FUNCTION public.daily_challenge_reset() RETURNS JSON AS $$
DECLARE v_reset_count INTEGER := 0;
v_generated_count INTEGER := 0;
v_result JSON;
BEGIN -- Resetear desafíos diarios no completados
UPDATE public.user_challenge_progress
SET is_completed = false,
    current_progress = 0,
    updated_at = NOW()
WHERE challenge_id IN (
        SELECT id
        FROM public.challenges
        WHERE type = 'daily'
    )
    AND is_completed = false
    AND DATE(started_at) < CURRENT_DATE;
GET DIAGNOSTICS v_reset_count = ROW_COUNT;
-- Generar nuevos desafíos diarios
v_result := public.generate_daily_challenges();
v_generated_count := (
    SELECT COUNT(*)
    FROM public.user_challenge_progress
    WHERE DATE(started_at) = CURRENT_DATE
        AND challenge_id IN (
            SELECT id
            FROM public.challenges
            WHERE type = 'daily'
        )
);
-- Limpiar desafíos expirados
DELETE FROM public.user_challenge_progress
WHERE challenge_id IN (
        SELECT id
        FROM public.challenges
        WHERE end_date < NOW()
    );
RETURN json_build_object(
    'success',
    true,
    'date',
    CURRENT_DATE,
    'reset_count',
    v_reset_count,
    'generated_count',
    v_generated_count,
    'executed_at',
    NOW()
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Comentarios para auditoría
COMMENT ON FUNCTION public.generate_daily_challenges() IS 'Genera desafíos diarios para usuarios activos';
COMMENT ON FUNCTION public.update_challenge_progress(UUID, TEXT, INTEGER, JSONB) IS 'Actualiza progreso de desafíos y otorga recompensas';
COMMENT ON FUNCTION public.get_user_challenges(UUID, BOOLEAN) IS 'Obtiene desafíos activos de un usuario con progreso';
COMMENT ON FUNCTION public.get_gamification_leaderboard(TEXT, INTEGER) IS 'Leaderboard de puntos, niveles y rachas';
COMMENT ON FUNCTION public.get_user_gamification_stats(UUID) IS 'Estadísticas completas de gamificación de un usuario';
COMMENT ON FUNCTION public.daily_challenge_reset() IS 'Job diario para resetear y generar desafíos';