-- ==========================================
-- CONFIGURACIÓN DE MONITOREO Y CRON JOBS
-- ==========================================

-- 1. VISTA DE SALUD DEL SISTEMA (DASHBOARD)
-- Consulta rápida para ver el estado general de la plataforma
CREATE OR REPLACE VIEW public.admin_health_dashboard AS
SELECT 
    NOW() as last_updated,
    (SELECT COUNT(*) FROM public.cancellation_disputes WHERE status = 'pending') as disputes_pending,
    (SELECT COUNT(*) FROM public.profiles WHERE is_suspended = true) as suspended_users,
    (SELECT SUM(held_balance) FROM public.wallets) as total_held_funds,
    (SELECT COUNT(*) FROM public.rides WHERE status = 'active') as active_rides,
    (SELECT COUNT(*) FROM public.notifications WHERE created_at < NOW() - INTERVAL '30 days') as notifications_to_clean;

-- Dar permisos de lectura al admin (o a quien corresponda)
-- GRANT SELECT ON public.admin_health_dashboard TO authenticated; -- Opcional, según tus RLS

-- 2. CONFIGURACIÓN DE CRON JOBS (Requiere extensión pg_cron)
-- Intento de habilitar extensión y programar tareas
DO $$
BEGIN
    -- Verificar si pg_cron está disponible (solo en proyectos Pro o self-hosted con config)
    -- Si falla aquí, es que no tienes soporte de extensiones o permisos.
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Job 1: Levantar suspensiones expiradas (Cada hora)
    -- Se llama a la función pública RPC
    PERFORM cron.schedule(
        'job_lift_suspensions', -- Nombre único
        '0 * * * *',           -- Cada hora en punto
        'SELECT public.lift_suspension_if_expired();'
    );

    -- Job 2: Limpieza de notificaciones (Cada día a las 4 AM)
    PERFORM cron.schedule(
        'job_cleanup_notifications',
        '0 4 * * *',           -- A las 04:00 AM diario
        'SELECT public.cleanup_notifications();'
    );

    -- Job 3: Refrescar estadísticas materializadas (Cada 6 horas)
    -- Si creaste la vista materializada mv_dispute_stats en pasos anteriores
    PERFORM cron.schedule(
        'job_refresh_stats',
        '0 */6 * * *',         -- Cada 6 horas
        'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_dispute_stats;'
    );

    -- Job 4: Limpiar solicitudes expiradas y revertir aceptadas sin pago (Cada 10 minutos)
    PERFORM cron.schedule(
        'job_clean_expired_requests',
        '*/10 * * * *',
        'SELECT public.clean_expired_requests();'
    );

    PERFORM cron.schedule(
        'job_clean_pending_reservations',
        '*/30 * * * *',
        'SELECT public.clean_pending_reservations();'
    );

    RAISE NOTICE '✅ Cron jobs configurados exitosamente en pg_cron';

EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ No se pudo configurar pg_cron automáticamente.';
    RAISE NOTICE 'Posible causa: Tu proyecto es Free Tier o no tienes permisos de superusuario.';
    RAISE NOTICE 'Alternativa: Configurar una Edge Function con Schedule o usar el panel de Supabase -> Database -> Extensions.';
END $$;
