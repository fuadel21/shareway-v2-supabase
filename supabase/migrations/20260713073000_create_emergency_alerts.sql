-- Emergency alerts ledger and SOS RPC.
-- Records every SOS activation with ride, actor, optional GPS location and status.

create table if not exists public.emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null,
  user_id uuid not null default auth.uid(),
  chat_id uuid,
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved', 'cancelled')),
  severity text not null default 'high' check (severity in ('low', 'medium', 'high', 'critical')),
  current_location jsonb,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Earlier SOS migrations created this table with `location` only. `CREATE TABLE
-- IF NOT EXISTS` does not reconcile an existing table, so add every column used
-- by this migration before comments, indexes, triggers, and the RPC are parsed.
-- Keeping `location` is intentional for backwards compatibility with historic
-- alerts; new writes use `current_location`.
alter table public.emergency_alerts
  add column if not exists chat_id uuid,
  add column if not exists current_location jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists acknowledged_by uuid,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.emergency_alerts
set current_location = location
where current_location is null
  and location is not null;

comment on table public.emergency_alerts is 'SOS/emergency alert log for ShareWay rides. Stores the triggering user, ride, status, optional GPS location and operational metadata.';
comment on column public.emergency_alerts.current_location is 'Optional JSON GPS payload, usually {lat,lng}. Stored only when the client grants location permission.';
comment on column public.emergency_alerts.metadata is 'Extra event details such as source, user agent, channel or future automation data.';

create index if not exists emergency_alerts_ride_id_idx on public.emergency_alerts (ride_id);
create index if not exists emergency_alerts_user_id_idx on public.emergency_alerts (user_id);
create index if not exists emergency_alerts_status_idx on public.emergency_alerts (status);
create index if not exists emergency_alerts_created_at_idx on public.emergency_alerts (created_at desc);
create index if not exists emergency_alerts_location_gin_idx on public.emergency_alerts using gin (current_location);
create index if not exists emergency_alerts_metadata_gin_idx on public.emergency_alerts using gin (metadata);

alter table public.emergency_alerts enable row level security;
alter table public.emergency_alerts force row level security;

create or replace function public.touch_emergency_alerts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_emergency_alerts_updated_at on public.emergency_alerts;
create trigger trg_touch_emergency_alerts_updated_at
before update on public.emergency_alerts
for each row
execute function public.touch_emergency_alerts_updated_at();

-- Users can read their own alerts. Ride drivers/participants can read alerts for their ride. Admins can read all.
drop policy if exists emergency_alerts_select_related_or_admin on public.emergency_alerts;
create policy emergency_alerts_select_related_or_admin
on public.emergency_alerts
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (coalesce(p.role, '') in ('admin', 'super_admin') or coalesce(p.is_admin, false) = true)
  )
  or exists (
    select 1
    from public.rides r
    where r.id = emergency_alerts.ride_id
      and (
        to_jsonb(r)->>'driver_id' = auth.uid()::text
        or coalesce(to_jsonb(r)->'participant_ids', '[]'::jsonb) ? auth.uid()::text
      )
  )
);

-- Client inserts are allowed only for the authenticated user and only if they are related to the ride.
drop policy if exists emergency_alerts_insert_own_related on public.emergency_alerts;
create policy emergency_alerts_insert_own_related
on public.emergency_alerts
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.rides r
    where r.id = emergency_alerts.ride_id
      and (
        to_jsonb(r)->>'driver_id' = auth.uid()::text
        or coalesce(to_jsonb(r)->'participant_ids', '[]'::jsonb) ? auth.uid()::text
      )
  )
);

-- Only admins can change alert state from the client. The security-definer RPC can write as needed.
drop policy if exists emergency_alerts_update_admin_only on public.emergency_alerts;
create policy emergency_alerts_update_admin_only
on public.emergency_alerts
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (coalesce(p.role, '') in ('admin', 'super_admin') or coalesce(p.is_admin, false) = true)
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (coalesce(p.role, '') in ('admin', 'super_admin') or coalesce(p.is_admin, false) = true)
  )
);

drop policy if exists emergency_alerts_no_client_delete on public.emergency_alerts;
create policy emergency_alerts_no_client_delete
on public.emergency_alerts
for delete
to authenticated
using (false);

create or replace function public.trigger_emergency_alert_v2(
  p_ride_id uuid,
  p_current_location jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride jsonb;
  v_is_admin boolean := false;
  v_is_driver boolean := false;
  v_is_participant boolean := false;
  v_alert_id uuid;
  v_chat_id uuid;
  v_chat_participants uuid[];
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED: Debes iniciar sesión para activar SOS.' using errcode = 'P0001';
  end if;

  select to_jsonb(r)
  into v_ride
  from public.rides r
  where r.id = p_ride_id;

  if v_ride is null then
    raise exception 'RIDE_NOT_FOUND: Viaje no encontrado.' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and (coalesce(p.role, '') in ('admin', 'super_admin') or coalesce(p.is_admin, false) = true)
  ) into v_is_admin;

  v_is_driver := coalesce(v_ride->>'driver_id', '') = v_user_id::text;
  v_is_participant := coalesce(v_ride->'participant_ids', '[]'::jsonb) ? v_user_id::text;

  if not (v_is_admin or v_is_driver or v_is_participant) then
    raise exception 'SOS_NOT_ALLOWED: Solo participantes del viaje pueden activar SOS.' using errcode = 'P0001';
  end if;

  v_chat_participants := array_remove(array[
    v_user_id,
    nullif(v_ride->>'driver_id', '')::uuid
  ], null);

  select c.id
  into v_chat_id
  from public.chats c
  where c.ride_id = p_ride_id
    and c.type = 'emergency'
  order by c.updated_at desc nulls last
  limit 1;

  if v_chat_id is null then
    insert into public.chats (ride_id, type, participants, updated_at)
    values (p_ride_id, 'emergency', v_chat_participants, now())
    returning id into v_chat_id;
  else
    update public.chats
    set updated_at = now()
    where id = v_chat_id;
  end if;

  insert into public.emergency_alerts (
    ride_id,
    user_id,
    chat_id,
    status,
    severity,
    current_location,
    metadata
  ) values (
    p_ride_id,
    v_user_id,
    v_chat_id,
    'active',
    'high',
    p_current_location,
    jsonb_build_object('source', 'trigger_emergency_alert_v2', 'created_by_rpc', true) || coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_alert_id;

  insert into public.messages (chat_id, sender_id, content)
  values (
    v_chat_id,
    v_user_id,
    '🚨 SOS activado. Mantén este canal abierto y llama al 112 si hay peligro inmediato.'
  );

  return jsonb_build_object(
    'success', true,
    'alert_id', v_alert_id,
    'alertId', v_alert_id,
    'chat_id', v_chat_id,
    'chatId', v_chat_id,
    'status', 'active'
  );
end;
$$;

comment on function public.trigger_emergency_alert_v2(uuid, jsonb, jsonb)
is 'Creates a durable emergency_alerts record, opens/reuses the ride emergency chat and inserts an initial SOS message.';

revoke all on function public.trigger_emergency_alert_v2(uuid, jsonb, jsonb) from public;
revoke all on function public.trigger_emergency_alert_v2(uuid, jsonb, jsonb) from anon;
grant execute on function public.trigger_emergency_alert_v2(uuid, jsonb, jsonb) to authenticated;
