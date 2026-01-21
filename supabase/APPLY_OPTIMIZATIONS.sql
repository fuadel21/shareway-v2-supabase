-- ==========================================
-- FASE 4: OPTIMIZACIONES Y ANALYTICS (CORREGIDO)
-- ==========================================

BEGIN;

-- 1. ÍNDICES DE RENDIMIENTO
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_disputes_user_status 
ON public.cancellation_disputes(user_id, status);

CREATE INDEX IF NOT EXISTS idx_disputes_pending_created 
ON public.cancellation_disputes(status, created_at ASC) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_profiles_suspended 
ON public.profiles(is_suspended, suspension_until) 
WHERE is_suspended = true;

-- 2. VISTA MATERIALIZADA DE ESTADÍSTICAS
-- ==========================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dispute_stats AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    status,
    user_type,
    COUNT(*) as total_disputes,
    AVG(COALESCE(refund_amount, 0)) as avg_refund,
    SUM(COALESCE(refund_amount, 0)) as total_refund
FROM public.cancellation_disputes
GROUP BY DATE_TRUNC('day', created_at), status, user_type;

CREATE INDEX IF NOT EXISTS idx_mv_dispute_stats_date 
ON mv_dispute_stats(date DESC);

-- 3. FUNCIÓN DE BÚSQUEDA AVANZADA
-- ==========================================

CREATE OR REPLACE FUNCTION public.search_disputes(
    p_status TEXT DEFAULT NULL,
    p_user_type TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    ride_id UUID,
    user_id UUID,
    user_name TEXT,
    user_email TEXT,
    user_type TEXT,
    reason TEXT,
    refund_amount NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    admin_notes TEXT,
    ride_origin TEXT,
    ride_destination TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cd.id,
        cd.ride_id,
        cd.user_id,
        p.display_name,
        p.email,
        cd.user_type,
        cd.reason,
        cd.refund_amount,
        cd.status,
        cd.created_at,
        cd.resolved_at,
        cd.admin_notes,
        (r.origin->>'name')::TEXT,
        (r.destination->>'name')::TEXT
    FROM public.cancellation_disputes cd
    JOIN public.profiles p ON cd.user_id = p.id
    LEFT JOIN public.rides r ON cd.ride_id = r.id
    WHERE (p_status IS NULL OR cd.status = p_status)
    AND (p_user_type IS NULL OR cd.user_type = p_user_type)
    ORDER BY cd.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMIT;

-- 4. VERIFICACIÓN FINAL
-- ==========================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════';
    RAISE NOTICE '🚀 OPTIMIZACIONES APLICADAS EXITOSAMENTE';
    RAISE NOTICE '════════════════════════════════════════════════';
    RAISE NOTICE '✅ Índices de rendimiento creados';
    RAISE NOTICE '✅ Vista materializada mv_dispute_stats creada';
    RAISE NOTICE '✅ Función search_disputes creada';
    RAISE NOTICE '';
END $$;
