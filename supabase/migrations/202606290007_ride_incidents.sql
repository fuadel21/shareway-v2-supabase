-- ShareWay ride incidents / support tickets
-- Allows users to report ride problems and admins to review them.

create extension if not exists pgcrypto;

create table if not exists public.ride_incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id text,
  reporter_id uuid not null,
  reported_user_id uuid,
  category text not null default 'other',
  severity text not null default 'normal',
  title text not null,
  description text not null,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_incidents_status_check check (status in ('open', 'in_review', 'resolved', 'rejected')),
  constraint ride_incidents_severity_check check (severity in ('low', 'normal', 'high', 'critical'))
);

create index if not exists ride_incidents_reporter_idx on public.ride_incidents(reporter_id, created_at desc);
create index if not exists ride_incidents_status_idx on public.ride_incidents(status, created_at desc);
create index if not exists ride_incidents_ride_idx on public.ride_incidents(ride_id);

alter table public.ride_incidents enable row level security;

create or replace function public.sw_is_admin_safe()
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

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ride_incidents'
      and policyname = 'Users can create own incidents'
  ) then
    create policy "Users can create own incidents"
      on public.ride_incidents
      for insert
      to authenticated
      with check (reporter_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ride_incidents'
      and policyname = 'Users can read own incidents'
  ) then
    create policy "Users can read own incidents"
      on public.ride_incidents
      for select
      to authenticated
      using (reporter_id = auth.uid() or reported_user_id = auth.uid() or public.sw_is_admin_safe());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ride_incidents'
      and policyname = 'Admins can update incidents'
  ) then
    create policy "Admins can update incidents"
      on public.ride_incidents
      for update
      to authenticated
      using (public.sw_is_admin_safe())
      with check (public.sw_is_admin_safe());
  end if;
end $$;

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

create or replace function public.sw_submit_ride_incident(
  p_ride_id text,
  p_category text,
  p_title text,
  p_description text,
  p_reported_user_id uuid default null,
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
  v_title text;
  v_description text;
  v_category text;
  v_severity text;
  v_admin record;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  v_title := trim(coalesce(p_title, ''));
  v_description := trim(coalesce(p_description, ''));
  v_category := lower(trim(coalesce(p_category, 'other')));
  v_severity := lower(trim(coalesce(p_severity, 'normal')));

  if v_title = '' then
    raise exception 'El título de la incidencia es obligatorio';
  end if;

  if v_description = '' then
    raise exception 'La descripción de la incidencia es obligatoria';
  end if;

  if v_severity not in ('low', 'normal', 'high', 'critical') then
    v_severity := 'normal';
  end if;

  insert into public.ride_incidents (
    ride_id,
    reporter_id,
    reported_user_id,
    category,
    severity,
    title,
    description,
    metadata
  ) values (
    nullif(trim(coalesce(p_ride_id, '')), ''),
    v_user_id,
    p_reported_user_id,
    v_category,
    v_severity,
    left(v_title, 160),
    left(v_description, 3000),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_incident_id;

  if to_regclass('public.notifications') is not null then
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
        'ride_incident_created',
        'Nueva incidencia de viaje',
        'Un usuario ha reportado una incidencia: ' || left(v_title, 120),
        '/admin/incidents',
        'ride_incident',
        v_incident_id::text,
        case when v_severity in ('high', 'critical') then 'high' else 'normal' end,
        jsonb_build_object(
          'incidentId', v_incident_id,
          'rideId', p_ride_id,
          'category', v_category,
          'severity', v_severity,
          'reporterId', v_user_id,
          'reportedUserId', p_reported_user_id
        )
      );
    end loop;
  end if;

  return v_incident_id;
end;
$$;

create or replace function public.sw_get_my_ride_incidents(p_limit integer default 50)
returns table (
  id uuid,
  ride_id text,
  reporter_id uuid,
  reported_user_id uuid,
  category text,
  severity text,
  title text,
  description text,
  status text,
  resolution_note text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.ride_id,
    i.reporter_id,
    i.reported_user_id,
    i.category,
    i.severity,
    i.title,
    i.description,
    i.status,
    i.resolution_note,
    i.created_at,
    i.updated_at,
    i.resolved_at
  from public.ride_incidents i
  where i.reporter_id = auth.uid()
     or i.reported_user_id = auth.uid()
     or public.sw_is_admin_safe()
  order by i.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.sw_admin_get_ride_incidents(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  ride_id text,
  reporter_id uuid,
  reported_user_id uuid,
  category text,
  severity text,
  title text,
  description text,
  status text,
  resolution_note text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sw_is_admin_safe() then
    raise exception 'No autorizado';
  end if;

  return query
  select
    i.id,
    i.ride_id,
    i.reporter_id,
    i.reported_user_id,
    i.category,
    i.severity,
    i.title,
    i.description,
    i.status,
    i.resolution_note,
    i.created_at,
    i.updated_at,
    i.resolved_at
  from public.ride_incidents i
  where p_status is null or p_status = '' or i.status = p_status
  order by
    case i.severity when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    i.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.sw_admin_update_ride_incident_status(
  p_incident_id uuid,
  p_status text,
  p_resolution_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_incident record;
begin
  if not public.sw_is_admin_safe() then
    raise exception 'No autorizado';
  end if;

  if v_status not in ('open', 'in_review', 'resolved', 'rejected') then
    raise exception 'Estado de incidencia inválido';
  end if;

  update public.ride_incidents
  set
    status = v_status,
    resolution_note = case when p_resolution_note is not null then left(trim(p_resolution_note), 2000) else resolution_note end,
    resolved_by = case when v_status in ('resolved', 'rejected') then auth.uid() else resolved_by end,
    resolved_at = case when v_status in ('resolved', 'rejected') then now() else null end
  where id = p_incident_id
  returning * into v_incident;

  if v_incident.id is null then
    raise exception 'Incidencia no encontrada';
  end if;

  if to_regclass('public.notifications') is not null and v_incident.reporter_id is not null then
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
      auth.uid(),
      'ride_incident_updated',
      'Incidencia actualizada',
      'El estado de tu incidencia ahora es: ' || v_status,
      '/disputes',
      'ride_incident',
      v_incident.id::text,
      'normal',
      jsonb_build_object(
        'incidentId', v_incident.id,
        'rideId', v_incident.ride_id,
        'status', v_status
      )
    );
  end if;

  return true;
end;
$$;

grant execute on function public.sw_submit_ride_incident(text, text, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.sw_get_my_ride_incidents(integer) to authenticated;
grant execute on function public.sw_admin_get_ride_incidents(text, integer) to authenticated;
grant execute on function public.sw_admin_update_ride_incident_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
