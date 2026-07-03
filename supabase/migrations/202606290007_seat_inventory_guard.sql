-- ShareWay seat inventory guard
-- Prevents overselling seats and keeps seats_available coherent when bookings/passengers change.

create or replace function public.sw_get_jsonb_int(p_row jsonb, p_keys text[], p_default integer default 1)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := p_row->>v_key;
    if v_value is not null and trim(v_value) <> '' then
      begin
        return greatest(1, v_value::integer);
      exception when others then
        null;
      end;
    end if;
  end loop;

  return greatest(1, coalesce(p_default, 1));
end;
$$;

create or replace function public.sw_status_consumes_seat(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_status, '')) in (
    'confirmed',
    'accepted',
    'approved',
    'verified',
    'on_board',
    'active',
    'paid',
    'reserved',
    'booked'
  );
$$;

create or replace function public.sw_recalculate_ride_seats(p_ride_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_rides boolean := false;
  v_has_seats_available boolean := false;
  v_total_seats integer := 0;
  v_used_seats integer := 0;
  v_available integer := 0;
  v_table text;
  v_ride_col text;
  v_status_col text;
  v_seats_col text;
  v_sql text;
  v_used integer;
begin
  select to_regclass('public.rides') is not null into v_has_rides;
  if not v_has_rides or p_ride_id is null then
    return 0;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name = 'seats_available'
  ) into v_has_seats_available;

  if not v_has_seats_available then
    return 0;
  end if;

  select coalesce(seats, seats_available, 1)::integer
  into v_total_seats
  from public.rides
  where id::text = p_ride_id
  limit 1;

  v_total_seats := greatest(0, coalesce(v_total_seats, 0));

  foreach v_table in array array['ride_passengers', 'bookings', 'packages'] loop
    if to_regclass('public.' || v_table) is not null then
      select column_name into v_ride_col
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name in ('ride_id', 'trip_id')
      order by array_position(array['ride_id', 'trip_id'], column_name)
      limit 1;

      select column_name into v_status_col
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name in ('status', 'booking_status')
      order by array_position(array['status', 'booking_status'], column_name)
      limit 1;

      select column_name into v_seats_col
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name in ('seats', 'seats_booked', 'seats_reserved', 'seat_count', 'passenger_count')
      order by array_position(array['seats', 'seats_booked', 'seats_reserved', 'seat_count', 'passenger_count'], column_name)
      limit 1;

      if v_ride_col is not null then
        v_sql := 'select coalesce(sum(';

        if v_seats_col is not null then
          v_sql := v_sql || format('greatest(1, coalesce(%I::integer, 1))', v_seats_col);
        else
          v_sql := v_sql || '1';
        end if;

        v_sql := v_sql || format('), 0)::integer from public.%I where %I::text = $1', v_table, v_ride_col);

        if v_status_col is not null then
          v_sql := v_sql || format(
            ' and lower(coalesce(%I::text, '''')) in (''confirmed'', ''accepted'', ''approved'', ''verified'', ''on_board'', ''active'', ''paid'', ''reserved'', ''booked'')',
            v_status_col
          );
        end if;

        execute v_sql into v_used using p_ride_id;
        v_used_seats := v_used_seats + coalesce(v_used, 0);
      end if;
    end if;
  end loop;

  v_available := greatest(0, v_total_seats - v_used_seats);

  update public.rides
  set seats_available = v_available
  where id::text = p_ride_id;

  return v_available;
end;
$$;

create or replace function public.sw_guard_ride_seat_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new_ride_id text := coalesce(v_new_row->>'ride_id', v_new_row->>'trip_id');
  v_old_ride_id text := coalesce(v_old_row->>'ride_id', v_old_row->>'trip_id');
  v_new_status text := lower(coalesce(v_new_row->>'status', v_new_row->>'booking_status', ''));
  v_old_status text := lower(coalesce(v_old_row->>'status', v_old_row->>'booking_status', ''));
  v_new_seats integer := public.sw_get_jsonb_int(v_new_row, array['seats', 'seats_booked', 'seats_reserved', 'seat_count', 'passenger_count'], 1);
  v_old_seats integer := public.sw_get_jsonb_int(v_old_row, array['seats', 'seats_booked', 'seats_reserved', 'seat_count', 'passenger_count'], 1);
  v_ride record;
  v_delta integer := 0;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if v_new_ride_id is null or trim(v_new_ride_id) = '' then
    return new;
  end if;

  if public.sw_status_consumes_seat(v_new_status) then
    v_delta := v_delta + v_new_seats;
  end if;

  if tg_op = 'UPDATE'
     and v_old_ride_id = v_new_ride_id
     and public.sw_status_consumes_seat(v_old_status) then
    v_delta := v_delta - v_old_seats;
  end if;

  -- If this insert/update does not consume extra seats, allow it.
  if v_delta <= 0 then
    return new;
  end if;

  select
    r.id::text as ride_id,
    coalesce(r.seats_available, r.seats, 0)::integer as seats_available,
    lower(coalesce(r.status::text, '')) as status_text,
    r.departure_time::timestamptz as departure_time
  into v_ride
  from public.rides r
  where r.id::text = v_new_ride_id
  for update;

  if v_ride.ride_id is null then
    raise exception 'El viaje no existe';
  end if;

  if v_ride.status_text in ('completed', 'finished', 'cancelled', 'canceled', 'expired', 'archived') then
    raise exception 'Este viaje ya no admite reservas porque está %', v_ride.status_text;
  end if;

  if v_ride.departure_time is not null and v_ride.departure_time <= now() then
    raise exception 'Este viaje ya no admite reservas porque la salida ya pasó';
  end if;

  if v_ride.seats_available < v_delta then
    raise exception 'No quedan plazas suficientes para este viaje';
  end if;

  return new;
end;
$$;

create or replace function public.sw_after_ride_seat_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new_ride_id text := coalesce(v_new_row->>'ride_id', v_new_row->>'trip_id');
  v_old_ride_id text := coalesce(v_old_row->>'ride_id', v_old_row->>'trip_id');
begin
  if v_old_ride_id is not null then
    perform public.sw_recalculate_ride_seats(v_old_ride_id);
  end if;

  if v_new_ride_id is not null and v_new_ride_id is distinct from v_old_ride_id then
    perform public.sw_recalculate_ride_seats(v_new_ride_id);
  elsif v_new_ride_id is not null then
    perform public.sw_recalculate_ride_seats(v_new_ride_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ride_passengers') is not null then
    drop trigger if exists ride_passengers_guard_seat_inventory on public.ride_passengers;
    drop trigger if exists ride_passengers_after_seat_inventory on public.ride_passengers;

    create trigger ride_passengers_guard_seat_inventory
    before insert or update on public.ride_passengers
    for each row
    execute function public.sw_guard_ride_seat_inventory();

    create trigger ride_passengers_after_seat_inventory
    after insert or update or delete on public.ride_passengers
    for each row
    execute function public.sw_after_ride_seat_inventory_change();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_guard_seat_inventory on public.bookings;
    drop trigger if exists bookings_after_seat_inventory on public.bookings;

    create trigger bookings_guard_seat_inventory
    before insert or update on public.bookings
    for each row
    execute function public.sw_guard_ride_seat_inventory();

    create trigger bookings_after_seat_inventory
    after insert or update or delete on public.bookings
    for each row
    execute function public.sw_after_ride_seat_inventory_change();
  end if;
end $$;

do $$
begin
  if to_regclass('public.packages') is not null then
    drop trigger if exists packages_guard_seat_inventory on public.packages;
    drop trigger if exists packages_after_seat_inventory on public.packages;

    create trigger packages_guard_seat_inventory
    before insert or update on public.packages
    for each row
    execute function public.sw_guard_ride_seat_inventory();

    create trigger packages_after_seat_inventory
    after insert or update or delete on public.packages
    for each row
    execute function public.sw_after_ride_seat_inventory_change();
  end if;
end $$;

create or replace function public.sw_recalculate_all_ride_seats(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
  v_count integer := 0;
begin
  if to_regclass('public.rides') is null then
    return 0;
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 1000), 5000));

  for v_ride in
    select id::text as ride_id
    from public.rides
    order by departure_time desc nulls last
    limit p_limit
  loop
    perform public.sw_recalculate_ride_seats(v_ride.ride_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.sw_recalculate_ride_seats(text) to authenticated;
grant execute on function public.sw_recalculate_all_ride_seats(integer) to authenticated;
grant execute on function public.sw_recalculate_ride_seats(text) to anon;
grant execute on function public.sw_recalculate_all_ride_seats(integer) to anon;

notify pgrst, 'reload schema';
