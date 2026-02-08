-- ========================================================
-- SISTEMA DE BADGES Y REPUTACIÓN
-- Gamificación basada en rendimiento real
-- ========================================================

-- 1. Función para verificar y otorgar badges automáticamente
CREATE OR REPLACE FUNCTION public.check_reputation_badges(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_stats RECORD;
    v_ride_count INTEGER;
    v_review_count INTEGER;
    v_avg_rating DECIMAL(3,2);
    v_co2_saved DECIMAL;
    v_new_badges TEXT [];
    v_badge_record RECORD;
BEGIN
    -- Obtener estadísticas del usuario
    SELECT * INTO v_stats
    FROM public.user_rating_stats
    WHERE user_id = p_user_id;
    
    -- Obtener métricas adicionales
    SELECT COUNT(*) INTO v_ride_count
    FROM public.rides
    WHERE driver_id = p_user_id
        AND status = 'completed';
    
    SELECT COUNT(*) INTO v_review_count
    FROM public.reviews
    WHERE reviewee_id = p_user_id;
    
    SELECT COALESCE(total_co2_saved, 0) INTO v_co2_saved
    FROM public.profiles
    WHERE id = p_user_id;
    
    v_avg_rating := COALESCE(v_stats.average_rating, 0);
    
    -- Badge: Nuevo Conductor (primer viaje completado)
    IF v_ride_count >= 1 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'new_driver'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'new_driver', 1, json_build_object('first_ride_date', NOW()));
        v_new_badges := array_append(v_new_badges, 'new_driver');
    END IF;
    
    -- Badge: Conductor Experimentado (10+ viajes)
    IF v_ride_count >= 10 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'experienced_driver'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'experienced_driver', 1, json_build_object('total_rides', v_ride_count));
        v_new_badges := array_append(v_new_badges, 'experienced_driver');
    END IF;
    
    -- Badge: Top Conductor (50+ viajes y rating >= 4.5)
    IF v_ride_count >= 50 AND v_avg_rating >= 4.5 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'top_driver'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'top_driver', 1, json_build_object(
            'total_rides', v_ride_count,
            'average_rating', v_avg_rating
        ));
        v_new_badges := array_append(v_new_badges, 'top_driver');
    END IF;
    
    -- Badge: 5 Estrellas (rating >= 4.8 con 10+ reviews)
    IF v_avg_rating >= 4.8 AND v_review_count >= 10 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'five_star_driver'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'five_star_driver', 1, json_build_object(
            'average_rating', v_avg_rating,
            'total_reviews', v_review_count
        ));
        v_new_badges := array_append(v_new_badges, 'five_star_driver');
    END IF;
    
    -- Badge: Eco Warrior (10+ kg CO2 ahorrado)
    IF v_co2_saved >= 10 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'eco_warrior'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'eco_warrior', 1, json_build_object('co2_saved', v_co2_saved));
        v_new_badges := array_append(v_new_badges, 'eco_warrior');
    END IF;
    
    -- Badge: Community Hero (20+ reviews dados)
    SELECT COUNT(*) INTO v_review_count
    FROM public.reviews
    WHERE reviewer_id = p_user_id;
    
    IF v_review_count >= 20 AND NOT EXISTS(
        SELECT 1 FROM public.reputation_badges 
        WHERE user_id = p_user_id AND badge_type = 'community_hero'
    ) THEN
        INSERT INTO public.reputation_badges (user_id, badge_type, badge_level, metadata)
        VALUES (p_user_id, 'community_hero', 1, json_build_object('reviews_given', v_review_count));
        v_new_badges := array_append(v_new_badges, 'community_hero');
    END IF;
    
    -- Actualizar niveles de badges existentes
    FOR v_badge_record IN
        SELECT * FROM public.reputation_badges
        WHERE user_id = p_user_id
            AND badge_type IN ('experienced_driver', 'top_driver', 'eco_warrior')
    LOOP
        -- Incrementar nivel basado en métricas
        IF v_badge_record.badge_type = 'experienced_driver' AND v_ride_count >= v_badge_record.badge_level * 10 THEN
            UPDATE public.reputation_badges
            SET badge_level = v_badge_record.badge_level + 1,
                updated_at = NOW()
            WHERE id = v_badge_record.id;
        ELSIF v_badge_record.badge_type = 'eco_warrior' AND v_co2_saved >= v_badge_record.badge_level * 10 THEN
            UPDATE public.reputation_badges
            SET badge_level = v_badge_record.badge_level + 1,
                updated_at = NOW()
            WHERE id = v_badge_record.id;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'new_badges', v_new_badges,
        'total_new', array_length(v_new_badges, 1)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Función para obtener leaderboard de rating
CREATE OR REPLACE FUNCTION public.get_rating_leaderboard(
    p_limit INTEGER DEFAULT 50,
    p_filter TEXT DEFAULT 'all' -- 'all', 'drivers', 'passengers'
) RETURNS JSON AS $$
DECLARE
    v_leaderboard JSONB;
BEGIN
    CASE p_filter
        WHEN 'drivers' THEN
            SELECT jsonb_agg(
                json_build_object(
                    'user_id', urs.user_id,
                    'average_rating', urs.average_rating,
                    'total_reviews', urs.total_reviews,
                    'ride_count', COALESCE(rc.ride_count, 0),
                    'display_name', p.display_name,
                    'photo_url', p.photo_url
                )
            ) INTO v_leaderboard
            FROM public.user_rating_stats urs
            JOIN public.profiles p ON p.id = urs.user_id
            LEFT JOIN (
                SELECT driver_id, COUNT(*) as ride_count
                FROM public.rides
                WHERE status = 'completed'
                GROUP BY driver_id
            ) rc ON rc.driver_id = urs.user_id
            WHERE urs.total_reviews >= 5 -- Mínimo 5 reviews para aparecer
                AND rc.ride_count >= 1 -- Al menos un viaje como conductor
            ORDER BY urs.average_rating DESC, urs.total_reviews DESC
            LIMIT p_limit;
            
        WHEN 'passengers' THEN
            SELECT jsonb_agg(
                json_build_object(
                    'user_id', urs.user_id,
                    'average_rating', urs.average_rating,
                    'total_reviews', urs.total_reviews,
                    'trip_count', COALESCE(tc.trip_count, 0),
                    'display_name', p.display_name,
                    'photo_url', p.photo_url
                )
            ) INTO v_leaderboard
            FROM public.user_rating_stats urs
            JOIN public.profiles p ON p.id = urs.user_id
            LEFT JOIN (
                SELECT 
                    (p->>'id')::UUID as passenger_id,
                    COUNT(*) as trip_count
                FROM public.rides r,
                jsonb_array_elements(r.passengers) p
                WHERE r.status = 'completed'
                GROUP BY (p->>'id')::UUID
            ) tc ON tc.passenger_id = urs.user_id
            WHERE urs.total_reviews >= 5
                AND tc.trip_count >= 1
            ORDER BY urs.average_rating DESC, urs.total_reviews DESC
            LIMIT p_limit;
            
        ELSE -- 'all'
            SELECT jsonb_agg(
                json_build_object(
                    'user_id', urs.user_id,
                    'average_rating', urs.average_rating,
                    'total_reviews', urs.total_reviews,
                    'display_name', p.display_name,
                    'photo_url', p.photo_url
                )
            ) INTO v_leaderboard
            FROM public.user_rating_stats urs
            JOIN public.profiles p ON p.id = urs.user_id
            WHERE urs.total_reviews >= 5
            ORDER BY urs.average_rating DESC, urs.total_reviews DESC
            LIMIT p_limit;
    END CASE;
    
    RETURN json_build_object(
        'success', true,
        'leaderboard', COALESCE(v_leaderboard, '[]'::jsonb),
        'filter', p_filter,
        'limit', p_limit
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Función para obtener reviews de un usuario
CREATE OR REPLACE FUNCTION public.get_user_reviews(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
) RETURNS JSON AS $$
DECLARE
    v_reviews JSONB;
    v_total_count INTEGER;
BEGIN
    -- Obtener reviews recibidas (como reviewee)
    SELECT jsonb_agg(
        json_build_object(
            'review_id', r.id,
            'ride_id', r.ride_id,
            'rating', r.rating,
            'comment', r.comment,
            'created_at', r.created_at,
            'reviewer', json_build_object(
                'id', p_rev.id,
                'display_name', p_rev.display_name,
                'photo_url', p_rev.photo_url
            )
        )
    ) INTO v_reviews
    FROM public.reviews r
    JOIN public.profiles p_rev ON p_rev.id = r.reviewer_id
    WHERE r.reviewee_id = p_user_id
    ORDER BY r.created_at DESC
    LIMIT p_limit OFFSET p_offset;
    
    -- Contar total
    SELECT COUNT(*) INTO v_total_count
    FROM public.reviews
    WHERE reviewee_id = p_user_id;
    
    RETURN json_build_object(
        'success', true,
        'reviews', COALESCE(v_reviews, '[]'::jsonb),
        'pagination', json_build_object(
            'limit', p_limit,
            'offset', p_offset,
            'total', v_total_count,
            'has_more', (p_offset + p_limit) < v_total_count
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Función para obtener usuarios destacados
CREATE OR REPLACE FUNCTION public.get_featured_users()
RETURNS JSON AS $$
DECLARE
    v_featured JSONB;
BEGIN
    -- Usuarios con mejor rating (mínimo 10 reviews)
    SELECT jsonb_agg(
        json_build_object(
            'user_id', urs.user_id,
            'display_name', p.display_name,
            'photo_url', p.photo_url,
            'average_rating', urs.average_rating,
            'total_reviews', urs.total_reviews,
            'badges', (
                SELECT jsonb_agg(badge_type)
                FROM public.reputation_badges
                WHERE user_id = urs.user_id AND is_active = TRUE
            )
        )
    ) INTO v_featured
    FROM public.user_rating_stats urs
    JOIN public.profiles p ON p.id = urs.user_id
    WHERE urs.total_reviews >= 10
        AND urs.average_rating >= 4.5
    ORDER BY urs.average_rating DESC, urs.total_reviews DESC
    LIMIT 10;
    
    RETURN json_build_object(
        'success', true,
        'featured_users', COALESCE(v_featured, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Trigger automático para actualizar badges después de reviews
CREATE OR REPLACE FUNCTION public.auto_update_badges_after_review()
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar badges del reviewee (quien recibió la valoración)
    PERFORM public.check_reputation_badges(NEW.reviewee_id);
    
    -- También actualizar badges del reviewer (quien dio la valoración)
    -- para badges como "Community Hero"
    PERFORM public.check_reputation_badges(NEW.reviewer_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Crear trigger
DROP TRIGGER IF EXISTS trigger_update_badges_after_review ON public.reviews;
CREATE TRIGGER trigger_update_badges_after_review
    AFTER INSERT ON public.reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_update_badges_after_review();

-- 7. Vista para estadísticas de rating de la plataforma
CREATE OR REPLACE VIEW public.platform_rating_stats AS
SELECT 
    COUNT(*) as total_reviews,
    AVG(rating) as platform_average_rating,
    COUNT(DISTINCT reviewee_id) as users_with_reviews,
    COUNT(DISTINCT reviewer_id) as users_who_reviewed,
    COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star_reviews,
    COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star_reviews,
    ROUND(
        COUNT(CASE WHEN rating >= 4 THEN 1 END) * 100.0 / COUNT(*), 
        2
    ) as positive_review_percentage
FROM public.reviews
WHERE created_at > NOW() - INTERVAL '30 days';

-- Comentarios para auditoría
COMMENT ON FUNCTION public.check_reputation_badges IS 'Verifica y otorga badges automáticamente basados en métricas';
COMMENT ON FUNCTION public.get_rating_leaderboard IS 'Obtiene ranking de usuarios por rating';
COMMENT ON FUNCTION public.get_user_reviews IS 'Obtiene reviews recibidas por un usuario';
COMMENT ON FUNCTION public.get_featured_users IS 'Obtiene usuarios destacados por rating';
COMMENT ON VIEW public.platform_rating_stats IS 'Estadísticas de rating de toda la plataforma';
