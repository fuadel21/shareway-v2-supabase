-- ShareWay duplicate booking guard
-- Prevents the same passenger/user from booking or joining the same ride more than once.

create or replace function public.sw_first_column_for_table(p_table_name text, p_columns text[])
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

create or replace function public.sw_guard_duplicate_ride_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := tg_table_name;
  v_row jsonb := to_jsonb(new);
  v_old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ride_col text;
  v_user_col text;
  v_status_col text;
  v_id_col text;
  v_ride_id text;
  v_user_id text;
  v_status text;
  v_old_status text;
  v_current_id text;
  v_sql text;
  v_exists boolean := false;
begin
  if v_table not in ('ride_passengers', 'bookings') then
    return new;
  end if;

  v_ride_col := public.sw_first_column_for_table(v_table, array['ride_id', 'trip_id']);
  v_user_col := public.sw_first_column_for_table(v_table, array['passenger_id', 'user_id', 'requester_id', 'profile_id']);
  v_status_col := public.sw_first_column_for_table(v_table, array['status', 'booking_status']);
  v_id_col := public.sw_first_column_for_table(v_table, array['id']);

  if v_ride_col is null or v_user_col is null then
    return new;
  end if;

  v_ride_id := v_row->>v_ride_col;
  v_user_id := v_row->>v_user_col;
  v_status := lower(coalesce(case when v_status_col is not null then v_row->>v_status_col else '' end, ''));
  v_old_status := lower(coalesce(case when v_status_col is not null then v_old_row->>v_status_col else '' end, ''));
  v_current_id := case when v_id_col is not null then v_row->>v_id_col else null end;

  if v_ride_id is null or trim(v_ride_id) = '' or v_user_id is null or trim(v_user_id) = '' then
    return new;
  end if;

  -- Allow non-active final states.
  if v_status in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show') then
    return new;
  end if;

  -- On update, if ride/user did not change and status did not move to an active state, do not block.
  if tg_op = 'UPDATE'
     and coalesce(v_old_row->>v_ride_col, '') = v_ride_id
     and coalesce(v_old_row->>v_user_col, '') = v_user_id
     and v_old_status = v_status then
    return new;
  end if;

  v_sql := format(
    'select exists (select 1 from public.%1$I where %2$I::text = $1 and %3$I::text = $2',
    v_table,
    v_ride_col,
    v_user_col
  );

  if v_status_col is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'')',
      v_status_col
    );
  end if;

  if tg_op = 'UPDATE' and v_id_col is not null and v_current_id is not null then
    v_sql := v_sql || format(' and %I::text <> $3', v_id_col);
    v_sql := v_sql || ')';
    execute v_sql into v_exists using v_ride_id, v_user_id, v_current_id;
  else
    v_sql := v_sql || ')';
    execute v_sql into v_exists using v_ride_id, v_user_id;
  end if;

  if v_exists then
    raise exception 'Ya existe una reserva activa para este usuario en este viaje';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ride_passengers') is not null then
    drop trigger if exists ride_passengers_guard_duplicate_booking on public.ride_passengers;
    create trigger ride_passengers_guard_duplicate_booking
    before insert or update on public.ride_passengers
    for each row
    execute function public.sw_guard_duplicate_ride_booking();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_guard_duplicate_booking on public.bookings;
    create trigger bookings_guard_duplicate_booking
    before insert or update on public.bookings
    for each row
    execute function public.sw_guard_duplicate_ride_booking();
  end if;
end $$;

notify pgrst, 'reload schema';
