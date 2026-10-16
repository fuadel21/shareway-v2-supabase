-- ============================================================================
-- SHAREWAY · FIX_RADAR_PUSH.sql
-- ============================================================================
-- Arregla la cola de push del radar (jamás llegó a funcionar):
--   · claim_radar_push_jobs: 'attempts' ambiguo (param OUT vs columna) en el
--     UPDATE de recuperacion stale → error 500 en cada intento del cron
-- Requiere la Edge Function process-radar-push-outbox con el fix de scope
-- (jsonResponse sin getCorsHeaders) — desplegada aparte.
-- Es IDEMPOTENTE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_radar_push_jobs(p_limit integer DEFAULT 25)
 RETURNS TABLE(job_id bigint, notification_id bigint, user_id uuid, title text, message text, action_url text, metadata jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin

  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;


  -- Recuperar jobs que murieron después del sexto intento.
  update public.radar_push_outbox
  set
    status = 'failed',
    locked_at = null,
    last_error = coalesce(
      last_error,
      'MAX_ATTEMPTS_EXHAUSTED_AFTER_STALE_CLAIM'
    ),
    next_attempt_at = now() + interval '100 years',
    updated_at = now()

  where status = 'processing'
    and public.radar_push_outbox.attempts >= 6
    and locked_at < now() - interval '10 minutes';


  return query

  with candidates as (

    select o.id

    from public.radar_push_outbox o

    where (

      o.status = 'pending'

      or (
        o.status = 'failed'
        and o.next_attempt_at <= now()
      )

      or (
        o.status = 'processing'
        and o.locked_at < now() - interval '10 minutes'
      )

    )

    and o.attempts < 6

    order by o.created_at

    for update skip locked

    limit greatest(
      1,
      least(
        coalesce(p_limit, 25),
        100
      )
    )

  ),

  claimed as (

    update public.radar_push_outbox o

    set
      status = 'processing',
      attempts = o.attempts + 1,
      locked_at = now(),
      updated_at = now()

    from candidates c

    where o.id = c.id

    returning o.*

  )

  select

    c.id,

    c.notification_id,

    c.user_id,

    n.title,

    coalesce(
      n.message,
      ''
    ),

    coalesce(
      n.action_url,
      '/notifications'
    ),

    coalesce(
      n.metadata,
      '{}'::jsonb
    ),

    c.attempts

  from claimed c

  join public.notifications n
    on n.id = c.notification_id;

end;
$function$;

CREATE OR REPLACE FUNCTION public.finish_radar_push_job(p_job_id bigint, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.radar_push_outbox
  set status = case
        when p_success then 'sent'
        when attempts >= 6 then 'failed'
        else 'failed'
      end,
      sent_at = case
        when p_success then now()
        else sent_at
      end,
      next_attempt_at = case
        when p_success then next_attempt_at
        else now() + make_interval(
          mins => least(
            60,
            greatest(1, attempts * attempts)
          )
        )
      end,
      locked_at = null,
      last_error = case
        when p_success then null
        else left(
          coalesce(p_error, 'Unknown push error'),
          1000
        )
      end,
      updated_at = now()
  where id = p_job_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.discard_radar_push_job(p_job_id bigint, p_reason text DEFAULT 'STALE_NOTIFICATION'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin

  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;


  update public.radar_push_outbox
  set
    status = 'failed',
    attempts = greatest(attempts, 6),
    locked_at = null,
    next_attempt_at = now() + interval '100 years',
    last_error = left(
      coalesce(
        p_reason,
        'STALE_NOTIFICATION'
      ),
      1000
    ),
    updated_at = now()

  where id = p_job_id;

end;
$function$;

NOTIFY pgrst, 'reload schema';
