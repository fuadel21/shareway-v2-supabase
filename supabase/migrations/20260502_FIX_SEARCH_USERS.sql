-- ========================================================
-- FIX: MOTOR DE BÚSQUEDA DE USUARIOS (ADMIN)
-- Propósito: Garantizar que la búsqueda de usuarios funcione independientemente
-- de la columna is_admin (usando role = 'admin') y asegurar retorno de datos.
-- ========================================================

DROP FUNCTION IF EXISTS public.search_users(TEXT);

CREATE OR REPLACE FUNCTION public.search_users(p_search_term TEXT DEFAULT '')
RETURNS TABLE (
    user_id UUID,
    user_display_name TEXT,
    user_email TEXT,
    user_photo_url TEXT,
    user_role TEXT,
    user_is_suspended BOOLEAN,
    user_verification JSONB,
    user_is_admin BOOLEAN,
    user_created_at TIMESTAMPTZ
) AS $$
DECLARE
    v_requester UUID := auth.uid();
BEGIN
    -- 1. Verificación de seguridad robusta
    IF v_requester IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- 2. Verificar si es admin por ROL (más fiable que is_admin en este esquema)
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = v_requester
        AND (role = 'admin' OR is_admin = true)
    ) THEN
        RAISE EXCEPTION 'No autorizado: se requieren privilegios de administrador';
    END IF;

    -- 3. Ejecutar búsqueda
    RETURN QUERY
    SELECT
        p.id as user_id,
        p.display_name as user_display_name,
        p.email as user_email,
        p.photo_url as user_photo_url,
        COALESCE(p.role, 'user') as user_role,
        COALESCE(p.is_suspended, false) as user_is_suspended,
        COALESCE(p.verification, '{"status": "none"}'::jsonb) as user_verification,
        COALESCE(p.is_admin, false) as user_is_admin,
        p.created_at as user_created_at
    FROM public.profiles p
    WHERE (
        p.display_name ILIKE '%' || p_search_term || '%' OR
        p.email ILIKE '%' || p_search_term || '%'
    )
    ORDER BY p.created_at DESC NULLS LAST
    LIMIT 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario para el log de Supabase
COMMENT ON FUNCTION public.search_users(TEXT) IS 'Buscador de usuarios avanzado para el panel de administración.';
