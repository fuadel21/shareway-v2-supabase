-- ShareWay ride incident center
-- User/admin incident system without triggers.

create extension if not exists pgcrypto;

create table if not exists public.ride_incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid null,
  reporter_id uuid not null,
  reported_user_id uuid null,
  category text not null default 'other',
  severity text not null default 'normal',
  status text not null default 'open',
  title text not null default 'Incidencia de viaje',
  description text not null,
  contact_requested boolean not null default false,
  admin_notes text null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_by uuid null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_incidents_category_check check (
    category in ('safety', 'payment', 'driver_no_show', 'passenger_no_show', 'behavior', 'vehicle', 'route', 'other')
  ),
  constraint ride_incidents_severity_check check (
    severity in ('low', 'normal', 'high', 'critical')
  ),
  constraint ride_incidents_status_check check (
    status in ('open', 'reviewing', 'resolved', 'closed')
  ),
  constraint ride_incidents_description_length check (char_length(trim(description)) between 10 and 3000),
  constraint ride_incidents_title_length check (char_length(trim(title)) between 3 and 160)
);

create index if not exists ride_incidents_reporter_idx on public.ride_incidents(reporter_id, created_at desc);
create index if not exists ride_incidents_ride_idx on public.ride_incidents(ride_id, created_at desc);
create index if not exists ride_incidents_status_idx on public.ride_incidents(status, severity, created_at desc);
create index if not exists ride_incidents_reported_user_idx on public.ride_incidents(reported_user_id, created_at desc);

alter table public.ride_incidents enable row level security;

create or replace function public.sw_is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.is_admin, false) = true
        or lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
      )
  );
$$;

-- Clean old policies if this migration is re-run.
drop policy if exists "Users can create own ride incidents" on public.ride_incidents;
drop policy if exists "Users can read own ride incidents" on public.ride_incidents;
drop policy if exists "Admins can read all ride incidents" on public.ride_incidents;
drop policy if exists "Admins can update ride incidents" on public.ride_incidents;
drop policy if exists "Admins can delete ride incidents" on public.ride_incidents;

create policy "Users can create own ride incidents"
on public.ride_incidents
for insert
to authenticated
with check (auth.uid() = reporter_id);

create policy "Users can read own ride incidents"
on public.ride_incidents
for select
to authenticated
using (auth.uid() = reporter_id or auth.uid() = reported_user_id);

create policy "Admins can read all ride incidents"
on public.ride_incidents
for select
to authenticated
using (public.sw_is_current_user_admin());

create policy "Admins can update ride incidents"
on public.ride_incidents
for update
to authenticated
using (public.sw_is_current_user_admin())
with check (public.sw_is_current_user_admin());

create policy "Admins can delete ride incidents"
on public.ride_incidents
for delete
to authenticated
using (public.sw_is_current_user_admin());

create or replace function public.sw_report_ride_incident(
  p_ride_id text default null,
  p_reported_user_id uuid default null,
  p_category text default 'other',
  p_severity text default 'normal',
  p_title text default 'Incidencia de viaje',
  p_description text default '',
  p_contact_requested boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_incident_id uuid;
  v_ride_uuid uuid := null;
  v_category text := lower(coalesce(p_category, 'other'));
  v_severity text := lower(coalesce(p_severity, 'normal'));
  v_title text := trim(coalesce(p_title, 'Incidencia de viaje'));
  v_description text := trim(coalesce(p_description, ''));
  v_admin record;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_ride_id is not null and trim(p_ride_id) <> '' then
    begin
      v_ride_uuid := p_ride_id::uuid;
    exception when others then
      raise exception 'ID de viaje inválido';
    end;
  end if;

  if v_category not in ('safety', 'payment', 'driver_no_show', 'passenger_no_show', 'behavior', 'vehicle', 'route', 'other') then
    v_category := 'other';
  end if;

  if v_severity not in ('low', 'normal', 'high', 'critical') then
    v_severity := 'normal';
  end if;

  if char_length(v_title) < 3 then
    v_title := 'Incidencia de viaje';
  end if;

  if char_length(v_title) > 160 then
    v_title := left(v_title, 160);
  end if;

  if char_length(v_description) < 10 then
    raise exception 'Describe la incidencia con al menos 10 caracteres';
  end if;

  if char_length(v_description) > 3000 then
    v_description := left(v_description, 3000);
  end if;

  insert into public.ride_incidents (
    ride_id,
    reporter_id,
    reported_user_id,
    category,
    severity,
    title,
    description,
    contact_requested,
    metadata
  ) values (
    v_ride_uuid,
    v_user_id,
    p_reported_user_id,
    v_category,
    v_severity,
    v_title,
    v_description,
    coalesce(p_contact_requested, false),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_incident_id;

  -- Notify admins. This uses the existing notifications/push flow but does not use triggers.
  if to_regclass('public.notifications') is not null and to_regclass('public.profiles') is not null then
    for v_admin in
      select id
      from public.profiles
      where coalesce(is_admin, false) = true
         or lower(coalesce(role::text, '')) in ('admin', 'super_admin')
    loop
      insert into public.notifications (
        user_id,
        actor_id,
        type,
        title,
        message,
        action_url,
        entity_type,
        entity_id,
        priority,
        metadata
      ) values (
        v_admin.id,
        v_user_id,
        'ride_incident_reported',
        case when v_severity = 'critical' then 'Incidencia crítica' else 'Nueva incidencia' end,
        'Un usuario ha reportado una incidencia en ShareWay: ' || v_title,
        '/admin/incidents',
        'ride_incident',
        v_incident_id::text,
        case when v_severity in ('high', 'critical') then 'high' else 'normal' end,
        jsonb_build_object(
          'incidentId', v_incident_id,
          'rideId', v_ride_uuid,
          'reporterId', v_user_id,
          'reportedUserId', p_reported_user_id,
          'category', v_category,
          'severity', v_severity
        )
      );
    end loop;
  end if;

  return v_incident_id;
end;
$$;

create or replace function public.sw_admin_update_ride_incident(
  p_incident_id uuid,
  p_status text default null,
  p_severity text default null,
  p_admin_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(coalesce(p_status, ''));
  v_severity text := lower(coalesce(p_severity, ''));
begin
  if not public.sw_is_current_user_admin() then
    raise exception 'Solo administradores';
  end if;

  if v_status <> '' and v_status not in ('open', 'reviewing', 'resolved', 'closed') then
    raise exception 'Estado inválido';
  end if;

  if v_severity <> '' and v_severity not in ('low', 'normal', 'high', 'critical') then
    raise exception 'Prioridad inválida';
  end if;

  update public.ride_incidents
  set
    status = case when v_status <> '' then v_status else status end,
    severity = case when v_severity <> '' then v_severity else severity end,
    admin_notes = case when p_admin_notes is not null then p_admin_notes else admin_notes end,
    resolved_by = case when v_status in ('resolved', 'closed') then auth.uid() else resolved_by end,
    resolved_at = case when v_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else resolved_at end,
    updated_at = now()
  where id = p_incident_id;

  if not found then
    raise exception 'Incidencia no encontrada';
  end if;

  return true;
end;
$$;

grant execute on function public.sw_report_ride_incident(text, uuid, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.sw_admin_update_ride_incident(uuid, text, text, text) to authenticated;
grant execute on function public.sw_is_current_user_admin() to authenticated;

notify pgrst, 'reload schema';
