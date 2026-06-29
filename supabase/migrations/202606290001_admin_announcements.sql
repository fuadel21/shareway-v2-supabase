-- ShareWay admin announcements RPCs
-- Allows admins to send notification records to users/segments from the admin panel.

create extension if not exists pgcrypto;

create table if not exists public.admin_announcement_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_id uuid references auth.users(id) on delete set null,
  title text not null,
  message text not null,
  action_url text not null default '/notifications',
  target text not null default 'all',
  target_user_id uuid,
  city text,
  priority text not null default 'normal',
  sent_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists admin_announcement_logs_created_idx
on public.admin_announcement_logs (created_at desc);

alter table public.admin_announcement_logs enable row level security;

drop policy if exists "Admins can read announcement logs" on public.admin_announcement_logs;
create policy "Admins can read announcement logs"
on public.admin_announcement_logs
for select
to authenticated
using (public.is_current_user_admin());

create or replace function public.sw_get_admin_announcement_history(p_limit integer default 20)
returns table (
  id uuid,
  created_at timestamptz,
  admin_id uuid,
  title text,
  message text,
  action_url text,
  target text,
  target_user_id uuid,
  city text,
  priority text,
  sent_count integer,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'No autorizado';
  end if;

  return query
  select
    l.id,
    l.created_at,
    l.admin_id,
    l.title,
    l.message,
    l.action_url,
    l.target,
    l.target_user_id,
    l.city,
    l.priority,
    l.sent_count,
    l.metadata
  from public.admin_announcement_logs l
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

create or replace function public.sw_send_admin_announcement_v2(
  p_title text,
  p_message text,
  p_action_url text default '/notifications',
  p_target text default 'all',
  p_user_id uuid default null,
  p_city text default null,
  p_priority text default 'normal'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target text := lower(coalesce(nullif(trim(p_target), ''), 'all'));
  v_priority text := lower(coalesce(nullif(trim(p_priority), ''), 'normal'));
  v_action_url text := coalesce(nullif(trim(p_action_url), ''), '/notifications');
  v_title text := left(trim(coalesce(p_title, '')), 90);
  v_message text := left(trim(coalesce(p_message, '')), 500);
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_log_id uuid;
  v_sent_count integer := 0;
  v_has_role boolean := false;
  v_has_city boolean := false;
  v_has_is_driver boolean := false;
  v_has_is_passenger boolean := false;
  v_sql text;
  v_user record;
begin
  if not public.is_current_user_admin() then
    raise exception 'No autorizado';
  end if;

  if v_title = '' then
    raise exception 'El título es obligatorio';
  end if;

  if v_message = '' then
    raise exception 'El mensaje es obligatorio';
  end if;

  if v_priority not in ('low', 'normal', 'high', 'critical') then
    v_priority := 'normal';
  end if;

  if v_target not in ('all', 'drivers', 'passengers', 'city', 'single') then
    v_target := 'all';
  end if;

  if v_target = 'single' and p_user_id is null then
    raise exception 'Falta user_id para envío individual';
  end if;

  if v_target = 'city' and v_city is null then
    raise exception 'Falta ciudad para envío por ciudad';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) into v_has_role;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'city'
  ) into v_has_city;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_driver'
  ) into v_has_is_driver;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_passenger'
  ) into v_has_is_passenger;

  insert into public.admin_announcement_logs (
    admin_id,
    title,
    message,
    action_url,
    target,
    target_user_id,
    city,
    priority,
    metadata
  ) values (
    v_admin_id,
    v_title,
    v_message,
    v_action_url,
    v_target,
    p_user_id,
    v_city,
    v_priority,
    jsonb_build_object('createdBy', v_admin_id, 'target', v_target)
  )
  returning id into v_log_id;

  if v_target = 'single' then
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
      p_user_id,
      v_admin_id,
      'admin_announcement',
      v_title,
      v_message,
      v_action_url,
      'admin_announcement',
      v_log_id::text,
      v_priority,
      jsonb_build_object('announcementId', v_log_id, 'target', v_target)
    );

    v_sent_count := 1;
  else
    v_sql := 'select id from public.profiles where id is not null';

    if v_target = 'city' then
      if v_has_city then
        v_sql := v_sql || ' and lower(coalesce(city::text, '''')) = lower($1)';
      else
        raise exception 'La tabla profiles no tiene columna city';
      end if;
    elsif v_target = 'drivers' then
      if v_has_role and v_has_is_driver then
        v_sql := v_sql || ' and (lower(coalesce(role::text, '''')) in (''driver'', ''conductor'', ''admin'', ''super_admin'') or coalesce(is_driver, false) = true)';
      elsif v_has_role then
        v_sql := v_sql || ' and lower(coalesce(role::text, '''')) in (''driver'', ''conductor'', ''admin'', ''super_admin'')';
      elsif v_has_is_driver then
        v_sql := v_sql || ' and coalesce(is_driver, false) = true';
      else
        raise exception 'No hay columna role ni is_driver para segmentar conductores';
      end if;
    elsif v_target = 'passengers' then
      if v_has_role and v_has_is_passenger then
        v_sql := v_sql || ' and (lower(coalesce(role::text, '''')) in (''passenger'', ''pasajero'', ''user'', ''usuario'') or coalesce(is_passenger, false) = true)';
      elsif v_has_role then
        v_sql := v_sql || ' and lower(coalesce(role::text, '''')) in (''passenger'', ''pasajero'', ''user'', ''usuario'')';
      elsif v_has_is_passenger then
        v_sql := v_sql || ' and coalesce(is_passenger, false) = true';
      else
        -- Fallback: si no existe segmento explícito de pasajeros, enviamos a todos los usuarios no filtrados.
        v_sql := v_sql;
      end if;
    end if;

    if v_target = 'city' then
      for v_user in execute v_sql using v_city loop
        insert into public.notifications (
          user_id, actor_id, type, title, message, action_url, entity_type, entity_id, priority, metadata
        ) values (
          v_user.id, v_admin_id, 'admin_announcement', v_title, v_message, v_action_url,
          'admin_announcement', v_log_id::text, v_priority,
          jsonb_build_object('announcementId', v_log_id, 'target', v_target, 'city', v_city)
        );
        v_sent_count := v_sent_count + 1;
      end loop;
    else
      for v_user in execute v_sql loop
        insert into public.notifications (
          user_id, actor_id, type, title, message, action_url, entity_type, entity_id, priority, metadata
        ) values (
          v_user.id, v_admin_id, 'admin_announcement', v_title, v_message, v_action_url,
          'admin_announcement', v_log_id::text, v_priority,
          jsonb_build_object('announcementId', v_log_id, 'target', v_target)
        );
        v_sent_count := v_sent_count + 1;
      end loop;
    end if;
  end if;

  update public.admin_announcement_logs
  set sent_count = v_sent_count,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('sentCount', v_sent_count)
  where id = v_log_id;

  return v_sent_count;
end;
$$;

grant execute on function public.sw_send_admin_announcement_v2(text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.sw_get_admin_announcement_history(integer) to authenticated;
