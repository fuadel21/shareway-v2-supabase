-- ShareWay automatic expiration for past passenger requests
-- Marks old pending ride_requests as expired and notifies the requester.

create or replace function public.sw_expire_past_ride_requests(
  p_grace_minutes integer default 60,
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
  v_has_expired_at boolean := false;
  v_origin_col text;
  v_destination_col text;
  v_sql text;
  v_update_sql text;
  v_request record;
  v_count integer := 0;
  v_message text;
  v_key text;
begin
  if to_regclass('public.ride_requests') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ride_requests'
      and column_name in ('id', 'requester_id', 'departure_time')
    group by table_name
    having count(*) = 3
  ) then
    raise warning '[expire_requests] ride_requests needs id, requester_id and departure_time';
    return 0;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ride_requests'
      and column_name = 'status'
  ) into v_has_status;

  if not v_has_status then
    raise warning '[expire_requests] ride_requests.status does not exist';
    return 0;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ride_requests'
      and column_name = 'updated_at'
  ) into v_has_updated_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ride_requests'
      and column_name = 'expired_at'
  ) into v_has_expired_at;

  select column_name into v_origin_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ride_requests'
    and column_name in ('origin_address', 'origin', 'from_address')
  order by array_position(array['origin_address', 'origin', 'from_address'], column_name)
  limit 1;

  select column_name into v_destination_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ride_requests'
    and column_name in ('destination_address', 'destination', 'to_address')
  order by array_position(array['destination_address', 'destination', 'to_address'], column_name)
  limit 1;

  p_grace_minutes := greatest(5, least(coalesce(p_grace_minutes, 60), 10080));
  p_limit := greatest(1, least(coalesce(p_limit, 100), 1000));

  v_sql := 'select id::text as request_id, requester_id::uuid as requester_id, departure_time::timestamptz as departure_time, coalesce(status::text, '''') as status_text';

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
    from public.ride_requests
    where departure_time is not null
      and departure_time < now() - ($1 * interval ''1 minute'')
      and lower(coalesce(status::text, '''')) not in (
        ''expired'', ''cancelled'', ''canceled'', ''completed'', ''accepted'', ''matched'', ''rejected'', ''archived''
      )
    order by departure_time asc
    limit $2
  ';

  for v_request in execute v_sql using p_grace_minutes, p_limit loop
    v_update_sql := 'update public.ride_requests set status = $1';

    if v_has_updated_at then
      v_update_sql := v_update_sql || ', updated_at = now()';
    end if;

    if v_has_expired_at then
      v_update_sql := v_update_sql || ', expired_at = coalesce(expired_at, now())';
    end if;

    v_update_sql := v_update_sql || ' where id::text = $2';

    execute v_update_sql using 'expired', v_request.request_id;

    v_count := v_count + 1;

    if v_request.requester_id is not null then
      v_key := 'ride_request:' || v_request.request_id || ':expired';

      if not exists (
        select 1
        from public.notifications
        where user_id = v_request.requester_id
          and type = 'ride_request_expired'
          and entity_type = 'ride_request'
          and entity_id = v_request.request_id
          and metadata->>'automationKey' = v_key
      ) then
        v_message := 'Tu solicitud de viaje ha caducado porque la hora ya pasó.';

        if coalesce(v_request.origin_text, '') <> '' or coalesce(v_request.destination_text, '') <> '' then
          v_message := v_message || ' Ruta:';
          if coalesce(v_request.origin_text, '') <> '' then
            v_message := v_message || ' ' || v_request.origin_text;
          end if;
          if coalesce(v_request.destination_text, '') <> '' then
            v_message := v_message || ' → ' || v_request.destination_text;
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
          v_request.requester_id,
          null,
          'ride_request_expired',
          'Solicitud caducada',
          v_message,
          '/request/' || v_request.request_id,
          'ride_request',
          v_request.request_id,
          'normal',
          jsonb_build_object(
            'requestId', v_request.request_id,
            'departureTime', v_request.departure_time,
            'previousStatus', v_request.status_text,
            'newStatus', 'expired',
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

grant execute on function public.sw_expire_past_ride_requests(integer, integer) to authenticated;
grant execute on function public.sw_expire_past_ride_requests(integer, integer) to anon;

create or replace function public.sw_expire_old_requests()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.sw_expire_past_ride_requests(60, 100);
$$;

grant execute on function public.sw_expire_old_requests() to authenticated;
grant execute on function public.sw_expire_old_requests() to anon;

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
    perform cron.unschedule('shareway_expire_past_ride_requests');
    perform cron.schedule(
      'shareway_expire_past_ride_requests',
      '*/15 * * * *',
      'select public.sw_expire_past_ride_requests(60, 100);'
    );
  end if;
exception when others then
  raise warning '[expire_requests] cron schedule skipped: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
