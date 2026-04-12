-- ========================================================
-- SISTEMA DE RATING Y REVIEWS COMPLETO
-- Implementación robusta con validaciones anti-abuso
-- ========================================================
-- 1. Tabla de reviews/valoraciones
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reviewee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (
        rating >= 1
        AND rating <= 5
    ),
    comment TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Constraints para prevenir duplicados y auto-valoración
    UNIQUE(ride_id, reviewer_id, reviewee_id),
    CHECK (reviewer_id != reviewee_id) -- Prevenir auto-valoración
);
-- 2. Tabla de estadísticas de rating por usuario
CREATE TABLE IF NOT EXISTS public.user_rating_stats (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    total_reviews INTEGER DEFAULT 0,
    average_rating DECIMAL(3, 2) DEFAULT 0.00,
    rating_1_count INTEGER DEFAULT 0,
    rating_2_count INTEGER DEFAULT 0,
    rating_3_count INTEGER DEFAULT 0,
    rating_4_count INTEGER DEFAULT 0,
    rating_5_count INTEGER DEFAULT 0,
    last_review_date TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 3. Tabla de badges de reputación
CREATE TABLE IF NOT EXISTS public.reputation_badges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    badge_type TEXT NOT NULL CHECK (
        badge_type IN (
            'new_driver',
            'experienced_driver',
            'top_driver',
            'new_passenger',
            'frequent_passenger',
            'top_passenger',
            'five_star_driver',
            'five_star_passenger',
            'eco_warrior',
            'community_hero',
            'helpful_member'
        )
    ),
    badge_level INTEGER DEFAULT 1 CHECK (
        badge_level >= 1
        AND badge_level <= 5
    ),
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    -- Algunos badges expiran
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE(user_id, badge_type)
);
-- 4. Índices para performance
CREATE INDEX IF NOT EXISTS idx_reviews_ride_id ON public.reviews(ride_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON public.reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id ON public.reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON public.reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON public.reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reputation_badges_user_id ON public.reputation_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_reputation_badges_type ON public.reputation_badges(badge_type);
CREATE INDEX IF NOT EXISTS idx_reputation_badges_active ON public.reputation_badges(is_active);
-- 5. Función para calcular rating promedio de un usuario
DROP FUNCTION IF EXISTS public.calculate_user_rating(UUID);
CREATE OR REPLACE FUNCTION public.calculate_user_rating(p_user_id UUID) RETURNS DECIMAL(3, 2) AS $$
DECLARE v_avg_rating DECIMAL(3, 2);
v_total_reviews INTEGER;
BEGIN -- Calcular rating promedio como reviewee (recibió valoraciones)
SELECT COALESCE(AVG(rating), 0),
    COUNT(*) INTO v_avg_rating,
    v_total_reviews
FROM public.reviews
WHERE reviewee_id = p_user_id
    AND created_at > NOW() - INTERVAL '12 months';
-- Solo últimos 12 meses
-- Actualizar estadísticas del usuario
INSERT INTO public.user_rating_stats (
        user_id,
        total_reviews,
        average_rating,
        rating_1_count,
        rating_2_count,
        rating_3_count,
        rating_4_count,
        rating_5_count,
        last_review_date
    )
SELECT p_user_id,
    v_total_reviews,
    v_avg_rating,
    COUNT(
        CASE
            WHEN rating = 1 THEN 1
        END
    ),
    COUNT(
        CASE
            WHEN rating = 2 THEN 1
        END
    ),
    COUNT(
        CASE
            WHEN rating = 3 THEN 1
        END
    ),
    COUNT(
        CASE
            WHEN rating = 4 THEN 1
        END
    ),
    COUNT(
        CASE
            WHEN rating = 5 THEN 1
        END
    ),
    MAX(created_at)
FROM public.reviews
WHERE reviewee_id = p_user_id
    AND created_at > NOW() - INTERVAL '12 months' ON CONFLICT (user_id) DO
UPDATE
SET total_reviews = EXCLUDED.total_reviews,
    average_rating = EXCLUDED.average_rating,
    rating_1_count = EXCLUDED.rating_1_count,
    rating_2_count = EXCLUDED.rating_2_count,
    rating_3_count = EXCLUDED.rating_3_count,
    rating_4_count = EXCLUDED.rating_4_count,
    rating_5_count = EXCLUDED.rating_5_count,
    last_review_date = EXCLUDED.last_review_date,
    updated_at = NOW();
RETURN v_avg_rating;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. Función robusta para submit reviews
DROP FUNCTION IF EXISTS public.submit_review_secure(UUID, UUID, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.submit_review_secure(
        p_ride_id UUID,
        p_reviewee_id UUID,
        p_rating INTEGER,
        p_comment TEXT DEFAULT ''
    ) RETURNS JSON AS $$
DECLARE v_reviewer_id UUID := auth.uid();
v_ride_status TEXT;
v_ride_driver_id UUID;
v_ride_passengers JSONB;
v_is_passenger BOOLEAN := FALSE;
v_is_driver BOOLEAN := FALSE;
v_existing_review BOOLEAN;
v_days_since_ride INTEGER;
v_new_review_id UUID;
BEGIN -- Validaciones básicas
IF v_reviewer_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_reviewee_id = v_reviewer_id THEN RAISE EXCEPTION 'No puedes valorarte a ti mismo';
END IF;
IF p_rating < 1
OR p_rating > 5 THEN RAISE EXCEPTION 'El rating debe estar entre 1 y 5';
END IF;
-- Validar longitud del comentario
IF LENGTH(p_comment) > 500 THEN RAISE EXCEPTION 'El comentario no puede exceder 500 caracteres';
END IF;
-- Obtener información del ride
SELECT status,
    driver_id,
    passengers INTO v_ride_status,
    v_ride_driver_id,
    v_ride_passengers
FROM public.rides
WHERE id = p_ride_id;
IF v_ride_status IS NULL THEN RAISE EXCEPTION 'Viaje no encontrado';
END IF;
-- Validar que el viaje esté completado
IF v_ride_status NOT IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'Solo puedes valorar viajes completados o cancelados';
END IF;
-- Verificar que el reviewee participó en el viaje
IF p_reviewee_id = v_ride_driver_id THEN v_is_driver := TRUE;
ELSE -- Verificar si es pasajero
SELECT EXISTS(
        SELECT 1
        FROM jsonb_array_elements(v_ride_passengers) AS p
        WHERE (p->>'id')::UUID = p_reviewee_id
    ) INTO v_is_passenger;
IF NOT v_is_passenger THEN RAISE EXCEPTION 'El usuario valorado no participó en este viaje';
END IF;
END IF;
-- Verificar que el reviewer participó en el viaje
IF v_reviewer_id = v_ride_driver_id THEN -- El conductor puede valorar a pasajeros
NULL;
ELSE -- Verificar si es pasajero
SELECT EXISTS(
        SELECT 1
        FROM jsonb_array_elements(v_ride_passengers) AS p
        WHERE (p->>'id')::UUID = v_reviewer_id
    ) INTO v_is_passenger;
IF NOT v_is_passenger THEN RAISE EXCEPTION 'No participaste en este viaje';
END IF;
END IF;
-- Validar tiempo máximo para valorar (30 días)
SELECT EXTRACT(
        DAYS
        FROM NOW() - MAX(created_at)
    )::INTEGER INTO v_days_since_ride
FROM public.rides
WHERE id = p_ride_id
    AND status = 'completed';
IF v_days_since_ride > 30 THEN RAISE EXCEPTION 'Solo puedes valorar viajes de los últimos 30 días';
END IF;
-- Verificar que no exista ya una review
SELECT EXISTS(
        SELECT 1
        FROM public.reviews
        WHERE ride_id = p_ride_id
            AND reviewer_id = v_reviewer_id
            AND reviewee_id = p_reviewee_id
    ) INTO v_existing_review;
IF v_existing_review THEN RAISE EXCEPTION 'Ya has valorado a este usuario para este viaje';
END IF;
-- Rate limiting para reviews (máximo 10 por día)
IF NOT public.check_rate_limit('submit_review', 1440, 10) THEN RAISE EXCEPTION 'Has alcanzado el límite de 10 valoraciones por día';
END IF;
-- Insertar la review
INSERT INTO public.reviews (
        ride_id,
        reviewer_id,
        reviewee_id,
        rating,
        comment
    )
VALUES (
        p_ride_id,
        v_reviewer_id,
        p_reviewee_id,
        p_rating,
        TRIM(p_comment)
    )
RETURNING id INTO v_new_review_id;
-- Actualizar rating promedio del reviewee
PERFORM public.calculate_user_rating(p_reviewee_id);
-- Otorgar EcoPoints por valorar (10 puntos)
PERFORM public.add_ecopoints(
    v_reviewer_id,
    10,
    'review_submitted',
    json_build_object(
        'review_id',
        v_new_review_id,
        'ride_id',
        p_ride_id
    )
);
-- Verificar y otorgar badges de reputación
PERFORM public.check_reputation_badges(p_reviewee_id);
-- Registrar en auditoría
PERFORM public.log_admin_action(
    'review_submitted',
    json_build_object(
        'ride_id',
        p_ride_id,
        'reviewer_id',
        v_reviewer_id,
        'reviewee_id',
        p_reviewee_id,
        'rating',
        p_rating
    ),
    p_reviewee_id
);
RETURN json_build_object(
    'success',
    true,
    'review_id',
    v_new_review_id,
    'message',
    'Valoración guardada exitosamente'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 7. Función para obtener rating de un usuario
DROP FUNCTION IF EXISTS public.get_user_rating(UUID);
CREATE OR REPLACE FUNCTION public.get_user_rating(p_user_id UUID) RETURNS JSON AS $$
DECLARE v_stats RECORD;
v_badges JSONB;
BEGIN -- Obtener estadísticas de rating
SELECT * INTO v_stats
FROM public.user_rating_stats
WHERE user_id = p_user_id;
-- Obtener badges activos
SELECT jsonb_agg(
        jsonb_build_object(
            'type',
            badge_type,
            'level',
            badge_level,
            'earned_at',
            earned_at
        )
    ) INTO v_badges
FROM public.reputation_badges
WHERE user_id = p_user_id
    AND is_active = TRUE
    AND (
        expires_at IS NULL
        OR expires_at > NOW()
    );
RETURN json_build_object(
    'user_id',
    p_user_id,
    'average_rating',
    COALESCE(v_stats.average_rating, 0),
    'total_reviews',
    COALESCE(v_stats.total_reviews, 0),
    'rating_distribution',
    json_build_object(
        '1',
        COALESCE(v_stats.rating_1_count, 0),
        '2',
        COALESCE(v_stats.rating_2_count, 0),
        '3',
        COALESCE(v_stats.rating_3_count, 0),
        '4',
        COALESCE(v_stats.rating_4_count, 0),
        '5',
        COALESCE(v_stats.rating_5_count, 0)
    ),
    'badges',
    COALESCE(v_badges, '[]'::jsonb),
    'last_review_date',
    v_stats.last_review_date
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Comentarios para auditoría
COMMENT ON TABLE public.reviews IS 'Valoraciones de usuarios con validaciones anti-abuso';
COMMENT ON TABLE public.user_rating_stats IS 'Estadísticas de rating por usuario';
COMMENT ON TABLE public.reputation_badges IS 'Badges de reputación basados en rendimiento';
COMMENT ON FUNCTION public.submit_review_secure IS 'Función segura para submit reviews con todas las validaciones';
COMMENT ON FUNCTION public.calculate_user_rating IS 'Calcula y actualiza rating promedio de usuario';