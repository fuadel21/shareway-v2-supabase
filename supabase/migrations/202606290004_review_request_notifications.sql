-- ShareWay review request notifications
-- Sends review reminders to driver and passengers when a ride is completed.

create or replace function public.sw_review_notification_exists(p_user_id uuid, p_key text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.type = 'review_request'
      and n.metadata->>'automationKey' = p_key
  );
$$;

create or replace function public.sw_send_review_requests_for_table(
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
  v_passenger_key text;
  v_driver_key text;
  v_route_text text := '';
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return v_notified_users;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return v_notified_users;
  end if;

  select column_name into v_user_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table_name
    and column_name in ('passenger_id', 'user_id', 'requester_id', 'profile_id')
  order by array_position(array['passenger_id', 'user_id', 'requester_id', 'profile_id'], column_name)
  limit 1;

  select column_name into v_ride_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table_name
    and column_name in ('ride_id', 'trip_id')
  order by array_position(array['ride_id', 'trip_id'], column_name)
  limit 1;

  select column_name into v_status_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table_name
    and column_name in ('status', 'booking_status')
  order by array_position(array['status', 'booking_status'], column_name)
  limit 1;

  if v_user_column is null or v_ride_column is null then
    return v_notified_users;
  end if;

  if coalesce(p_origin, '') <> '' or coalesce(p_destination, '') <> '' then
    v_route_text := ' Ruta:';
    if coalesce(p_origin, '') <> '' then
      v_route_text := v_route_text || ' ' || p_origin;
    end if;
    if coalesce(p_destination, '') <> '' then
      v_route_text := v_route_text || ' → ' || p_destination;
    end if;
    v_route_text := v_route_text || '.';
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

      -- Passenger rates driver.
      v_passenger_key := 'review:ride:' || p_ride_id || ':reviewer:' || v_passenger.user_id::text || ':reviewee:' || p_driver_id::text;

      if not public.sw_review_notification_exists(v_passenger.user_id, v_passenger_key) then
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
          v_passenger.user_id,
          p_driver_id,
          'review_request',
          'Valora tu viaje',
          'Tu viaje ha finalizado. Ayuda a la comunidad valorando al conductor.' || v_route_text,
          '/leave-review/' || p_ride_id || '/' || p_driver_id::text,
          'ride',
          p_ride_id,
          'normal',
          jsonb_build_object(
            'rideId', p_ride_id,
            'reviewerId', v_passenger.user_id,
            'revieweeId', p_driver_id,
            'reviewerRole', 'passenger',
            'automationKey', v_passenger_key
          )
        );
      end if;

      -- Driver rates passenger.
      v_driver_key := 'review:ride:' || p_ride_id || ':reviewer:' || p_driver_id::text || ':reviewee:' || v_passenger.user_id::text;

      if p_driver_id is not null and not public.sw_review_notification_exists(p_driver_id, v_driver_key) then
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
          p_driver_id,
          v_passenger.user_id,
          'review_request',
          'Valora a tu pasajero',
          'El viaje ha finalizado. Puedes valorar al pasajero para mejorar la confianza en ShareWay.' || v_route_text,
          '/leave-review/' || p_ride_id || '/' || v_passenger.user_id::text,
          'ride',
          p_ride_id,
          'normal',
          jsonb_build_object(
            'rideId', p_ride_id,
            'reviewerId', p_driver_id,
            'revieweeId', v_passenger.user_id,
            'reviewerRole', 'driver',
            'automationKey', v_driver_key
          )
        );
      end if;

      v_notified_users := array_append(v_notified_users, v_passenger.user_id);
    end if;
  end loop;

  return v_notified_users;
exception when others then
  raise warning '[review_requests] skipped table %: %', p_table_name, sqlerrm;
  return v_notified_users;
end;
$$;

create or replace function public.sw_send_review_requests_for_ride(p_ride_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
  v_origin_col text;
  v_destination_col text;
  v_sql text;
  v_notified uuid[] := '{}'::uuid[];
  v_count_before integer := 0;
  v_count_after integer := 0;
begin
  if to_regclass('public.rides') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name in ('id', 'driver_id')
    group by table_name
    having count(*) = 2
  ) then
    return 0;
  end if;

  select column_name into v_origin_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rides'
    and column_name in ('origin_address', 'origin', 'from_address')
  order by array_position(array['origin_address', 'origin', 'from_address'], column_name)
  limit 1;

  select column_name into v_destination_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rides'
    and column_name in ('destination_address', 'destination', 'to_address')
  order by array_position(array['destination_address', 'destination', 'to_address'], column_name)
  limit 1;

  v_sql := 'select id::text as ride_id, driver_id::uuid as driver_id';

  if v_origin_col is not null then
    v_sql := v_sql || format(', coalesce(%I::text, '''') as origin_text', v_origin_col);
  else
    v_sql := v_sql || ', ''''::text as origin_text';
  end if;

  if v_destination_col is not null then
    v_sql := v_sql || format(', coalesce(%I::text, '''') as destination_text', v_destination_col);
  else
    v_sql := v_sql || ', ''''::text as destination_text';
  end if;

  v_sql := v_sql || ' from public.rides where id::text = $1 limit 1';

  execute v_sql into v_ride using p_ride_id;

  if v_ride.ride_id is null or v_ride.driver_id is null then
    return 0;
  end if;

  select count(*) into v_count_before
  from public.notifications
  where type = 'review_request'
    and entity_type = 'ride'
    and entity_id = p_ride_id;

  v_notified := public.sw_send_review_requests_for_table(
    'ride_passengers',
    v_ride.ride_id,
    v_ride.driver_id,
    v_ride.origin_text,
    v_ride.destination_text,
    v_notified
  );

  v_notified := public.sw_send_review_requests_for_table(
    'bookings',
    v_ride.ride_id,
    v_ride.driver_id,
    v_ride.origin_text,
    v_ride.destination_text,
    v_notified
  );

  select count(*) into v_count_after
  from public.notifications
  where type = 'review_request'
    and entity_type = 'ride'
    and entity_id = p_ride_id;

  return greatest(0, v_count_after - v_count_before);
end;
$$;

create or replace function public.sw_notify_review_requests_on_ride_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text := lower(coalesce(old.status::text, ''));
  v_new_status text := lower(coalesce(new.status::text, ''));
begin
  if v_new_status in ('completed', 'finished')
     and v_old_status not in ('completed', 'finished') then
    perform public.sw_send_review_requests_for_ride(new.id::text);
  end if;

  return new;
exception when others then
  raise warning '[review_requests] trigger skipped: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists rides_review_requests_after_completed on public.rides;
create trigger rides_review_requests_after_completed
after update of status on public.rides
for each row
execute function public.sw_notify_review_requests_on_ride_completed();

create or replace function public.sw_send_missing_review_requests(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_status boolean := false;
  v_sql text;
  v_ride record;
  v_total integer := 0;
begin
  if to_regclass('public.rides') is null then
    return 0;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name = 'status'
  ) into v_has_status;

  if not v_has_status then
    return 0;
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 100), 1000));

  v_sql := '
    select id::text as ride_id
    from public.rides r
    where lower(coalesce(r.status::text, '''')) in (''completed'', ''finished'')
      and not exists (
        select 1
        from public.notifications n
        where n.type = ''review_request''
          and n.entity_type = ''ride''
          and n.entity_id = r.id::text
      )
    order by r.departure_time desc nulls last
    limit $1
  ';

  for v_ride in execute v_sql using p_limit loop
    v_total := v_total + public.sw_send_review_requests_for_ride(v_ride.ride_id);
  end loop;

  return v_total;
end;
$$;

grant execute on function public.sw_send_review_requests_for_ride(text) to authenticated;
grant execute on function public.sw_send_missing_review_requests(integer) to authenticated;
grant execute on function public.sw_send_review_requests_for_ride(text) to anon;
grant execute on function public.sw_send_missing_review_requests(integer) to anon;

notify pgrst, 'reload schema';
