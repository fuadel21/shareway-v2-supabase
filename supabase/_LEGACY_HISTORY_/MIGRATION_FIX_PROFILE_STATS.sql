-- ========================================================
-- MIGRACIÓN: FIX PROFILE STATS columns
-- Objetivo: Asegurar que existan las columnas de estadísticas en profiles
-- ========================================================

DO $$ 
BEGIN 
    -- 1. Añadir columna rides_count si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rides_count') THEN
        ALTER TABLE public.profiles ADD COLUMN rides_count INTEGER DEFAULT 0;
    END IF;

    -- 2. Añadir columna total_co2_saved si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='total_co2_saved') THEN
        ALTER TABLE public.profiles ADD COLUMN total_co2_saved DECIMAL DEFAULT 0;
    END IF;

    -- 3. Añadir columna eco_points si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='eco_points') THEN
        ALTER TABLE public.profiles ADD COLUMN eco_points INTEGER DEFAULT 0;
    END IF;

    -- 4. Añadir columna rating_sum si no existe (para el cálculo de media)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rating_sum') THEN
        ALTER TABLE public.profiles ADD COLUMN rating_sum INTEGER DEFAULT 0;
    END IF;

    -- 5. Añadir columna rating_count si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rating_count') THEN
        ALTER TABLE public.profiles ADD COLUMN rating_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Actualizar la función de perfil público para asegurar que devuelve estos campos
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID) 
RETURNS JSON AS $$
DECLARE
    v_profile RECORD;
BEGIN
    SELECT 
        p.id,
        p.display_name,
        p.photo_url,
        p.avatar_url,
        p.bio,
        p.created_at,
        p.rides_count,
        p.total_co2_saved,
        p.eco_points,
        p.verification->>'status' as verification_status,
        p.vehicle,
        COALESCE(p.rating, 5.0) as rating
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_user_id;

    IF v_profile.id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN row_to_json(v_profile);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
