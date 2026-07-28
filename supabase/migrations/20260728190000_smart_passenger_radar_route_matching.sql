-- Smart passenger radar matching using favorite routes.
-- Keeps proximity-only behavior unless the passenger explicitly enables route matching.

alter table public.passenger_radar_preferences
  add column if not exists match_favorite_routes boolean not null default false,
  add column if not exists destination_radius_km integer not null default 25
    check (destination_radius_km between 5 and 100);

create or replace function public.radar_json_lat(p_location jsonb)
returns double precision
language sql
immutable
strict
as $$
  select coalesce(
    nullif(p_location->>'lat', '')::double precision,
    nullif(p_location->>'latitude', '')::double precision,
    nullif(p_location#>>'{coordinates,lat}', '')::double precision,
    nullif(p_location#>>'{coordinates,latitude}', '')::double precision
  );
$$;

create or replace function public.radar_json_lng(p_location jsonb)
returns double precision
language sql
immutable
strict
as $$
  select coalesce(
    nullif(p_location->>'lng', '')::double precision,
    nullif(p_location->>'longitude', '')::double precision,
    nullif(p_location#>>'{coordinates,lng}', '')::double precision,
    nullif(p_location#>>'{coordinates,longitude}', '')::double precision
  );
$$;

create or replace function public.radar_distance_km(
  p_lat_a double precision,
  p_lng_a double precision,
  p_lat_b double precision,
  p_lng_b double precision
)
returns double precision
language sql
immutable
strict
as $$
  select 6371 * 2 * asin(
    least(1, sqrt(
      power(sin(radians(p_lat_b - p_lat_a) / 2), 2)
      + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
      * power(sin(radians(p_lng_b - p_lng_a) / 2), 2)
    ))
  );
$$;

create or replace function public.set_passenger_radar_route_filter(
  p_enabled boolean,
  p_destination_radius_km integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_radius integer := greatest(5, least(coalesce(p_destination_radius_km, 25), 100));
  v_route_count integer;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'No autenticado');
  end if;

  select count(*) into v_route_count
  from public.favorite_routes
  where user_id = v_user_id;

  if coalesce(p_enabled, false) and v_route_count = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Añade al menos una ruta favorita antes de activar este filtro'
    );
  end if;

  insert into public.passenger_radar_preferences (
    user_id, match_favorite_routes, destination_radius_km, updated_at
  ) values (
    v_user_id, coalesce(p_enabled, false), v_radius, now()
  )
  on conflict (user_id) do update
  set match_favorite_routes = excluded.match_favorite_routes,
      destination_radius_km = excluded.destination_radius_km,
      updated_at = now();

  return jsonb_build_object(
    'success', true,
    'match_favorite_routes', coalesce(p_enabled, false),
    'destination_radius_km', v_radius,
    'favorite_routes_count', v_route_count
  );
end;
$$;

revoke all on function public.set_passenger_radar_route_filter(boolean, integer)
from public, anon;
grant execute on function public.set_passenger_radar_route_filter(boolean, integer)
to authenticated;

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
        'enabled', p.enabled,
        'radius_km', p.radius_km,
        'has_location', p.latitude is not null and p.longitude is not null,
        'last_seen_at', p.last_seen_at,
        'updated_at', p.updated_at,
        'match_favorite_routes', p.match_favorite_routes,
        'destination_radius_km', p.destination_radius_km,
        'favorite_routes_count', (
          select count(*) from public.favorite_routes f where f.user_id = auth.uid()
        )
      )
      from public.passenger_radar_preferences p
      where p.user_id = auth.uid()
    ),
    jsonb_build_object(
      'success', true,
      'enabled', false,
      'radius_km', 25,
      'has_location', false,
      'match_favorite_routes', false,
      'destination_radius_km', 25,
      'favorite_routes_count', (
        select count(*) from public.favorite_routes f where f.user_id = auth.uid()
      )
    )
  );
$$;

create or replace function public.passenger_favorite_route_matches_ride(
  p_user_id uuid,
  p_ride_origin jsonb,
  p_ride_destination jsonb,
  p_origin_radius_km integer,
  p_destination_radius_km integer
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.favorite_routes f
    where f.user_id = p_user_id
      and public.radar_json_lat(f.origin) is not null
      and public.radar_json_lng(f.origin) is not null
      and public.radar_json_lat(f.destination) is not null
      and public.radar_json_lng(f.destination) is not null
      and public.radar_distance_km(
        public.radar_json_lat(f.origin),
        public.radar_json_lng(f.origin),
        public.radar_json_lat(p_ride_origin),
        public.radar_json_lng(p_ride_origin)
      ) <= greatest(5, least(coalesce(p_origin_radius_km, 25), 100))
      and public.radar_distance_km(
        public.radar_json_lat(f.destination),
        public.radar_json_lng(f.destination),
        public.radar_json_lat(p_ride_destination),
        public.radar_json_lng(p_ride_destination)
      ) <= greatest(5, least(coalesce(p_destination_radius_km, 25), 100))
  );
$$;

revoke all on function public.passenger_favorite_route_matches_ride(uuid, jsonb, jsonb, integer, integer)
from public, anon, authenticated;

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
  v_route_match boolean;
begin
  begin
    v_ride_id := coalesce(nullif(v_ride->>'id', '')::uuid, nullif(v_ride->>'ride_id', '')::uuid);
    v_driver_id := nullif(v_ride->>'driver_id', '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  v_status := lower(coalesce(v_ride->>'status', 'scheduled'));
  if v_status not in ('scheduled', 'published', 'available') then return new; end if;

  v_origin := coalesce(v_ride->'origin', '{}'::jsonb);
  v_destination := coalesce(v_ride->'destination', '{}'::jsonb);

  begin
    v_origin_lat := public.radar_json_lat(v_origin);
    v_origin_lng := public.radar_json_lng(v_origin);
  exception when others then
    return new;
  end;

  if v_ride_id is null or v_origin_lat is null or v_origin_lng is null then return new; end if;

  begin
    v_seats := greatest(0, coalesce(
      nullif(v_ride->>'seats_available', '')::integer,
      nullif(v_ride->>'available_seats', '')::integer,
      nullif(v_ride->>'seats', '')::integer,
      0
    ));
    v_price := coalesce(
      nullif(v_ride->>'price_per_seat', '')::numeric,
      nullif(v_ride->>'price', '')::numeric,
      0
    );
  exception when invalid_text_representation then
    return new;
  end;

  if v_seats <= 0 then return new; end if;

  v_origin_label := coalesce(v_origin->>'name', v_origin->>'address', 'tu zona');
  v_destination_label := coalesce(v_destination->>'name', v_destination->>'address', 'destino indicado');
  v_departure_text := coalesce(v_ride->>'departure_time', v_ride->>'date_time', 'próximamente');

  for v_passenger in
    select p.user_id, p.radius_km, p.match_favorite_routes, p.destination_radius_km,
           public.radar_distance_km(p.latitude, p.longitude, v_origin_lat, v_origin_lng) as distance_km
    from public.passenger_radar_preferences p
    where p.enabled = true
      and p.latitude is not null
      and p.longitude is not null
      and p.last_seen_at >= now() - interval '24 hours'
      and (v_driver_id is null or p.user_id <> v_driver_id)
  loop
    v_distance_km := round(v_passenger.distance_km::numeric, 2);
    if v_distance_km > v_passenger.radius_km then continue; end if;

    v_route_match := true;
    if v_passenger.match_favorite_routes then
      v_route_match := public.passenger_favorite_route_matches_ride(
        v_passenger.user_id,
        v_origin,
        v_destination,
        v_passenger.radius_km,
        v_passenger.destination_radius_km
      );
    end if;

    if not v_route_match then continue; end if;

    begin
      insert into public.ride_passenger_radar_deliveries (ride_id, passenger_id, distance_km)
      values (v_ride_id, v_passenger.user_id, v_distance_km)
      on conflict (ride_id, passenger_id) do nothing;

      if not found then continue; end if;

      insert into public.notifications (
        user_id, actor_id, title, message, type, action_url,
        entity_type, entity_id, priority, metadata
      ) values (
        v_passenger.user_id,
        v_driver_id,
        case when v_passenger.match_favorite_routes
          then 'Radar: viaje compatible con tu ruta'
          else 'Radar: nuevo viaje cerca de ti'
        end,
        format('%s plaza(s) desde %s hasta %s por %s €. Origen a %s km.',
          v_seats, v_origin_label, v_destination_label,
          trim(to_char(v_price, 'FM999999990.00')), v_distance_km),
        'ride_request',
        '/ride/' || v_ride_id::text,
        'ride',
        v_ride_id::text,
        'normal',
        jsonb_build_object(
          'radar', true,
          'radar_mode', 'passenger',
          'smart_route_match', v_passenger.match_favorite_routes,
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
      raise warning 'Smart passenger radar failed for ride %, passenger %: %',
        v_ride_id, v_passenger.user_id, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

comment on column public.passenger_radar_preferences.match_favorite_routes is
  'When enabled, nearby rides must also match at least one saved favorite route origin and destination.';
comment on column public.passenger_radar_preferences.destination_radius_km is
  'Maximum distance between the ride destination and the saved favorite-route destination.';
