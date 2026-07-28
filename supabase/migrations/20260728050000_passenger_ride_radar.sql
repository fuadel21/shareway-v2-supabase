-- Passenger radar for newly published rides.
-- Reuses rides, notifications and the existing booking flow.

create table if not exists public.passenger_radar_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  radius_km integer not null default 25 check (radius_km between 5 and 100),
  latitude double precision,
  longitude double precision,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint passenger_radar_valid_latitude check (latitude is null or latitude between -90 and 90),
  constraint passenger_radar_valid_longitude check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.ride_passenger_radar_deliveries (
  ride_id uuid not null,
  passenger_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid,
  distance_km numeric(8,2),
  created_at timestamptz not null default now(),
  primary key (ride_id, passenger_id)
);

alter table public.passenger_radar_preferences enable row level security;
alter table public.ride_passenger_radar_deliveries enable row level security;

revoke all on public.passenger_radar_preferences from public, anon;
revoke all on public.ride_passenger_radar_deliveries from public, anon;
grant select on public.passenger_radar_preferences to authenticated;
grant select on public.ride_passenger_radar_deliveries to authenticated;

drop policy if exists passenger_radar_read_own on public.passenger_radar_preferences;
create policy passenger_radar_read_own
on public.passenger_radar_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists passenger_radar_delivery_read_own on public.ride_passenger_radar_deliveries;
create policy passenger_radar_delivery_read_own
on public.ride_passenger_radar_deliveries
for select
to authenticated
using (passenger_id = auth.uid());

create or replace function public.update_passenger_radar_presence(
  p_enabled boolean,
  p_radius_km integer default 25,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_radius integer := greatest(5, least(coalesce(p_radius_km, 25), 100));
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'No autenticado');
  end if;

  if p_enabled and (p_latitude is null or p_longitude is null) then
    return jsonb_build_object('success', false, 'error', 'Necesitamos tu ubicación para activar el radar');
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    return jsonb_build_object('success', false, 'error', 'Latitud inválida');
  end if;

  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    return jsonb_build_object('success', false, 'error', 'Longitud inválida');
  end if;

  insert into public.passenger_radar_preferences (
    user_id, enabled, radius_km, latitude, longitude, last_seen_at, updated_at
  ) values (
    v_user_id, coalesce(p_enabled, false), v_radius,
    p_latitude, p_longitude,
    case when p_enabled then now() else null end,
    now()
  )
  on conflict (user_id) do update
  set enabled = excluded.enabled,
      radius_km = excluded.radius_km,
      latitude = coalesce(excluded.latitude, passenger_radar_preferences.latitude),
      longitude = coalesce(excluded.longitude, passenger_radar_preferences.longitude),
      last_seen_at = case when excluded.enabled then now() else passenger_radar_preferences.last_seen_at end,
      updated_at = now();

  return jsonb_build_object(
    'success', true,
    'enabled', coalesce(p_enabled, false),
    'radius_km', v_radius,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.update_passenger_radar_presence(boolean, integer, double precision, double precision) from public, anon;
grant execute on function public.update_passenger_radar_presence(boolean, integer, double precision, double precision) to authenticated;

create or replace function public.get_my_passenger_radar_preferences()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'success', true,
        'enabled', enabled,
        'radius_km', radius_km,
        'has_location', latitude is not null and longitude is not null,
        'last_seen_at', last_seen_at,
        'updated_at', updated_at
      )
      from public.passenger_radar_preferences
      where user_id = auth.uid()
    ),
    jsonb_build_object(
      'success', true,
      'enabled', false,
      'radius_km', 25,
      'has_location', false
    )
  );
$$;

revoke all on function public.get_my_passenger_radar_preferences() from public, anon;
grant execute on function public.get_my_passenger_radar_preferences() to authenticated;

create or replace function public.notify_passenger_radar_for_ride()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride jsonb := to_jsonb(new);
  v_ride_id uuid;
  v_driver_id uuid;
  v_origin jsonb;
  v_destination jsonb;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_origin_label text;
  v_destination_label text;
  v_departure_text text;
  v_status text;
  v_seats integer;
  v_price numeric;
  v_passenger record;
  v_distance_km numeric;
  v_notification_id uuid;
begin
  begin
    v_ride_id := coalesce(nullif(v_ride->>'id', '')::uuid, nullif(v_ride->>'ride_id', '')::uuid);
  exception when invalid_text_representation then
    return new;
  end;

  begin
    v_driver_id := nullif(v_ride->>'driver_id', '')::uuid;
  exception when invalid_text_representation then
    v_driver_id := null;
  end;

  v_status := lower(coalesce(v_ride->>'status', 'scheduled'));
  if v_status not in ('scheduled', 'published', 'available') then
    return new;
  end if;

  v_origin := coalesce(v_ride->'origin', '{}'::jsonb);
  v_destination := coalesce(v_ride->'destination', '{}'::jsonb);

  begin
    v_origin_lat := coalesce(
      nullif(v_origin->>'lat', '')::double precision,
      nullif(v_origin->>'latitude', '')::double precision,
      nullif(v_origin#>>'{coordinates,lat}', '')::double precision,
      nullif(v_origin#>>'{coordinates,latitude}', '')::double precision
    );
    v_origin_lng := coalesce(
      nullif(v_origin->>'lng', '')::double precision,
      nullif(v_origin->>'longitude', '')::double precision,
      nullif(v_origin#>>'{coordinates,lng}', '')::double precision,
      nullif(v_origin#>>'{coordinates,longitude}', '')::double precision
    );
  exception when invalid_text_representation then
    return new;
  end;

  if v_ride_id is null or v_origin_lat is null or v_origin_lng is null then
    return new;
  end if;

  begin
    v_seats := greatest(0, coalesce(
      nullif(v_ride->>'seats_available', '')::integer,
      nullif(v_ride->>'available_seats', '')::integer,
      nullif(v_ride->>'seats', '')::integer,
      0
    ));
  exception when invalid_text_representation then
    v_seats := 0;
  end;

  if v_seats <= 0 then
    return new;
  end if;

  begin
    v_price := coalesce(
      nullif(v_ride->>'price_per_seat', '')::numeric,
      nullif(v_ride->>'price', '')::numeric,
      0
    );
  exception when invalid_text_representation then
    v_price := 0;
  end;

  v_origin_label := coalesce(v_origin->>'name', v_origin->>'address', 'tu zona');
  v_destination_label := coalesce(v_destination->>'name', v_destination->>'address', 'destino indicado');
  v_departure_text := coalesce(v_ride->>'departure_time', v_ride->>'date_time', 'próximamente');

  for v_passenger in
    select p.user_id,
           p.radius_km,
           6371 * 2 * asin(
             sqrt(
               power(sin(radians(p.latitude - v_origin_lat) / 2), 2)
               + cos(radians(v_origin_lat)) * cos(radians(p.latitude))
               * power(sin(radians(p.longitude - v_origin_lng) / 2), 2)
             )
           ) as distance_km
    from public.passenger_radar_preferences p
    where p.enabled = true
      and p.latitude is not null
      and p.longitude is not null
      and p.last_seen_at >= now() - interval '24 hours'
      and (v_driver_id is null or p.user_id <> v_driver_id)
  loop
    v_distance_km := round(v_passenger.distance_km::numeric, 2);
    if v_distance_km > v_passenger.radius_km then
      continue;
    end if;

    begin
      insert into public.ride_passenger_radar_deliveries (ride_id, passenger_id, distance_km)
      values (v_ride_id, v_passenger.user_id, v_distance_km)
      on conflict (ride_id, passenger_id) do nothing;

      if not found then
        continue;
      end if;

      insert into public.notifications (
        user_id, actor_id, title, message, type, action_url,
        entity_type, entity_id, priority, metadata
      ) values (
        v_passenger.user_id,
        v_driver_id,
        'Radar: nuevo viaje cerca de ti',
        format('%s plaza(s) desde %s hasta %s por %s €. Origen a %s km de tu zona.', v_seats, v_origin_label, v_destination_label, trim(to_char(v_price, 'FM999999990.00')), v_distance_km),
        'ride_request',
        '/ride/' || v_ride_id::text,
        'ride',
        v_ride_id::text,
        'normal',
        jsonb_build_object(
          'radar', true,
          'radar_mode', 'passenger',
          'ride_id', v_ride_id,
          'distance_km', v_distance_km,
          'origin', v_origin_label,
          'destination', v_destination_label,
          'departure_time', v_departure_text,
          'seats_available', v_seats,
          'price_per_seat', v_price,
          'action', 'book_ride'
        )
      ) returning id into v_notification_id;

      update public.ride_passenger_radar_deliveries
      set notification_id = v_notification_id
      where ride_id = v_ride_id and passenger_id = v_passenger.user_id;
    exception when others then
      raise warning 'Passenger radar delivery failed for ride %, passenger %: %', v_ride_id, v_passenger.user_id, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

drop trigger if exists ride_passenger_radar on public.rides;
create trigger ride_passenger_radar
after insert on public.rides
for each row execute function public.notify_passenger_radar_for_ride();

comment on table public.passenger_radar_preferences is
  'Opt-in location and radius settings for passengers who want alerts about newly published nearby rides.';
comment on table public.ride_passenger_radar_deliveries is
  'Idempotent delivery ledger preventing duplicate ride alerts per passenger.';