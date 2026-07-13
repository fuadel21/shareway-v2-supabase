-- Backend guard for ride reservations.
-- Blocks any reservation-like update on public.rides when the ride is no longer bookable.
-- This protects RPCs/edge functions even if a client bypasses the frontend.

create or replace function public.guard_ride_booking_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_participants_count integer := coalesce(cardinality(old.participant_ids), 0);
  v_new_participants_count integer := coalesce(cardinality(new.participant_ids), 0);
  v_is_reservation_change boolean := false;
begin
  -- We only guard changes that look like a passenger reservation:
  -- adding participant ids or reducing available seats.
  v_is_reservation_change :=
    v_new_participants_count > v_old_participants_count
    or coalesce(new.seats_available, old.seats_available, 0) < coalesce(old.seats_available, 0);

  if not v_is_reservation_change then
    return new;
  end if;

  if coalesce(old.status, new.status) <> 'scheduled' then
    raise exception 'BOOKING_NOT_ALLOWED: Este viaje ya no está disponible para reservar.'
      using errcode = 'P0001';
  end if;

  if old.departure_time is null or old.departure_time <= now() then
    raise exception 'BOOKING_NOT_ALLOWED: Este viaje ya ha salido o ha expirado.'
      using errcode = 'P0001';
  end if;

  if coalesce(new.seats_available, old.seats_available, 0) < 0 then
    raise exception 'BOOKING_NOT_ALLOWED: No quedan plazas disponibles en este viaje.'
      using errcode = 'P0001';
  end if;

  if coalesce(new.seats_available, old.seats_available, 0) > coalesce(new.total_seats, old.total_seats, new.seats_available, 0) then
    raise exception 'BOOKING_NOT_ALLOWED: Las plazas disponibles no pueden superar las plazas totales.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.guard_ride_booking_update()
is 'Prevents reservation-like updates on rides that are expired, not scheduled, already departed, or over capacity.';

drop trigger if exists trg_guard_ride_booking_update on public.rides;

create trigger trg_guard_ride_booking_update
before update of participant_ids, seats_available on public.rides
for each row
execute function public.guard_ride_booking_update();
