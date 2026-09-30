-- ============================================================================
-- Public registered-user counter
--
-- The landing page exposes only an aggregate count. It never receives profile
-- rows or emails. The singleton row is updated by a SECURITY DEFINER trigger so
-- the public page can subscribe to changes without opening public.profiles.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.public_platform_stats (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    registered_users BIGINT NOT NULL DEFAULT 0 CHECK (registered_users >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.public_platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_platform_stats FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_platform_stats_read ON public.public_platform_stats;
CREATE POLICY public_platform_stats_read
ON public.public_platform_stats
FOR SELECT
TO anon, authenticated
USING (id = TRUE);

REVOKE ALL ON TABLE public.public_platform_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_platform_stats TO anon, authenticated;

INSERT INTO public.public_platform_stats (id, registered_users, updated_at)
VALUES (TRUE, (SELECT COUNT(*) FROM public.profiles), NOW())
ON CONFLICT (id) DO UPDATE SET
    registered_users = EXCLUDED.registered_users,
    updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.refresh_public_registered_user_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.public_platform_stats AS stats (id, registered_users, updated_at)
        VALUES (TRUE, 1, NOW())
        ON CONFLICT (id) DO UPDATE SET
            registered_users = stats.registered_users + 1,
            updated_at = EXCLUDED.updated_at;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.public_platform_stats AS stats (id, registered_users, updated_at)
        VALUES (TRUE, 0, NOW())
        ON CONFLICT (id) DO UPDATE SET
            registered_users = GREATEST(stats.registered_users - 1, 0),
            updated_at = EXCLUDED.updated_at;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_public_registered_user_count ON public.profiles;
CREATE TRIGGER trg_refresh_public_registered_user_count
AFTER INSERT OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.refresh_public_registered_user_count();

REVOKE ALL ON FUNCTION public.refresh_public_registered_user_count() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_registered_user_count()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT registered_users FROM public.public_platform_stats WHERE id = TRUE),
        0
    )::BIGINT;
$$;

REVOKE ALL ON FUNCTION public.get_public_registered_user_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_registered_user_count() TO anon, authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'public_platform_stats'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.public_platform_stats;
    END IF;
END;
$$;

COMMENT ON TABLE public.public_platform_stats IS
    'Public aggregate counters only; contains no profile, email, or user-identifying data.';
COMMENT ON FUNCTION public.get_public_registered_user_count() IS
    'Returns the aggregate number of registered profiles for the public landing page.';
