-- ShareWay automatic ride reminder notifications
-- Sends in-app notifications 60 and 15 minutes before scheduled rides.
-- Existing notification insert triggers can forward these records to push.

create extension if not exists pgcrypto;

create or replace function public.sw_first_existing_column_local(p_table_name text, p_columns text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_column text;
begin
  foreach v_column in array p_columns loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = p_table_name
        and column_name = v_column
    ) then
      return v_column;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.sw_insert_ride_reminder_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_ride_id text,
  p_bucket text,
  p_role text,
  p_title text,
  p_message text,
  p_priority text default 'high'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id text := p_ride_id || ':' || p_role || ':' || p_bucket;
begin
  if p_user_id is null or p_ride_id is null or p_bucket is null then
    return false;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.entity_type = 'ride_reminder'
      and n.entity_id = v_entity_id
    limit 1
  ) then
    return false;
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
    p_user_id,
    p_actor_id,
    'ride_reminder',
    p_title,
    p_message,
    '/rides/' || p_ride_id,
    'ride_reminder',
    v_entity_id,
    coalesce(p_priority, 'high'),
    jsonb_build_object(
      'rideId', p_ride_id,
      'bucket', p_bucket,
      'role', p_role
    )
  );

  return true;
end;
$$;

create or replace function public.sw_notify_ride_passengers_for_reminder(
  p_table_name text,
  p_ride_id text,
  p_bucket text,
  p_driver_id uuid,
  p_origin text,
  p_destination text,
  p_title text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_column text;
  v_ride_column text;
  v_status_column text;
  v_sql text;
  v_passenger record;
  v_sent integer := 0;
  v_message text;
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return 0;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return 0;
  end if;

  v_user_column := public.sw_first_existing_column_local(p_table_name, array['passenger_id', 'user_id', 'requester_id', 'profile_id']);
  v_ride_column := public.sw_first_existing_column_local(p_table_name, array['ride_id', 'trip_id']);
  v_status_column := public.sw_first_existing_column_local(p_table_name, array['status', 'booking_status']);

  if v_user_column is null or v_ride_column is null then
    return 0;
  end if;

  v_sql := format(
    'select distinct %1$I::uuid as user_id from public.%2$I where %3$I::text = $1 and %1$I is not null',
    v_user_column,
    p_table_name,
    v_ride_column
  );

  if v_status_column is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) in (''confirmed'', ''accepted'', ''approved'', ''verified'', ''completed'')',
      v_status_column
    );
  end if;

  v_message := 'Recuerda estar preparado para tu viaje'
    || case when coalesce(p_origin, '') <> '' then ' desde ' || p_origin else '' end
    || case when coalesce(p_destination, '') <> '' then ' hacia ' || p_destination else '' end
    || '.';

  for v_passenger in execute v_sql using p_ride_id loop
    if v_passenger.user_id is not null and v_passenger.user_id <> p_driver_id then
      if public.sw_insert_ride_reminder_notification(
        v_passenger.user_id,
        p_driver_id,
        p_ride_id,
        p_bucket,
        'passenger',
        p_title,
        v_message,
        'high'
      ) then
        v_sent := v_sent + 1;
      end if;
    end if;
  end loop;

  return v_sent;
exception when others then
  raise warning '[ride_reminders] passenger notifier skipped for %: %', p_table_name, sqlerrm;
  return v_sent;
end;
$$;

create or replace function public.sw_send_ride_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
  v_payload jsonb;
  v_departure_time timestamptz;
  v_minutes_left integer;
  v_bucket text;
  v_title text;
  v_driver_id uuid;
  v_ride_id text;
  v_origin text;
  v_destination text;
  v_status text;
  v_sent integer := 0;
  v_message text;
begin
  if to_regclass('public.rides') is null then
    return 0;
  end if;

  for v_ride in execute '
    select *
    from public.rides
    where departure_time is not null
      and departure_time > now()
      and departure_time <= now() + interval ''70 minutes''
      and lower(coalesce(status::text, '''')) in (''scheduled'', ''active'', ''published'', ''open'')
  ' loop
    v_payload := to_jsonb(v_ride);
    v_ride_id := v_payload->>'id';
    v_driver_id := nullif(v_payload->>'driver_id', '')::uuid;
    v_departure_time := nullif(v_payload->>'departure_time', '')::timestamptz;
    v_status := lower(coalesce(v_payload->>'status', ''));
    v_origin := coalesce(v_payload->>'origin_address', v_payload#>>'{origin,address}', v_payload#>>'{origin,name}', '');
    v_destination := coalesce(v_payload->>'destination_address', v_payload#>>'{destination,address}', v_payload#>>'{destination,name}', '');

    if v_ride_id is null or v_departure_time is null then
      continue;
    end if;

    v_minutes_left := floor(extract(epoch from (v_departure_time - now())) / 60.0)::integer;
    v_bucket := null;

    if v_minutes_left between 55 and 65 then
      v_bucket := '60m';
      v_title := 'Tu viaje sale en 1 hora';
    elsif v_minutes_left between 10 and 20 then
      v_bucket := '15m';
      v_title := 'Tu viaje sale pronto';
    end if;

    if v_bucket is null then
      continue;
    end if;

    if v_driver_id is not null then
      v_message := 'Revisa los pasajeros y el punto de salida'
        || case when coalesce(v_origin, '') <> '' then ' desde ' || v_origin else '' end
        || case when coalesce(v_destination, '') <> '' then ' hacia ' || v_destination else '' end
        || '.';

      if public.sw_insert_ride_reminder_notification(
        v_driver_id,
        null,
        v_ride_id,
        v_bucket,
        'driver',
        v_title,
        v_message,
        'high'
      ) then
        v_sent := v_sent + 1;
      end if;
    end if;

    v_sent := v_sent + public.sw_notify_ride_passengers_for_reminder(
      'ride_passengers',
      v_ride_id,
      v_bucket,
      v_driver_id,
      v_origin,
      v_destination,
      v_title
    );

    v_sent := v_sent + public.sw_notify_ride_passengers_for_reminder(
      'bookings',
      v_ride_id,
      v_bucket,
      v_driver_id,
      v_origin,
      v_destination,
      v_title
    );
  end loop;

  return v_sent;
exception when others then
  raise warning '[ride_reminders] run skipped: %', sqlerrm;
  return v_sent;
end;
$$;

grant execute on function public.sw_send_ride_reminders() to authenticated;

-- Optional scheduler. Runs every 5 minutes when pg_cron is available.
create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in select jobid from cron.job where jobname = 'shareway-ride-reminders' loop
      perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
      'shareway-ride-reminders',
      '*/5 * * * *',
      'select public.sw_send_ride_reminders();'
    );
  end if;
exception when others then
  raise warning '[ride_reminders] cron schedule skipped: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
