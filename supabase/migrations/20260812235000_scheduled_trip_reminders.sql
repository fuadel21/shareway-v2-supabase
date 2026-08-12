-- Scheduled trip reminders built on top of the existing background push outbox.
-- Reuses public.notifications, radar_push_outbox, send-push and the already scheduled
-- process-radar-push-outbox Edge Function. No second push queue or cron is introduced.

create table if not exists public.trip_reminder_deliveries (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_key text not null check (reminder_key in ('24h', '1h')),
  departure_time timestamptz not null,
  recipient_role text not null check (recipient_role in ('driver', 'passenger')),
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (ride_id, user_id, reminder_key, departure_time)
);

create index if not exists trip_reminder_deliveries_notification_idx
on public.trip_reminder_deliveries (notification_id)
where notification_id is not null;

alter table public.trip_reminder_deliveries enable row level security;
revoke all on public.trip_reminder_deliveries from public, anon, authenticated;

-- Generalize the existing radar outbox trigger so operational notifications can opt in
-- to the same reliable background-push pipeline without pretending to be radar alerts.
create or replace function public.enqueue_radar_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.metadata->>'radar', 'false') <> 'true'
     and coalesce(new.metadata->>'background_push', 'false') <> 'true' then
    return new;
  end if;

  insert into public.radar_push_outbox (notification_id, user_id)
  values (new.id, new.user_id)
  on conflict (notification_id) do nothing;

  return new;
exception when others then
  raise warning 'Could not enqueue background push for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function public.enqueue_radar_push_notification() is
  'Queues radar alerts and other notifications that explicitly set metadata.background_push=true.';

-- Insert one reminder notification exactly once for a ride/user/window/departure snapshot.
create or replace function public.queue_trip_reminder_notification(
  p_ride_id uuid,
  p_user_id uuid,
  p_recipient_role text,
  p_reminder_key text,
  p_departure_time timestamptz,
  p_origin_label text,
  p_destination_label text,
  p_push_enabled boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notification_id uuid;
  v_title text;
  v_message text;
  v_priority text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_recipient_role not in ('driver', 'passenger')
     or p_reminder_key not in ('24h', '1h') then
    return false;
  end if;

  insert into public.trip_reminder_deliveries (
    ride_id, user_id, reminder_key, departure_time, recipient_role
  ) values (
    p_ride_id, p_user_id, p_reminder_key, p_departure_time, p_recipient_role
  )
  on conflict (ride_id, user_id, reminder_key, departure_time) do nothing;

  if not found then
    return false;
  end if;

  if p_reminder_key = '1h' then
    v_title := 'Tu viaje sale pronto';
    v_message := format(
      'Tu viaje de %s a %s sale en menos de una hora. Revisa el punto de encuentro y tu reserva.',
      coalesce(nullif(p_origin_label, ''), 'origen'),
      coalesce(nullif(p_destination_label, ''), 'destino')
    );
    v_priority := 'high';
  else
    v_title := 'Recordatorio de viaje';
    v_message := format(
      'Tienes un viaje de %s a %s en las próximas 24 horas. Revisa los detalles antes de salir.',
      coalesce(nullif(p_origin_label, ''), 'origen'),
      coalesce(nullif(p_destination_label, ''), 'destino')
    );
    v_priority := 'normal';
  end if;

  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    action_url,
    entity_type,
    entity_id,
    priority,
    metadata
  ) values (
    p_user_id,
    v_title,
    v_message,
    'trip_reminder',
    '/ride/' || p_ride_id::text,
    'ride',
    p_ride_id::text,
    v_priority,
    jsonb_build_object(
      'background_push', coalesce(p_push_enabled, true),
      'trip_reminder', true,
      'reminder_key', p_reminder_key,
      'ride_id', p_ride_id,
      'recipient_role', p_recipient_role,
      'departure_time_snapshot', p_departure_time,
      'action', 'open_ride'
    )
  ) returning id into v_notification_id;

  update public.trip_reminder_deliveries
  set notification_id = v_notification_id
  where ride_id = p_ride_id
    and user_id = p_user_id
    and reminder_key = p_reminder_key
    and departure_time = p_departure_time;

  return true;
exception when others then
  raise warning 'Trip reminder enqueue failed for ride %, user %, %: %',
    p_ride_id, p_user_id, p_reminder_key, sqlerrm;
  return false;
end;
$$;

-- Called by the existing outbox processor on every scheduled run.
-- 24h reminder: first eligible sweep while departure is 12-24h away.
-- 1h reminder: first eligible sweep while departure is <= 60 minutes away.
-- The delivery ledger makes repeated sweeps idempotent.
create or replace function public.enqueue_due_trip_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride record;
  v_ride_json jsonb;
  v_passenger jsonb;
  v_passenger_id uuid;
  v_origin_label text;
  v_destination_label text;
  v_reminder_key text;
  v_push_enabled boolean;
  v_created integer := 0;
  v_scanned integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  for v_ride in
    select r.*
    from public.rides r
    where lower(coalesce(r.status, '')) = 'scheduled'
      and r.departure_time > now()
      and r.departure_time <= now() + interval '24 hours'
    order by r.departure_time
  loop
    v_scanned := v_scanned + 1;
    v_ride_json := to_jsonb(v_ride);

    if v_ride.departure_time <= now() + interval '1 hour' then
      v_reminder_key := '1h';
    elsif v_ride.departure_time >= now() + interval '12 hours' then
      v_reminder_key := '24h';
    else
      continue;
    end if;

    v_origin_label := coalesce(
      v_ride_json#>>'{origin,name}',
      v_ride_json#>>'{origin,address}',
      v_ride_json->>'origin_address',
      'tu origen'
    );
    v_destination_label := coalesce(
      v_ride_json#>>'{destination,name}',
      v_ride_json#>>'{destination,address}',
      v_ride_json->>'destination_address',
      'tu destino'
    );

    -- Driver reminder.
    if v_ride.driver_id is not null then
      select coalesce(
        (select np.push_enabled from public.notification_preferences np where np.user_id = v_ride.driver_id),
        true
      ) into v_push_enabled;

      if public.queue_trip_reminder_notification(
        v_ride.id,
        v_ride.driver_id,
        'driver',
        v_reminder_key,
        v_ride.departure_time,
        v_origin_label,
        v_destination_label,
        v_push_enabled
      ) then
        v_created := v_created + 1;
      end if;
    end if;

    -- Confirmed/verified passengers stored in the canonical rides.passengers JSONB array.
    for v_passenger in
      select p
      from jsonb_array_elements(coalesce(v_ride_json->'passengers', '[]'::jsonb)) p
      where lower(coalesce(p->>'status', '')) in ('confirmed', 'verified', 'on_board')
        and coalesce(p->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    loop
      v_passenger_id := (v_passenger->>'id')::uuid;

      select coalesce(
        (select np.push_enabled from public.notification_preferences np where np.user_id = v_passenger_id),
        true
      ) into v_push_enabled;

      if public.queue_trip_reminder_notification(
        v_ride.id,
        v_passenger_id,
        'passenger',
        v_reminder_key,
        v_ride.departure_time,
        v_origin_label,
        v_destination_label,
        v_push_enabled
      ) then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'rides_scanned', v_scanned,
    'notifications_created', v_created,
    'processed_at', now()
  );
end;
$$;

-- Terminally discard an outbox job that is no longer valid (for example, a reminder
-- for a cancelled/reprogrammed ride). Keeping it in the same table preserves auditability.
create or replace function public.discard_radar_push_job(
  p_job_id bigint,
  p_reason text default 'STALE_NOTIFICATION'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.radar_push_outbox
  set status = 'failed',
      attempts = greatest(attempts, 6),
      locked_at = null,
      next_attempt_at = now() + interval '100 years',
      last_error = left(coalesce(p_reason, 'STALE_NOTIFICATION'), 1000),
      updated_at = now()
  where id = p_job_id;
end;
$$;

-- Harden the existing queue: a worker that dies after claiming its sixth attempt used
-- to leave the row in processing forever because attempts < 6 excluded it from recovery.
create or replace function public.claim_radar_push_jobs(p_limit integer default 25)
returns table (
  job_id bigint,
  notification_id uuid,
  user_id uuid,
  title text,
  message text,
  action_url text,
  metadata jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.radar_push_outbox
  set status = 'failed',
      locked_at = null,
      last_error = coalesce(last_error, 'MAX_ATTEMPTS_EXHAUSTED_AFTER_STALE_CLAIM'),
      next_attempt_at = now() + interval '100 years',
      updated_at = now()
  where status = 'processing'
    and attempts >= 6
    and locked_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select o.id
    from public.radar_push_outbox o
    where (
      o.status = 'pending'
      or (o.status = 'failed' and o.next_attempt_at <= now())
      or (o.status = 'processing' and o.locked_at < now() - interval '10 minutes')
    )
      and o.attempts < 6
    order by o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update public.radar_push_outbox o
    set status = 'processing',
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
    coalesce(n.message, ''),
    coalesce(n.action_url, '/notifications'),
    coalesce(n.metadata, '{}'::jsonb),
    c.attempts
  from claimed c
  join public.notifications n on n.id = c.notification_id;
end;
$$;

revoke all on function public.queue_trip_reminder_notification(uuid, uuid, text, text, timestamptz, text, text, boolean)
from public, anon, authenticated;
revoke all on function public.enqueue_due_trip_reminders() from public, anon, authenticated;
revoke all on function public.discard_radar_push_job(bigint, text) from public, anon, authenticated;

grant execute on function public.queue_trip_reminder_notification(uuid, uuid, text, text, timestamptz, text, text, boolean)
to service_role;
grant execute on function public.enqueue_due_trip_reminders() to service_role;
grant execute on function public.discard_radar_push_job(bigint, text) to service_role;

comment on table public.trip_reminder_deliveries is
  'Idempotent ledger for driver/passenger scheduled-trip reminders keyed by departure snapshot.';
comment on function public.enqueue_due_trip_reminders() is
  'Creates due 24h/1h trip reminders. Intended to run from the existing background push processor.';
comment on table public.radar_push_outbox is
  'Reliable background push outbox shared by radar alerts and explicitly opted-in operational notifications.';
