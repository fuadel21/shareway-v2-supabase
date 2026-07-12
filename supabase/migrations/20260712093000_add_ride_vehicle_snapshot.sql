-- Store the driver's vehicle snapshot on each ride so passengers can trust
-- what they see even if the driver later edits their profile vehicle.

alter table public.rides
  add column if not exists vehicle_model text,
  add column if not exists vehicle_plate text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_year text,
  add column if not exists vehicle_photo_url text,
  add column if not exists vehicle_luggage text,
  add column if not exists vehicle_snapshot jsonb not null default '{}'::jsonb;

comment on column public.rides.vehicle_model is 'Driver vehicle make/model snapshot shown on ride details.';
comment on column public.rides.vehicle_plate is 'Partial vehicle plate snapshot shown to passengers.';
comment on column public.rides.vehicle_color is 'Vehicle color snapshot at publishing time.';
comment on column public.rides.vehicle_year is 'Vehicle year snapshot at publishing time.';
comment on column public.rides.vehicle_photo_url is 'Vehicle photo URL snapshot at publishing time.';
comment on column public.rides.vehicle_luggage is 'Luggage capacity/preference snapshot at publishing time.';
comment on column public.rides.vehicle_snapshot is 'Full vehicle JSON snapshot captured from profiles.vehicle when publishing a ride.';

create index if not exists rides_vehicle_model_idx on public.rides (vehicle_model);
