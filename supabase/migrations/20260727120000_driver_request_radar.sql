-- Driver request radar for nearby passenger demand.
-- Reuses ride_requests and notifications instead of creating a parallel request flow.

create table if not exists public.driver_radar_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  radius_km integer not null default 25 check (radius_km between 5 and 100),
  latitude double precision,
  longitude double precision,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint driver_radar_valid_latitude check (latitude is null or latitude between -90 and 90),
  constraint driver_radar_valid_longitude check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.ride_request_radar_deliveries (
  request_id uuid not null,
  driver_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid,
  distance_km numeric(8,2),
  created_at timestamptz not null default now(),
  primary key (request_id, driver_id)
);

alter table public.driver_radar_preferences enable row level security;
alter table public.ride_request_radar_deliveries enable row level security;

revoke all on public.driver_radar_preferences from public, anon;
revoke all on public.ride_request_radar_deliveries from public, anon;
grant select on public.driver_radar_preferences to authenticated;

drop policy if exists driver_radar_read_own on public.driver_radar_preferences;
create policy driver_radar_read_own
on public.driver_radar_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists driver_radar_delivery_read_own on public.ride_request_radar_deliveries;
create policy driver_radar_delivery_read_own
on public.ride_request_radar_deliveries
for select
to authenticated
using (driver_id = auth.uid());

create or replace function public.update_driver_radar_presence(
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

  insert into public.driver_radar_preferences (
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
      latitude = coalesce(excluded.latitude, driver_radar_preferences.latitude),
      longitude = coalesce(excluded.longitude, driver_radar_preferences.longitude),
      last_seen_at = case when excluded.enabled then now() else driver_radar_preferences.last_seen_at end,
      updated_at = now();

  return jsonb_build_object(
    'success', true,
    'enabled', coalesce(p_enabled, false),
    'radius_km', v_radius,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.update_driver_radar_presence(boolean, integer, double precision, double precision) from public, anon;
grant execute on function public.update_driver_radar_presence(boolean, integer, double precision, double precision) to authenticated;

create or replace function public.get_my_driver_radar_preferences()
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
      from public.driver_radar_preferences
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

revoke all on function public.get_my_driver_radar_preferences() from public, anon;
grant execute on function public.get_my_driver_radar_preferences() to authenticated;

create or replace function public.notify_driver_radar_for_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request jsonb := to_jsonb(new);
  v_request_id uuid;
  v_requester_id uuid;
  v_origin jsonb;
  v_destination jsonb;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_destination_label text;
  v_origin_label text;
  v_departure_text text;
  v_seats integer;
  v_price numeric;
  v_driver record;
  v_distance_km numeric;
  v_notification_id uuid;
begin
  begin
    v_request_id := coalesce(nullif(v_request->>'id', '')::uuid, nullif(v_request->>'request_id', '')::uuid);
  exception when invalid_text_representation then
    return new;
  end;

  begin
    v_requester_id := coalesce(
      nullif(v_request->>'user_id', '')::uuid,
      nullif(v_request->>'passenger_id', '')::uuid,
      nullif(v_request->>'requester_id', '')::uuid
    );
  exception when invalid_text_representation then
    v_requester_id := null;
  end;

  v_origin := coalesce(v_request->'origin', '{}'::jsonb);
  v_destination := coalesce(v_request->'destination', '{}'::jsonb);

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

  if v_request_id is null or v_origin_lat is null or v_origin_lng is null then
    return new;
  end if;

  v_origin_label := coalesce(v_origin->>'name', v_origin->>'address', 'tu zona');
  v_destination_label := coalesce(v_destination->>'name', v_destination->>'address', 'destino indicado');
  v_departure_text := coalesce(v_request->>'departure_time', v_request->>'date_time', 'próximamente');

  begin
    v_seats := greatest(1, coalesce(
      nullif(v_request->>'seats_needed', '')::integer,
      nullif(v_request->>'seats', '')::integer,
      1
    ));
  exception when invalid_text_representation then
    v_seats := 1;
  end;

  begin
    v_price := coalesce(
      nullif(v_request->>'suggested_price', '')::numeric,
      nullif(v_request->>'price', '')::numeric,
      0
    );
  exception when invalid_text_representation then
    v_price := 0;
  end;

  for v_driver in
    select p.user_id,
           p.radius_km,
           6371 * 2 * asin(
             sqrt(
               power(sin(radians(p.latitude - v_origin_lat) / 2), 2)
               + cos(radians(v_origin_lat)) * cos(radians(p.latitude))
               * power(sin(radians(p.longitude - v_origin_lng) / 2), 2)
             )
           ) as distance_km
    from public.driver_radar_preferences p
    where p.enabled = true
      and p.latitude is not null
      and p.longitude is not null
      and p.last_seen_at >= now() - interval '24 hours'
      and (v_requester_id is null or p.user_id <> v_requester_id)
  loop
    v_distance_km := round(v_driver.distance_km::numeric, 2);
    if v_distance_km > v_driver.radius_km then
      continue;
    end if;

    insert into public.ride_request_radar_deliveries (request_id, driver_id, distance_km)
    values (v_request_id, v_driver.user_id, v_distance_km)
    on conflict (request_id, driver_id) do nothing;

    if not found then
      continue;
    end if;

    insert into public.notifications (
      user_id, actor_id, title, message, type, action_url,
      entity_type, entity_id, priority, metadata
    ) values (
      v_driver.user_id,
      v_requester_id,
      'Radar: pasajero cerca de ti',
      format('%s plaza(s) desde %s hasta %s. A %s km de tu zona.', v_seats, v_origin_label, v_destination_label, v_distance_km),
      'ride_request',
      '/requests/' || v_request_id::text,
      'ride_request',
      v_request_id::text,
      'normal',
      jsonb_build_object(
        'radar', true,
        'request_id', v_request_id,
        'distance_km', v_distance_km,
        'origin', v_origin_label,
        'destination', v_destination_label,
        'departure_time', v_departure_text,
        'seats', v_seats,
        'suggested_price', v_price
      )
    ) returning id into v_notification_id;

    update public.ride_request_radar_deliveries
    set notification_id = v_notification_id
    where request_id = v_request_id and driver_id = v_driver.user_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists ride_request_driver_radar on public.ride_requests;
create trigger ride_request_driver_radar
after insert on public.ride_requests
for each row execute function public.notify_driver_radar_for_request();

comment on table public.driver_radar_preferences is
  'Opt-in location and radius settings for drivers who want nearby passenger request alerts.';
comment on table public.ride_request_radar_deliveries is
  'Idempotent delivery ledger preventing duplicate radar alerts per request and driver.';
