-- ShareWay trip reminders
-- Creates reminder notifications for drivers and passengers shortly before departure.

create or replace function public.sw_column_exists(p_table_name text, p_column_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table_name
      and column_name = p_column_name
  );
$$;

create or replace function public.sw_first_existing_column(p_table_name text, p_columns text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_column text;
begin
  foreach v_column in array p_columns loop
    if public.sw_column_exists(p_table_name, v_column) then
      return v_column;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.sw_notification_exists(
  p_user_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id text,
  p_reminder_key text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.type = p_type
      and n.entity_type = p_entity_type
      and n.entity_id = p_entity_id
      and n.metadata->>'reminderKey' = p_reminder_key
  );
$$;

create or replace function public.sw_create_passenger_reminders_for_table(
  p_table_name text,
  p_ride_id text,
  p_driver_id uuid,
  p_departure_time timestamptz,
  p_origin text,
  p_destination text,
  p_minutes_before integer,
  p_notified_users uuid[] default '{}'::uuid[]
)
returns uuid[]
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
  v_notified_users uuid[] := coalesce(p_notified_users, '{}'::uuid[]);
  v_reminder_key text;
  v_message text;
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return v_notified_users;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return v_notified_users;
  end if;

  v_user_column := public.sw_first_existing_column(p_table_name, array['passenger_id', 'user_id', 'requester_id', 'profile_id']);
  v_ride_column := public.sw_first_existing_column(p_table_name, array['ride_id', 'trip_id']);
  v_status_column := public.sw_first_existing_column(p_table_name, array['status', 'booking_status']);

  if v_user_column is null or v_ride_column is null then
    return v_notified_users;
  end if;

  v_sql := format(
    'select distinct %1$I::uuid as user_id from public.%2$I where %3$I::text = $1 and %1$I is not null',
    v_user_column,
    p_table_name,
    v_ride_column
  );

  if v_status_column is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'')',
      v_status_column
    );
  end if;

  for v_passenger in execute v_sql using p_ride_id loop
    if v_passenger.user_id is not null
       and v_passenger.user_id <> p_driver_id
       and not (v_passenger.user_id = any(v_notified_users)) then

      v_reminder_key := 'ride:' || p_ride_id || ':' || p_minutes_before::text || 'm:passenger';

      if not public.sw_notification_exists(
        v_passenger.user_id,
        'ride_reminder',
        'ride',
        p_ride_id,
        v_reminder_key
      ) then
        v_message := 'Tu viaje sale en aproximadamente ' || p_minutes_before::text || ' minutos';
        if coalesce(p_origin, '') <> '' then
          v_message := v_message || ' desde ' || p_origin;
        end if;
        if coalesce(p_destination, '') <> '' then
          v_message := v_message || ' hacia ' || p_destination;
        end if;
        v_message := v_message || '.';

        perform public.create_system_notification(
          v_passenger.user_id,
          p_driver_id,
          'ride_reminder',
          'Tu viaje sale pronto',
          v_message,
          '/ride/' || p_ride_id,
          'ride',
          p_ride_id,
          'high',
          jsonb_build_object(
            'rideId', p_ride_id,
            'driverId', p_driver_id,
            'departureTime', p_departure_time,
            'minutesBefore', p_minutes_before,
            'reminderKey', v_reminder_key,
            'recipientRole', 'passenger'
          )
        );
      end if;

      v_notified_users := array_append(v_notified_users, v_passenger.user_id);
    end if;
  end loop;

  return v_notified_users;
exception when others then
  raise warning '[reminders] passenger reminder skipped for %: %', p_table_name, sqlerrm;
  return v_notified_users;
end;
$$;

create or replace function public.sw_create_trip_reminders(
  p_minutes_before integer default 60,
  p_window_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_rides boolean := false;
  v_has_id boolean := false;
  v_has_driver_id boolean := false;
  v_has_departure_time boolean := false;
  v_has_status boolean := false;
  v_has_origin_address boolean := false;
  v_has_destination_address boolean := false;
  v_sql text;
  v_ride record;
  v_count integer := 0;
  v_reminder_key text;
  v_message text;
  v_notified_users uuid[];
begin
  select to_regclass('public.rides') is not null into v_has_rides;
  if not v_has_rides then
    return 0;
  end if;

  select public.sw_column_exists('rides', 'id') into v_has_id;
  select public.sw_column_exists('rides', 'driver_id') into v_has_driver_id;
  select public.sw_column_exists('rides', 'departure_time') into v_has_departure_time;
  select public.sw_column_exists('rides', 'status') into v_has_status;
  select public.sw_column_exists('rides', 'origin_address') into v_has_origin_address;
  select public.sw_column_exists('rides', 'destination_address') into v_has_destination_address;

  if not (v_has_id and v_has_driver_id and v_has_departure_time) then
    raise warning '[reminders] rides table missing id, driver_id or departure_time';
    return 0;
  end if;

  p_minutes_before := greatest(5, least(coalesce(p_minutes_before, 60), 1440));
  p_window_minutes := greatest(1, least(coalesce(p_window_minutes, 10), 120));

  v_sql := 'select id::text as ride_id, driver_id::uuid as driver_id, departure_time::timestamptz as departure_time';

  if v_has_origin_address then
    v_sql := v_sql || ', coalesce(origin_address::text, '''') as origin_address';
  else
    v_sql := v_sql || ', ''''::text as origin_address';
  end if;

  if v_has_destination_address then
    v_sql := v_sql || ', coalesce(destination_address::text, '''') as destination_address';
  else
    v_sql := v_sql || ', ''''::text as destination_address';
  end if;

  v_sql := v_sql || ' from public.rides where departure_time is not null and departure_time >= (now() + make_interval(mins => $1)) and departure_time < (now() + make_interval(mins => $1 + $2))';

  if v_has_status then
    v_sql := v_sql || ' and lower(coalesce(status::text, '''')) not in (''cancelled'', ''canceled'', ''completed'', ''finished'')';
  end if;

  for v_ride in execute v_sql using p_minutes_before, p_window_minutes loop
    if v_ride.driver_id is not null then
      v_reminder_key := 'ride:' || v_ride.ride_id || ':' || p_minutes_before::text || 'm:driver';

      if not public.sw_notification_exists(
        v_ride.driver_id,
        'ride_reminder',
        'ride',
        v_ride.ride_id,
        v_reminder_key
      ) then
        v_message := 'Tu viaje sale en aproximadamente ' || p_minutes_before::text || ' minutos';
        if coalesce(v_ride.origin_address, '') <> '' then
          v_message := v_message || ' desde ' || v_ride.origin_address;
        end if;
        if coalesce(v_ride.destination_address, '') <> '' then
          v_message := v_message || ' hacia ' || v_ride.destination_address;
        end if;
        v_message := v_message || '.';

        perform public.create_system_notification(
          v_ride.driver_id,
          null,
          'ride_reminder',
          'Tu viaje sale pronto',
          v_message,
          '/ride/' || v_ride.ride_id,
          'ride',
          v_ride.ride_id,
          'high',
          jsonb_build_object(
            'rideId', v_ride.ride_id,
            'departureTime', v_ride.departure_time,
            'minutesBefore', p_minutes_before,
            'reminderKey', v_reminder_key,
            'recipientRole', 'driver'
          )
        );

        v_count := v_count + 1;
      end if;
    end if;

    v_notified_users := '{}'::uuid[];
    v_notified_users := public.sw_create_passenger_reminders_for_table(
      'ride_passengers',
      v_ride.ride_id,
      v_ride.driver_id,
      v_ride.departure_time,
      v_ride.origin_address,
      v_ride.destination_address,
      p_minutes_before,
      v_notified_users
    );

    v_notified_users := public.sw_create_passenger_reminders_for_table(
      'bookings',
      v_ride.ride_id,
      v_ride.driver_id,
      v_ride.departure_time,
      v_ride.origin_address,
      v_ride.destination_address,
      p_minutes_before,
      v_notified_users
    );

    v_count := v_count + coalesce(array_length(v_notified_users, 1), 0);
  end loop;

  return v_count;
end;
$$;

grant execute on function public.sw_create_trip_reminders(integer, integer) to authenticated;

-- Optional scheduling. If pg_cron is enabled in the project, this schedules a check every 5 minutes.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('shareway_trip_reminders_60m');
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'shareway_trip_reminders_60m',
      '*/5 * * * *',
      'select public.sw_create_trip_reminders(60, 10);'
    );
  end if;
exception when others then
  raise warning '[reminders] cron schedule skipped: %', sqlerrm;
end $$;
