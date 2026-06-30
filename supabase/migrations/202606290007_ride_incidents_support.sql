-- ShareWay ride incidents and support backend
-- Creates a support/incident system and notifies admins when users report problems.

create table if not exists public.ride_incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id text,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  category text not null default 'general',
  severity text not null default 'normal',
  title text not null,
  description text not null,
  status text not null default 'open',
  admin_notes text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_incidents_category_check check (
    category in ('general', 'safety', 'payment', 'no_show', 'behavior', 'vehicle', 'route', 'technical', 'other')
  ),
  constraint ride_incidents_severity_check check (
    severity in ('low', 'normal', 'high', 'critical')
  ),
  constraint ride_incidents_status_check check (
    status in ('open', 'in_review', 'waiting_user', 'resolved', 'dismissed')
  )
);

create index if not exists ride_incidents_reporter_idx on public.ride_incidents(reporter_id);
create index if not exists ride_incidents_ride_idx on public.ride_incidents(ride_id);
create index if not exists ride_incidents_status_idx on public.ride_incidents(status);
create index if not exists ride_incidents_created_at_idx on public.ride_incidents(created_at desc);

alter table public.ride_incidents enable row level security;

drop policy if exists "Users can view their own ride incidents" on public.ride_incidents;
create policy "Users can view their own ride incidents"
on public.ride_incidents
for select
to authenticated
using (
  reporter_id = auth.uid()
  or target_user_id = auth.uid()
  or coalesce(public.is_current_user_admin(), false)
);

drop policy if exists "Users can create their own ride incidents" on public.ride_incidents;
create policy "Users can create their own ride incidents"
on public.ride_incidents
for insert
to authenticated
with check (reporter_id = auth.uid());

drop policy if exists "Admins can update ride incidents" on public.ride_incidents;
create policy "Admins can update ride incidents"
on public.ride_incidents
for update
to authenticated
using (coalesce(public.is_current_user_admin(), false))
with check (coalesce(public.is_current_user_admin(), false));

create or replace function public.sw_touch_ride_incident_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ride_incidents_touch_updated_at on public.ride_incidents;
create trigger ride_incidents_touch_updated_at
before update on public.ride_incidents
for each row
execute function public.sw_touch_ride_incident_updated_at();

create or replace function public.sw_get_admin_user_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id::uuid
  from public.profiles p
  where coalesce(p.is_admin, false) = true
     or lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
$$;

create or replace function public.sw_notify_admins_of_incident(p_incident_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident record;
  v_admin record;
  v_count integer := 0;
  v_title text;
  v_message text;
  v_key text;
begin
  select * into v_incident
  from public.ride_incidents
  where id = p_incident_id;

  if v_incident.id is null then
    return 0;
  end if;

  v_title := case
    when v_incident.severity = 'critical' then 'Incidencia crítica'
    when v_incident.severity = 'high' then 'Incidencia importante'
    else 'Nueva incidencia'
  end;

  v_message := coalesce(v_incident.title, 'Incidencia') || ' — ' || left(coalesce(v_incident.description, ''), 180);
  v_key := 'incident:' || v_incident.id::text || ':admin_alert';

  for v_admin in select user_id from public.sw_get_admin_user_ids() loop
    if v_admin.user_id is not null and v_admin.user_id <> v_incident.reporter_id then
      if not exists (
        select 1
        from public.notifications
        where user_id = v_admin.user_id
          and type = 'ride_incident_admin_alert'
          and entity_type = 'ride_incident'
          and entity_id = v_incident.id::text
          and metadata->>'automationKey' = v_key
      ) then
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
          v_admin.user_id,
          v_incident.reporter_id,
          'ride_incident_admin_alert',
          v_title,
          v_message,
          '/admin/incidents',
          'ride_incident',
          v_incident.id::text,
          case when v_incident.severity in ('critical', 'high') then 'high' else 'normal' end,
          jsonb_build_object(
            'incidentId', v_incident.id,
            'rideId', v_incident.ride_id,
            'reporterId', v_incident.reporter_id,
            'targetUserId', v_incident.target_user_id,
            'category', v_incident.category,
            'severity', v_incident.severity,
            'automationKey', v_key
          )
        );
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.sw_report_ride_incident(
  p_ride_id text,
  p_category text,
  p_title text,
  p_description text,
  p_target_user_id uuid default null,
  p_severity text default 'normal',
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
  v_category text := lower(coalesce(nullif(trim(p_category), ''), 'general'));
  v_severity text := lower(coalesce(nullif(trim(p_severity), ''), 'normal'));
  v_title text := left(trim(coalesce(p_title, '')), 140);
  v_description text := left(trim(coalesce(p_description, '')), 3000);
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para reportar una incidencia';
  end if;

  if v_category not in ('general', 'safety', 'payment', 'no_show', 'behavior', 'vehicle', 'route', 'technical', 'other') then
    v_category := 'general';
  end if;

  if v_severity not in ('low', 'normal', 'high', 'critical') then
    v_severity := 'normal';
  end if;

  if v_title = '' then
    raise exception 'El título de la incidencia es obligatorio';
  end if;

  if v_description = '' then
    raise exception 'La descripción de la incidencia es obligatoria';
  end if;

  insert into public.ride_incidents (
    ride_id,
    reporter_id,
    target_user_id,
    category,
    severity,
    title,
    description,
    metadata
  ) values (
    nullif(trim(coalesce(p_ride_id, '')), ''),
    v_user_id,
    p_target_user_id,
    v_category,
    v_severity,
    v_title,
    v_description,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_incident_id;

  perform public.sw_notify_admins_of_incident(v_incident_id);

  return v_incident_id;
end;
$$;

create or replace function public.sw_update_ride_incident_status(
  p_incident_id uuid,
  p_status text,
  p_admin_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'in_review'));
  v_user_id uuid := auth.uid();
  v_incident record;
begin
  if not coalesce(public.is_current_user_admin(), false) then
    raise exception 'Solo admin puede actualizar incidencias';
  end if;

  if v_status not in ('open', 'in_review', 'waiting_user', 'resolved', 'dismissed') then
    raise exception 'Estado de incidencia inválido';
  end if;

  update public.ride_incidents
  set
    status = v_status,
    admin_notes = coalesce(p_admin_notes, admin_notes),
    resolved_by = case when v_status in ('resolved', 'dismissed') then v_user_id else resolved_by end,
    resolved_at = case when v_status in ('resolved', 'dismissed') then coalesce(resolved_at, now()) else null end
  where id = p_incident_id
  returning * into v_incident;

  if v_incident.id is null then
    raise exception 'Incidencia no encontrada';
  end if;

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
    v_incident.reporter_id,
    v_user_id,
    'ride_incident_status_update',
    'Actualización de incidencia',
    'Tu incidencia ahora está en estado: ' || v_status,
    '/disputes',
    'ride_incident',
    v_incident.id::text,
    'normal',
    jsonb_build_object(
      'incidentId', v_incident.id,
      'status', v_status,
      'adminNotes', p_admin_notes
    )
  );

  return true;
end;
$$;

grant execute on function public.sw_report_ride_incident(text, text, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.sw_update_ride_incident_status(uuid, text, text) to authenticated;
grant execute on function public.sw_notify_admins_of_incident(uuid) to authenticated;

notify pgrst, 'reload schema';
