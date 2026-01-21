-- ==========================================
-- MIGRATION: FIX_REVIEW_COUNT
-- Ensures the column is named 'review_count' as expected by the application
-- ==========================================
DO $$ BEGIN -- 1. Check if column 'reviews_count' exists and rename it to 'review_count'
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'reviews_count'
) THEN
ALTER TABLE public.profiles
    RENAME COLUMN reviews_count TO review_count;
RAISE NOTICE 'Column reviews_count renamed to review_count in profiles table.';
END IF;
-- 2. Ensure review_count exists (if neither exists somehow)
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'review_count'
) THEN
ALTER TABLE public.profiles
ADD COLUMN review_count INTEGER DEFAULT 0;
RAISE NOTICE 'Column review_count added to profiles table.';
END IF;
END $$;
-- 3. Re-sync the get_public_profile function to be absolutely sure it uses the correct column
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID) RETURNS JSON AS $$
DECLARE v_profile JSONB;
BEGIN
SELECT jsonb_build_object(
        'id',
        id,
        'display_name',
        display_name,
        'photo_url',
        photo_url,
        'avatar_url',
        avatar_url,
        'bio',
        bio,
        'rating',
        rating,
        'review_count',
        review_count,
        'rides_count',
        rides_count,
        'total_co2_saved',
        total_co2_saved,
        'eco_points',
        COALESCE(eco_points, 0),
        'eco_tier',
        COALESCE(eco_tier, 'Seed'),
        'verification_status',
        (verification->>'status'),
        'created_at',
        created_at,
        'vehicle',
        CASE
            WHEN vehicle IS NOT NULL
            AND vehicle != '{}'::jsonb THEN jsonb_build_object(
                'make',
                vehicle->>'make',
                'model',
                vehicle->>'model',
                'color',
                vehicle->>'color',
                'fuel_type',
                vehicle->>'fuel_type'
            )
            ELSE NULL
        END
    ) INTO v_profile
FROM public.profiles
WHERE id = p_user_id;
IF v_profile IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado';
END IF;
RETURN v_profile;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 4. Re-sync the search_rides_v2 as it also uses review_count (via alias)
-- (Actually used p.rating but good to have consistency)