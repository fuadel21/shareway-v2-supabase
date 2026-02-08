-- ==========================================
-- FIX: fetch_my_activity_v1 - Include cancelled rides in history
-- Fecha: 2026-02-07
-- Descripción: Crear función para obtener TODOS los viajes del usuario
--              incluyendo cancelados, completados y expirados
-- ==========================================
-- Drop existing function if it exists (handles different return types)
DROP FUNCTION IF EXISTS public.fetch_my_activity_v1(UUID);
-- Create the fetch_my_activity_v1 function
CREATE OR REPLACE FUNCTION public.fetch_my_activity_v1(p_user_id UUID) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_total INTEGER,
        seats_available INTEGER,
        price DECIMAL,
        details TEXT,
        distance DECIMAL,
        overview_polyline TEXT,
        status TEXT,
        is_women_only BOOLEAN,
        passengers JSONB,
        participant_ids UUID [],
        created_at TIMESTAMPTZ
    ) AS $$ BEGIN RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_total,
    r.seats_available,
    r.price,
    r.details,
    r.distance,
    r.overview_polyline,
    r.status,
    r.is_women_only,
    r.passengers,
    r.participant_ids,
    r.created_at
FROM public.rides r
WHERE -- Usuario es el conductor
    r.driver_id = p_user_id
    OR -- Usuario es/fue pasajero (incluso en viajes cancelados)
    p_user_id = ANY(r.participant_ids)
ORDER BY r.departure_time DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- Add comment
COMMENT ON FUNCTION public.fetch_my_activity_v1(UUID) IS 'Obtiene TODOS los viajes del usuario (como conductor o pasajero), incluyendo cancelados, completados y expirados. Usado en la pestaña Mis Viajes.';
-- Verify the function was created
DO $$ BEGIN IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'fetch_my_activity_v1'
) THEN RAISE NOTICE '✅ Function fetch_my_activity_v1 created successfully';
ELSE RAISE WARNING '⚠️ Function may not have been created correctly';
END IF;
END $$;