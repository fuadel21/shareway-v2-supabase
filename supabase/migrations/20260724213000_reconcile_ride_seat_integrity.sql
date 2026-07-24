-- Reconcile repository migrations with the safe seat-integrity function already
-- applied manually in production after PR #153.
--
-- Goals:
--   1. Never reference OLD during INSERT.
--   2. Keep one canonical active-seat calculation.
--   3. Repair only rows whose stored seat counters are inconsistent.
--   4. Protect future writes without weakening existing RLS policies.

create or replace function public.ride_active_seat_count(p_passengers jsonb)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_passenger jsonb;
  v_status text;
  v_seats_text text;
  v_seats integer;
  v_occupied integer := 0;
begin
  if p_passengers is null then
    return 0;
  end if;

  if jsonb_typeof(p_passengers) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PASSENGERS_PAYLOAD',
      detail = 'rides.passengers debe ser un array JSON.';
  end if;

  for v_passenger in
    select value from jsonb_array_elements(p_passengers)
  loop
    v_status := lower(trim(coalesce(v_passenger->>'status', 'confirmed')));

    if v_status in ('confirmed', 'accepted', 'pending_boarding', 'verified', 'completed') then
      v_seats_text := coalesce(
        v_passenger->>'num_seats',
        v_passenger->>'seats',
        v_passenger->>'seat_count',
        '1'
      );

      if v_seats_text ~ '^[0-9]+$' then
        v_seats := greatest(v_seats_text::integer, 1);
      else
        v_seats := 1;
      end if;

      v_occupied := v_occupied + v_seats;
    end if;
  end loop;

  return v_occupied;
end;
$$;

create or replace function public.enforce_ride_booking_seat_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_passengers jsonb := coalesce(new.passengers, '[]'::jsonb);
  v_passenger jsonb;
  v_passenger_id text;
  v_status text;
  v_total integer := coalesce(new.total_seats, 0);
  v_occupied integer;
  v_previous_occupied integer := 0;
  v_seen jsonb := '{}'::jsonb;
  v_active boolean;
begin
  if jsonb_typeof(v_passengers) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PASSENGERS_PAYLOAD',
      detail = 'rides.passengers debe ser un array JSON.';
  end if;

  if v_total < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_TOTAL_SEATS';
  end if;

  for v_passenger in
    select value from jsonb_array_elements(v_passengers)
  loop
    v_passenger_id := lower(trim(coalesce(
      v_passenger->>'id',
      v_passenger->>'passenger_id',
      v_passenger->>'user_id',
      ''
    )));

    v_status := lower(trim(coalesce(v_passenger->>'status', 'confirmed')));
    v_active := v_status in (
      'confirmed',
      'accepted',
      'pending_boarding',
      'verified',
      'completed'
    );

    if v_active and v_passenger_id = '' then
      raise exception using
        errcode = 'P0001',
        message = 'PASSENGER_ID_REQUIRED';
    end if;

    if v_active
       and new.driver_id is not null
       and v_passenger_id = lower(new.driver_id::text) then
      raise exception using
        errcode = 'P0001',
        message = 'DRIVER_CANNOT_BOOK_OWN_RIDE';
    end if;

    if v_active then
      if v_seen ? v_passenger_id then
        raise exception using
          errcode = 'P0001',
          message = 'DUPLICATE_ACTIVE_PASSENGER',
          detail = format(
            'El pasajero %s aparece más de una vez en el viaje.',
            v_passenger_id
          );
      end if;

      v_seen := v_seen || jsonb_build_object(v_passenger_id, true);
    end if;
  end loop;

  v_occupied := public.ride_active_seat_count(v_passengers);

  -- OLD is legal only for UPDATE. This is the production hotfix that was
  -- missing from the historical PR #153 migration.
  if tg_op = 'UPDATE' then
    v_previous_occupied := public.ride_active_seat_count(
      coalesce(old.passengers, '[]'::jsonb)
    );
  end if;

  -- Legacy rows may have total_seats null/zero. Infer a stable total from the
  -- previous snapshot during UPDATE, or from the incoming snapshot on INSERT.
  if v_total = 0 then
    if tg_op = 'UPDATE' then
      v_total := greatest(
        coalesce(old.total_seats, 0),
        coalesce(old.seats_available, 0) + v_previous_occupied,
        coalesce(new.seats_available, 0) + v_occupied,
        v_occupied
      );
    else
      v_total := greatest(
        coalesce(new.seats_available, 0) + v_occupied,
        v_occupied
      );
    end if;

    new.total_seats := v_total;
  end if;

  if v_occupied > v_total then
    raise exception using
      errcode = 'P0001',
      message = 'RIDE_OVERBOOKED',
      detail = format(
        'Se intentan ocupar %s plaza(s), pero el viaje solo tiene %s.',
        v_occupied,
        v_total
      );
  end if;

  new.seats_available := greatest(v_total - v_occupied, 0);
  return new;
end;
$$;

drop trigger if exists trg_enforce_ride_booking_seat_integrity on public.rides;

create trigger trg_enforce_ride_booking_seat_integrity
before insert or update of passengers, seats_available, total_seats, driver_id
on public.rides
for each row
execute function public.enforce_ride_booking_seat_integrity();

-- Repair only rows whose counters do not match their active passenger payload.
-- Assigning passengers to itself deliberately invokes the canonical trigger.
update public.rides
set passengers = coalesce(passengers, '[]'::jsonb)
where jsonb_typeof(coalesce(passengers, '[]'::jsonb)) = 'array'
  and (
    total_seats is null
    or total_seats < 0
    or seats_available is null
    or seats_available < 0
    or seats_available > greatest(coalesce(total_seats, 0), 0)
    or seats_available <> greatest(
      greatest(
        coalesce(total_seats, 0),
        coalesce(seats_available, 0) + public.ride_active_seat_count(coalesce(passengers, '[]'::jsonb)),
        public.ride_active_seat_count(coalesce(passengers, '[]'::jsonb))
      ) - public.ride_active_seat_count(coalesce(passengers, '[]'::jsonb)),
      0
    )
  );

-- NOT VALID preserves deployability when a legacy row needs manual review,
-- while PostgreSQL still enforces the constraints for all new writes.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_total_seats_nonnegative'
  ) then
    alter table public.rides
      add constraint rides_total_seats_nonnegative
      check (coalesce(total_seats, 0) >= 0)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_available_seats_within_total'
  ) then
    alter table public.rides
      add constraint rides_available_seats_within_total
      check (
        coalesce(seats_available, 0) >= 0
        and coalesce(seats_available, 0) <= coalesce(total_seats, 0)
      )
      not valid;
  end if;
end;
$$;

revoke all on function public.ride_active_seat_count(jsonb) from public;
grant execute on function public.ride_active_seat_count(jsonb) to authenticated;

comment on function public.ride_active_seat_count(jsonb) is
  'Canonical occupied-seat count for active passenger records stored in rides.passengers.';

comment on function public.enforce_ride_booking_seat_integrity() is
  'Insert-safe booking integrity trigger: prevents duplicates, self-booking and overbooking, infers legacy totals, and derives seats_available.';