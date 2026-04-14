-- ========================================================
-- MIGRACIÓN: FINAL SYNC V3 (Nivelación de Esquema y Feed) - REPARADA
-- Objetivo: Resolver ambigüedad de columnas y asegurar visibilidad
-- ========================================================
-- 1. Asegurar columnas de Gamificación en PROFILES
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'eco_tier'
) THEN
ALTER TABLE public.profiles
ADD COLUMN eco_tier TEXT DEFAULT 'Seed';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'eco_points'
) THEN
ALTER TABLE public.profiles
ADD COLUMN eco_points INTEGER DEFAULT 0;
END IF;
END $$;
-- 2. Redefinir Feed Global con referencias calificadas (Anti-ambigüedad)
DROP FUNCTION IF EXISTS public.get_available_rides_v2();
CREATE OR REPLACE FUNCTION public.get_available_rides_v2() RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_verified TEXT,
        driver_eco_tier TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        details TEXT,
        is_women_only BOOLEAN,
        distance DECIMAL,
        status TEXT
    ) AS $$
DECLARE v_searcher_id UUID;
DECLARE v_searcher_gender TEXT;
BEGIN v_searcher_id := auth.uid();
-- FASE FIX: Calificar 'profiles.id' para evitar ambigüedad con el output 'id'
IF v_searcher_id IS NOT NULL THEN
SELECT p.gender INTO v_searcher_gender
FROM public.profiles p
WHERE p.id = v_searcher_id;
END IF;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(prof.rating, 0.0)::DECIMAL,
    (prof.verification->>'status')::TEXT as driver_verified,
    prof.eco_tier,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.details,
    r.is_women_only,
    r.distance,
    r.status
FROM public.rides r
    JOIN public.profiles prof ON r.driver_id = prof.id
WHERE -- VISIBILIDAD: Programados (futuros) o Activos (en curso)
    (
        (
            r.status = 'scheduled'
            AND r.departure_time > NOW() - INTERVAL '30 minutes'
        )
        OR (r.status IN ('active', 'in_progress'))
    )
    AND r.seats_available > 0 -- No mostrar mis propios viajes en el feed de exploración
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY r.departure_time ASC;
END;
$$ LANGUAGE plpgsql STABLE;