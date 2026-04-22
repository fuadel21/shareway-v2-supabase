-- ==============================================================================
-- PROFILE SECURITY AND TRUST: BLINDAJE Y MEJORA DE CREDIBILIDAD
-- ==============================================================================

-- 1. Añadimos campo de Trust Score para usuarios nuevos (0 a 100)
-- Se basa en verificaciones, no solo en viajes.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 20;

-- 2. REFACTOR: get_public_profile con filtros de seguridad
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_profile RECORD;
    v_is_suspended BOOLEAN;
BEGIN
    -- A. Verificar si el usuario está suspendido
    SELECT is_suspended INTO v_is_suspended FROM public.profiles WHERE id = p_user_id;

    IF v_is_suspended THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'USER_SUSPENDED',
            'message', 'Este perfil no está disponible temporalmente.'
        );
    END IF;

    -- B. Obtener datos con cálculo de confianza dinámico
    SELECT
        id, display_name, photo_url, avatar_url, bio, rating, review_count,
        rides_count, total_co2_saved, eco_points, eco_tier,
        (verification->>'status') as v_status,
        (verification->>'identity_verified')::BOOLEAN as id_ver,
        (verification->>'phone_verified')::BOOLEAN as phone_ver,
        (verification->>'email_verified')::BOOLEAN as email_ver,
        created_at, vehicle, trust_score
    INTO v_profile
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_profile.id,
            'display_name', v_profile.display_name,
            'photo_url', COALESCE(v_profile.photo_url, v_profile.avatar_url),
            'bio', v_profile.bio,
            'rating', COALESCE(v_profile.rating, 5.0),
            'review_count', COALESCE(v_profile.review_count, 0),
            'rides_count', COALESCE(v_profile.rides_count, 0),
            'total_co2_saved', COALESCE(v_profile.total_co2_saved, 0),
            'eco_tier', v_profile.eco_tier,
            'trust_score', v_profile.trust_score,
            'created_at', v_profile.created_at,
            'verifications', jsonb_build_object(
                'status', v_profile.v_status,
                'identity', COALESCE(v_profile.id_ver, false),
                'phone', COALESCE(v_profile.phone_ver, false),
                'email', COALESCE(v_profile.email_ver, false)
            ),
            'vehicle', CASE
                WHEN v_profile.vehicle IS NOT NULL AND v_profile.vehicle != '{}'::jsonb
                THEN v_profile.vehicle
                ELSE NULL
            END
        )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. Trigger para actualizar Trust Score automáticamente
CREATE OR REPLACE FUNCTION public.update_trust_score()
RETURNS TRIGGER AS $$
DECLARE
    v_score INTEGER := 20; -- Base
BEGIN
    -- +20 por Email
    IF (NEW.verification->>'email_verified')::BOOLEAN THEN v_score := v_score + 20; END IF;
    -- +20 por Teléfono
    IF (NEW.verification->>'phone_verified')::BOOLEAN THEN v_score := v_score + 20; END IF;
    -- +40 por DNI/Identidad
    IF (NEW.verification->>'identity_verified')::BOOLEAN THEN v_score := v_score + 40; END IF;

    -- Los viajes y reviews se suman en otros triggers, aquí solo verificaciones base
    NEW.trust_score := v_score;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_profile_verify_update ON public.profiles;
CREATE TRIGGER on_profile_verify_update
    BEFORE UPDATE OF verification ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_trust_score();
