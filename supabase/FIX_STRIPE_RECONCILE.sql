-- ============================================================================
-- SHAREWAY · FIX_STRIPE_RECONCILE.sql
-- ============================================================================
-- Programa el cron de conciliación con Stripe (red de seguridad):
--   cada 15 minutos, pg_net llama a la Edge Function stripe-reconcile, que
--   compara los pagos/reembolsos reales de Stripe (ventana 2 h) con la BD y
--   aplica (idempotentemente) lo que el webhook no hubiera procesado.
--
-- Requiere: pg_net (ya instalado) y la función stripe-reconcile desplegada.
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sw_schedule_stripe_reconcile()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN 'pg_cron no disponible: programa la llamada desde un servicio externo';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shareway_stripe_reconcile') THEN
    PERFORM cron.unschedule('shareway_stripe_reconcile');
  END IF;
  PERFORM cron.schedule(
    'shareway_stripe_reconcile',
    '*/15 * * * *',
    $sql$
      SELECT net.http_post(
        url := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/stripe-reconcile',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-sw-webhook', 'shareway-bookings-2026'
        ),
        body := '{}'::jsonb
      );
    $sql$
  );

  RETURN 'cron shareway_stripe_reconcile programado (*/15 * * * *)';
END;
$fn$;

SELECT public.sw_schedule_stripe_reconcile() AS resultado;
