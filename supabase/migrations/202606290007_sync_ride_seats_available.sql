-- ShareWay automatic seats availability sync
-- Recalculates rides.seats_available when passengers/bookings change.

create or replace function public.sw_first_existing_column_safe(p_table_name text, p_columns text[])
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

create or replace function public.sw_count_active_passengers_for_table(
  p_table_name text,
  p_ride_id text
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_col text;
  v_ride_col text;
  v_status_col text;
  v_sql text;
  v_user_ids uuid[] := '{}'::uuid[];
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return v_user_ids;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return v_user_ids;
  end if;

  v_user_col := public.sw_first_existing_column_safe(
    p_table_name,
    array['passenger_id', 'user_id', 'requester_id', 'profile_id']
  );

  v_ride_col := public.sw_first_existing_column_safe(
    p_table_name,
    array['ride_id', 'trip_id']
  );

  v_status_col := public.sw_first_existing_column_safe(
    p_table_name,
    array['status', 'booking_status']
  );

  if v_user_col is null or v_ride_col is null then
    return v_user_ids;
  end if;

  v_sql := format(
    'select coalesce(array_agg(distinct %1$I::uuid), ''''{}''''::uuid[]) from public.%2$I where %3$I::text = $1 and %1$I is not null',
    v_user_col,
    p_table_name,
    v_ride_col
  );

  if v_status_col is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'', ''removed'')',
      v_status_col
    );
  end if;

  execute v_sql into v_user_ids using p_ride_id;

  return coalesce(v_user_ids, '{}'::uuid[]);
exception when others then
  raise warning '[seats_sync] count skipped for %: %', p_table_name, sqlerrm;
  return '{}'::uuid[];
end;
$$;

create or replace function public.sw_recalculate_ride_seats_available(p_ride_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_seats boolean := false;
  v_has_seats_available boolean := false;
  v_has_updated_at boolean := false;
  v_total_seats integer := 0;
  v_user_ids uuid[] := '{}'::uuid[];
  v_more_user_ids uuid[] := '{}'::uuid[];
  v_occupied integer := 0;
  v_available integer := 0;
  v_update_sql text;
begin
  if p_ride_id is null or trim(p_ride_id) = '' then
    return 0;
  end if;

  if to_regclass('public.rides') is null then
    return 0;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'seats'
  ) into v_has_seats;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'seats_available'
  ) into v_has_seats_available;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rides' and column_name = 'updated_at'
  ) into v_has_updated_at;

  if not (v_has_seats and v_has_seats_available) then
    raise warning '[seats_sync] rides needs seats and seats_available';
    return 0;
  end if;

  execute 'select coalesce(seats, 0)::integer from public.rides where id::text = $1 limit 1'
    into v_total_seats
    using p_ride_id;

  if v_total_seats is null then
    return 0;
  end if;

  v_user_ids := public.sw_count_active_passengers_for_table('ride_passengers', p_ride_id);
  v_more_user_ids := public.sw_count_active_passengers_for_table('bookings', p_ride_id);

  select coalesce(array_agg(distinct x), '{}'::uuid[])
  into v_user_ids
  from unnest(coalesce(v_user_ids, '{}'::uuid[]) || coalesce(v_more_user_ids, '{}'::uuid[])) as x;

  v_occupied := coalesce(array_length(v_user_ids, 1), 0);
  v_available := greatest(0, v_total_seats - v_occupied);

  v_update_sql := 'update public.rides set seats_available = $1';

  if v_has_updated_at then
    v_update_sql := v_update_sql || ', updated_at = now()';
  end if;

  v_update_sql := v_update_sql || ' where id::text = $2';

  execute v_update_sql using v_available, p_ride_id;

  return v_available;
end;
$$;

create or replace function public.sw_sync_ride_seats_available_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_ride_id text;
  v_old_ride_id text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_ride_id := coalesce(to_jsonb(new)->>'ride_id', to_jsonb(new)->>'trip_id');
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_ride_id := coalesce(to_jsonb(old)->>'ride_id', to_jsonb(old)->>'trip_id');
  end if;

  if v_new_ride_id is not null then
    perform public.sw_recalculate_ride_seats_available(v_new_ride_id);
  end if;

  if v_old_ride_id is not null and v_old_ride_id is distinct from v_new_ride_id then
    perform public.sw_recalculate_ride_seats_available(v_old_ride_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
exception when others then
  raise warning '[seats_sync] trigger skipped: %', sqlerrm;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ride_passengers') is not null then
    drop trigger if exists ride_passengers_sync_seats_available on public.ride_passengers;
    create trigger ride_passengers_sync_seats_available
    after insert or update or delete on public.ride_passengers
    for each row
    execute function public.sw_sync_ride_seats_available_trigger();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_sync_seats_available on public.bookings;
    create trigger bookings_sync_seats_available
    after insert or update or delete on public.bookings
    for each row
    execute function public.sw_sync_ride_seats_available_trigger();
  end if;
end $$;

grant execute on function public.sw_recalculate_ride_seats_available(text) to authenticated;
grant execute on function public.sw_recalculate_ride_seats_available(text) to anon;

notify pgrst, 'reload schema';
