-- ShareWay overbooking guard
-- Prevents active reservations from exceeding ride capacity across ride_passengers and bookings.

create or replace function public.sw_count_active_ride_participants(
  p_table_name text,
  p_ride_id text
)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_ride_column text;
  v_status_column text;
  v_seats_column text;
  v_sql text;
  v_count integer := 0;
begin
  if p_table_name not in ('ride_passengers', 'bookings') then
    return 0;
  end if;

  if to_regclass('public.' || p_table_name) is null then
    return 0;
  end if;

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

  select column_name into v_seats_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table_name
    and column_name in ('seats', 'seat_count', 'seats_booked', 'seats_reserved', 'passenger_count')
  order by array_position(array['seats', 'seat_count', 'seats_booked', 'seats_reserved', 'passenger_count'], column_name)
  limit 1;

  if v_ride_column is null then
    return 0;
  end if;

  if v_seats_column is not null then
    v_sql := format(
      'select coalesce(sum(greatest(1, coalesce(%1$I::integer, 1))), 0)::integer from public.%2$I where %3$I::text = $1',
      v_seats_column,
      p_table_name,
      v_ride_column
    );
  else
    v_sql := format(
      'select count(*)::integer from public.%1$I where %2$I::text = $1',
      p_table_name,
      v_ride_column
    );
  end if;

  if v_status_column is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'', ''refunded'')',
      v_status_column
    );
  end if;

  execute v_sql into v_count using p_ride_id;
  return coalesce(v_count, 0);
exception when others then
  raise warning '[overbooking] count skipped for %: %', p_table_name, sqlerrm;
  return 0;
end;
$$;

create or replace function public.sw_total_active_ride_participants(p_ride_id text)
returns integer
language sql
stable
set search_path = public
as $$
  select public.sw_count_active_ride_participants('ride_passengers', p_ride_id)
       + public.sw_count_active_ride_participants('bookings', p_ride_id);
$$;

create or replace function public.sw_guard_ride_overbooking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ride_id text;
  v_old_ride_id text;
  v_new_status text;
  v_old_status text;
  v_requested_seats integer := 1;
  v_old_requested_seats integer := 0;
  v_capacity integer := null;
  v_available integer := null;
  v_current_count integer := 0;
  v_effective_count integer := 0;
  v_table_name text := tg_table_name;
begin
  v_ride_id := coalesce(v_row->>'ride_id', v_row->>'trip_id');

  if v_ride_id is null or trim(v_ride_id) = '' then
    return new;
  end if;

  v_old_ride_id := coalesce(v_old_row->>'ride_id', v_old_row->>'trip_id');
  v_new_status := lower(coalesce(v_row->>'status', v_row->>'booking_status', ''));
  v_old_status := lower(coalesce(v_old_row->>'status', v_old_row->>'booking_status', ''));

  -- Allow cancellation/rejection/no-show updates even if the ride is full.
  if tg_op = 'UPDATE'
     and v_new_status in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show', 'refunded') then
    return new;
  end if;

  -- Only guard active/pending booking states.
  if v_new_status not in ('', 'pending', 'requested', 'confirmed', 'accepted', 'approved', 'active', 'verified', 'on_board') then
    return new;
  end if;

  v_requested_seats := greatest(
    1,
    coalesce(
      nullif(v_row->>'seats', '')::integer,
      nullif(v_row->>'seat_count', '')::integer,
      nullif(v_row->>'seats_booked', '')::integer,
      nullif(v_row->>'seats_reserved', '')::integer,
      nullif(v_row->>'passenger_count', '')::integer,
      1
    )
  );

  if tg_op = 'UPDATE'
     and v_old_ride_id = v_ride_id
     and v_old_status not in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show', 'refunded') then
    v_old_requested_seats := greatest(
      1,
      coalesce(
        nullif(v_old_row->>'seats', '')::integer,
        nullif(v_old_row->>'seat_count', '')::integer,
        nullif(v_old_row->>'seats_booked', '')::integer,
        nullif(v_old_row->>'seats_reserved', '')::integer,
        nullif(v_old_row->>'passenger_count', '')::integer,
        1
      )
    );
  end if;

  select
    coalesce(r.seats::integer, null) as capacity,
    coalesce(r.seats_available::integer, null) as available
  into v_capacity, v_available
  from public.rides r
  where r.id::text = v_ride_id
  limit 1;

  if v_capacity is null and v_available is null then
    -- If the rides table has no capacity columns, do not block.
    return new;
  end if;

  v_current_count := public.sw_total_active_ride_participants(v_ride_id);
  v_effective_count := greatest(0, v_current_count - v_old_requested_seats) + v_requested_seats;

  if v_capacity is not null and v_effective_count > v_capacity then
    raise exception 'No quedan plazas suficientes para este viaje';
  end if;

  if v_available is not null and tg_op = 'INSERT' and v_available < v_requested_seats then
    raise exception 'No quedan plazas disponibles para este viaje';
  end if;

  return new;
exception
  when invalid_text_representation then
    raise exception 'Número de plazas inválido';
end;
$$;

do $$
begin
  if to_regclass('public.ride_passengers') is not null then
    drop trigger if exists ride_passengers_guard_overbooking on public.ride_passengers;
    create trigger ride_passengers_guard_overbooking
    before insert or update on public.ride_passengers
    for each row
    execute function public.sw_guard_ride_overbooking();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_guard_overbooking on public.bookings;
    create trigger bookings_guard_overbooking
    before insert or update on public.bookings
    for each row
    execute function public.sw_guard_ride_overbooking();
  end if;
end $$;

notify pgrst, 'reload schema';
