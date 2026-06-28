-- ShareWay notification trigger compatibility repair v1
-- Makes ride cancellation notifications resilient to different passenger/booking table schemas.

create or replace function public.column_exists(p_table_name text, p_column_name text)
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

create or replace function public.first_existing_column(p_table_name text, p_columns text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_column text;
begin
  foreach v_column in array p_columns loop
    if public.column_exists(p_table_name, v_column) then
      return v_column;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.notify_ride_cancelled_for_table(
  p_table_name text,
  p_ride_id text,
  p_driver_id uuid,
  p_origin text,
  p_destination text,
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
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return v_notified_users;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return v_notified_users;
  end if;

  v_user_column := public.first_existing_column(p_table_name, array['passenger_id', 'user_id', 'requester_id', 'profile_id']);
  v_ride_column := public.first_existing_column(p_table_name, array['ride_id', 'trip_id']);
  v_status_column := public.first_existing_column(p_table_name, array['status', 'booking_status']);

  if v_user_column is null or v_ride_column is null then
    raise warning '[notifications] % skipped: missing user or ride column', p_table_name;
    return v_notified_users;
  end if;

  v_sql := format(
    'select distinct %1$I::uuid as user_id from public.%2$I where %3$I::text = $1 and %1$I is not null',
    v_user_column,
    p_table_name,
    v_ride_column
  );

  if v_status_column is not null then
    v_sql := v_sql || format(' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'')', v_status_column);
  end if;

  for v_passenger in execute v_sql using p_ride_id loop
    if v_passenger.user_id is not null
       and v_passenger.user_id <> p_driver_id
       and not (v_passenger.user_id = any(v_notified_users)) then
      perform public.create_system_notification(
        v_passenger.user_id,
        p_driver_id,
        'ride_cancelled',
        'Viaje cancelado',
        'Se ha cancelado el viaje ' || coalesce(p_origin, '') || case when coalesce(p_destination, '') <> '' then ' → ' || p_destination else '' end || '.',
        '/ride/' || p_ride_id,
        'ride',
        p_ride_id,
        'critical',
        jsonb_build_object('driverId', p_driver_id, 'rideId', p_ride_id, 'origin', p_origin, 'destination', p_destination)
      );

      v_notified_users := array_append(v_notified_users, v_passenger.user_id);
    end if;
  end loop;

  return v_notified_users;
exception when others then
  raise warning '[notifications] % cancellation notifier skipped: %', p_table_name, sqlerrm;
  return v_notified_users;
end;
$$;

create or replace function public.notify_ride_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_old_payload jsonb := coalesce(to_jsonb(old), '{}'::jsonb);
  v_ride_id text := v_payload->>'id';
  v_driver_id uuid := nullif(v_payload->>'driver_id', '')::uuid;
  v_origin text := coalesce(v_payload->>'origin_address', v_payload#>>'{origin,address}', '');
  v_destination text := coalesce(v_payload->>'destination_address', v_payload#>>'{destination,address}', '');
  v_status text := lower(coalesce(v_payload->>'status', ''));
  v_old_status text := lower(coalesce(v_old_payload->>'status', ''));
  v_notified_users uuid[] := '{}'::uuid[];
begin
  if tg_op <> 'UPDATE' or v_status <> 'cancelled' or v_old_status = 'cancelled' then
    return new;
  end if;

  v_notified_users := public.notify_ride_cancelled_for_table(
    'ride_passengers',
    v_ride_id,
    v_driver_id,
    v_origin,
    v_destination,
    v_notified_users
  );

  v_notified_users := public.notify_ride_cancelled_for_table(
    'bookings',
    v_ride_id,
    v_driver_id,
    v_origin,
    v_destination,
    v_notified_users
  );

  return new;
exception when others then
  raise warning '[notifications] ride cancellation trigger skipped: %', sqlerrm;
  return new;
end;
$$;

-- Keep helper functions internal.
revoke all on function public.column_exists(text, text) from public, anon, authenticated;
revoke all on function public.first_existing_column(text, text[]) from public, anon, authenticated;
revoke all on function public.notify_ride_cancelled_for_table(text, text, uuid, text, text, uuid[]) from public, anon, authenticated;
