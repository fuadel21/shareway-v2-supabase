-- ShareWay booking identity guard
-- Prevents duplicate bookings for the same user/ride and prevents drivers booking their own rides.

create or replace function public.sw_guard_duplicate_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_ride_id text;
  v_user_id text;
  v_status text;
  v_driver_id text;
  v_count integer := 0;
begin
  v_ride_id := coalesce(v_row->>'ride_id', v_row->>'trip_id');
  v_user_id := coalesce(v_row->>'passenger_id', v_row->>'user_id', v_row->>'requester_id', v_row->>'profile_id');
  v_status := lower(coalesce(v_row->>'status', v_row->>'booking_status', ''));

  if v_ride_id is null or trim(v_ride_id) = '' or v_user_id is null or trim(v_user_id) = '' then
    return new;
  end if;

  -- Allow final/cancelled rows; block only active booking states.
  if v_status in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show') then
    return new;
  end if;

  select r.driver_id::text
  into v_driver_id
  from public.rides r
  where r.id::text = v_ride_id
  limit 1;

  if v_driver_id is not null and v_driver_id = v_user_id then
    raise exception 'El conductor no puede reservar su propio viaje';
  end if;

  if tg_table_name = 'ride_passengers' then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ride_passengers'
        and column_name = 'ride_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ride_passengers'
        and column_name = 'passenger_id'
    ) then
      select count(*)
      into v_count
      from public.ride_passengers rp
      where rp.ride_id::text = v_ride_id
        and rp.passenger_id::text = v_user_id
        and (tg_op = 'INSERT' or rp.id::text <> coalesce(v_row->>'id', ''))
        and lower(coalesce(rp.status::text, '')) not in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show');
    end if;
  end if;

  if tg_table_name = 'bookings' then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bookings'
        and column_name = 'ride_id'
    ) then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bookings'
          and column_name = 'passenger_id'
      ) then
        select count(*)
        into v_count
        from public.bookings b
        where b.ride_id::text = v_ride_id
          and b.passenger_id::text = v_user_id
          and (tg_op = 'INSERT' or b.id::text <> coalesce(v_row->>'id', ''))
          and lower(coalesce(b.status::text, b.booking_status::text, '')) not in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show');
      elsif exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bookings'
          and column_name = 'user_id'
      ) then
        select count(*)
        into v_count
        from public.bookings b
        where b.ride_id::text = v_ride_id
          and b.user_id::text = v_user_id
          and (tg_op = 'INSERT' or b.id::text <> coalesce(v_row->>'id', ''))
          and lower(coalesce(b.status::text, b.booking_status::text, '')) not in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show');
      end if;
    end if;
  end if;

  if v_count > 0 then
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
    execute function public.sw_guard_duplicate_booking();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_guard_duplicate_booking on public.bookings;
    create trigger bookings_guard_duplicate_booking
    before insert or update on public.bookings
    for each row
    execute function public.sw_guard_duplicate_booking();
  end if;
end $$;

notify pgrst, 'reload schema';
