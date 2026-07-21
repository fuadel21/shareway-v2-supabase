begin;

create or replace function public.enforce_ride_vehicle_metadata_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or old.driver_id is distinct from auth.uid() then
    raise exception 'NOT_RIDE_DRIVER' using errcode = '42501';
  end if;

  if new.driver_id is distinct from old.driver_id then
    raise exception 'DRIVER_ID_IMMUTABLE' using errcode = '42501';
  end if;

  if (
    to_jsonb(new)
      - array[
          'vehicle_model',
          'vehicle_plate',
          'vehicle_color',
          'vehicle_year',
          'vehicle_photo_url',
          'vehicle_luggage',
          'vehicle_snapshot',
          'updated_at'
        ]::text[]
  ) is distinct from (
    to_jsonb(old)
      - array[
          'vehicle_model',
          'vehicle_plate',
          'vehicle_color',
          'vehicle_year',
          'vehicle_photo_url',
          'vehicle_luggage',
          'vehicle_snapshot',
          'updated_at'
        ]::text[]
  ) then
    raise exception 'ONLY_VEHICLE_METADATA_CAN_BE_UPDATED' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ride_vehicle_metadata_only() from public;

DROP TRIGGER IF EXISTS enforce_ride_vehicle_metadata_only ON public.rides;
create trigger enforce_ride_vehicle_metadata_only
before update on public.rides
for each row
when (
  old.vehicle_model is distinct from new.vehicle_model
  or old.vehicle_plate is distinct from new.vehicle_plate
  or old.vehicle_color is distinct from new.vehicle_color
  or old.vehicle_year is distinct from new.vehicle_year
  or old.vehicle_photo_url is distinct from new.vehicle_photo_url
  or old.vehicle_luggage is distinct from new.vehicle_luggage
  or old.vehicle_snapshot is distinct from new.vehicle_snapshot
)
execute function public.enforce_ride_vehicle_metadata_only();

DROP POLICY IF EXISTS "drivers update own ride vehicle metadata" ON public.rides;
create policy "drivers update own ride vehicle metadata"
on public.rides
for update
to authenticated
using (driver_id = auth.uid())
with check (driver_id = auth.uid());

commit;
