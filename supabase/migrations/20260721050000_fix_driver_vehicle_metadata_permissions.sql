begin;

-- Remove the broad trigger/policy introduced by the previous migration.
drop policy if exists "drivers update own ride vehicle metadata" on public.rides;
drop trigger if exists enforce_ride_vehicle_metadata_only on public.rides;
drop function if exists public.enforce_ride_vehicle_metadata_only();

-- Authenticated users must not have general UPDATE access to rides.
revoke update on table public.rides from authenticated;
revoke update on table public.rides from anon;

-- Permit only the vehicle snapshot columns. PostgreSQL column privileges prevent
-- status, prices, seats, passengers, driver and payment fields from being touched.
grant update (
  vehicle_model,
  vehicle_plate,
  vehicle_color,
  vehicle_year,
  vehicle_photo_url,
  vehicle_luggage,
  vehicle_snapshot
) on table public.rides to authenticated;

create policy "drivers update own ride vehicle metadata"
on public.rides
for update
to authenticated
using (driver_id = auth.uid())
with check (driver_id = auth.uid());

commit;
