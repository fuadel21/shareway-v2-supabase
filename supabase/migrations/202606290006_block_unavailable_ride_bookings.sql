-- ShareWay booking availability guard
-- Prevents bookings/passenger joins on completed, cancelled, expired, finished or past rides.

create or replace function public.sw_guard_ride_booking_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_ride_id text;
  v_new_status text;
  v_old_status text;
  v_ride record;
begin
  v_ride_id := coalesce(v_row->>'ride_id', v_row->>'trip_id');

  if v_ride_id is null or trim(v_ride_id) = '' then
    return new;
  end if;

  v_new_status := lower(coalesce(v_row->>'status', v_row->>'booking_status', ''));
  v_old_status := lower(coalesce(v_old_row->>'status', v_old_row->>'booking_status', ''));

  -- Allow cancellation/rejection/no-show updates even after the ride is no longer available.
  if tg_op = 'UPDATE'
     and v_new_status in ('cancelled', 'canceled', 'rejected', 'declined', 'denied', 'no_show') then
    return new;
  end if;

  -- If an existing booking is being updated without changing ride or moving into an active booking state, do not block.
  if tg_op = 'UPDATE'
     and coalesce(v_old_row->>'ride_id', v_old_row->>'trip_id') = v_ride_id
     and v_new_status = v_old_status
     and v_new_status not in ('', 'pending', 'requested', 'confirmed', 'accepted', 'approved', 'active') then
    return new;
  end if;

  select
    r.id::text as ride_id,
    lower(coalesce(r.status::text, '')) as status_text,
    r.departure_time::timestamptz as departure_time
  into v_ride
  from public.rides r
  where r.id::text = v_ride_id
  limit 1;

  if v_ride.ride_id is null then
    raise exception 'El viaje no existe o ya no está disponible';
  end if;

  if v_ride.status_text in ('completed', 'finished', 'cancelled', 'canceled', 'expired', 'archived') then
    raise exception 'Este viaje ya no admite reservas porque está %', v_ride.status_text;
  end if;

  if v_ride.departure_time is not null and v_ride.departure_time <= now() then
    raise exception 'Este viaje ya no admite reservas porque la hora de salida ya pasó';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ride_passengers') is not null then
    drop trigger if exists ride_passengers_guard_available_ride on public.ride_passengers;
    create trigger ride_passengers_guard_available_ride
    before insert or update on public.ride_passengers
    for each row
    execute function public.sw_guard_ride_booking_availability();
  end if;
end $$;

do $$
begin
  if to_regclass('public.bookings') is not null then
    drop trigger if exists bookings_guard_available_ride on public.bookings;
    create trigger bookings_guard_available_ride
    before insert or update on public.bookings
    for each row
    execute function public.sw_guard_ride_booking_availability();
  end if;
end $$;

notify pgrst, 'reload schema';
