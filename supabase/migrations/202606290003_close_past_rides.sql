-- ShareWay automatic past ride closure
-- Marks old active rides as completed/finished and notifies the driver.

create or replace function public.sw_close_past_rides(
  p_grace_minutes integer default 120,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_status boolean := false;
  v_has_updated_at boolean := false;
  v_has_completed_at boolean := false;
  v_has_finished_at boolean := false;
  v_has_origin boolean := false;
  v_has_destination boolean := false;
  v_origin_col text;
  v_destination_col text;
  v_sql text;
  v_update_sql text;
  v_ride record;
  v_count integer := 0;
  v_target_status text := 'completed';
  v_message text;
  v_key text;
begin
  if to_regclass('public.rides') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name in ('id', 'driver_id', 'departure_time')
    group by table_name
    having count(*) = 3
  ) then
    raise warning '[close_past_rides] rides needs id, driver_id and departure_time';
    return 0;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'status'
  ) into v_has_status;

  if not v_has_status then
    raise warning '[close_past_rides] rides.status does not exist, nothing updated';
    return 0;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'updated_at'
  ) into v_has_updated_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'completed_at'
  ) into v_has_completed_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'finished_at'
  ) into v_has_finished_at;

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

  p_grace_minutes := greatest(10, least(coalesce(p_grace_minutes, 120), 10080));
  p_limit := greatest(1, least(coalesce(p_limit, 100), 1000));

  v_sql := 'select id::text as ride_id, driver_id::uuid as driver_id, departure_time::timestamptz as departure_time, coalesce(status::text, '''') as status_text';

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

  v_sql := v_sql || '
    from public.rides
    where departure_time is not null
      and departure_time < now() - ($1 * interval ''1 minute'')
      and lower(coalesce(status::text, '''')) not in (
        ''completed'', ''finished'', ''cancelled'', ''canceled'', ''expired'', ''archived''
      )
    order by departure_time asc
    limit $2
  ';

  for v_ride in execute v_sql using p_grace_minutes, p_limit loop
    v_update_sql := 'update public.rides set status = $1';

    if v_has_updated_at then
      v_update_sql := v_update_sql || ', updated_at = now()';
    end if;

    if v_has_completed_at then
      v_update_sql := v_update_sql || ', completed_at = coalesce(completed_at, now())';
    elsif v_has_finished_at then
      v_update_sql := v_update_sql || ', finished_at = coalesce(finished_at, now())';
    end if;

    v_update_sql := v_update_sql || ' where id::text = $2';

    execute v_update_sql using v_target_status, v_ride.ride_id;

    v_count := v_count + 1;

    if v_ride.driver_id is not null then
      v_key := 'ride:' || v_ride.ride_id || ':auto_closed';

      if not exists (
        select 1 from public.notifications
        where user_id = v_ride.driver_id
          and type = 'ride_auto_closed'
          and entity_type = 'ride'
          and entity_id = v_ride.ride_id
          and metadata->>'automationKey' = v_key
      ) then
        v_message := 'Hemos marcado tu viaje como completado porque la hora de salida ya pasó.';

        if coalesce(v_ride.origin_text, '') <> '' or coalesce(v_ride.destination_text, '') <> '' then
          v_message := v_message || ' Ruta:';
          if coalesce(v_ride.origin_text, '') <> '' then
            v_message := v_message || ' ' || v_ride.origin_text;
          end if;
          if coalesce(v_ride.destination_text, '') <> '' then
            v_message := v_message || ' → ' || v_ride.destination_text;
          end if;
          v_message := v_message || '.';
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
          v_ride.driver_id,
          null,
          'ride_auto_closed',
          'Viaje completado automáticamente',
          v_message,
          '/ride/' || v_ride.ride_id,
          'ride',
          v_ride.ride_id,
          'normal',
          jsonb_build_object(
            'rideId', v_ride.ride_id,
            'departureTime', v_ride.departure_time,
            'previousStatus', v_ride.status_text,
            'newStatus', v_target_status,
            'graceMinutes', p_grace_minutes,
            'automationKey', v_key
          )
        );
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.sw_close_past_rides(integer, integer) to authenticated;
grant execute on function public.sw_close_past_rides(integer, integer) to anon;

-- Compatibility alias for manual runs.
create or replace function public.sw_complete_old_rides()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.sw_close_past_rides(120, 100);
$$;

grant execute on function public.sw_complete_old_rides() to authenticated;
grant execute on function public.sw_complete_old_rides() to anon;

-- Optional pg_cron scheduling. Skips safely if cron is unavailable.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  null;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('shareway_close_past_rides');
    perform cron.schedule(
      'shareway_close_past_rides',
      '*/15 * * * *',
      'select public.sw_close_past_rides(120, 100);'
    );
  end if;
exception when others then
  raise warning '[close_past_rides] cron schedule skipped: %', sqlerrm;
end $$;
