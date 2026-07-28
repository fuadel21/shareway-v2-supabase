-- Smart driver radar matching using favorite routes.
-- Keeps proximity-only behavior unless the driver explicitly enables route matching.

alter table public.driver_radar_preferences
  add column if not exists match_favorite_routes boolean not null default false,
  add column if not exists destination_radius_km integer not null default 25
    check (destination_radius_km between 5 and 100);

create or replace function public.set_driver_radar_route_filter(
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

  insert into public.driver_radar_preferences (
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

revoke all on function public.set_driver_radar_route_filter(boolean, integer)
from public, anon;
grant execute on function public.set_driver_radar_route_filter(boolean, integer)
to authenticated;

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
      from public.driver_radar_preferences p
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

create or replace function public.driver_favorite_route_matches_request(
  p_user_id uuid,
  p_request_origin jsonb,
  p_request_destination jsonb,
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
      and public.radar_json_lat(p_request_origin) is not null
      and public.radar_json_lng(p_request_origin) is not null
      and public.radar_json_lat(p_request_destination) is not null
      and public.radar_json_lng(p_request_destination) is not null
      and public.radar_distance_km(
        public.radar_json_lat(f.origin),
        public.radar_json_lng(f.origin),
        public.radar_json_lat(p_request_origin),
        public.radar_json_lng(p_request_origin)
      ) <= greatest(5, least(coalesce(p_origin_radius_km, 25), 100))
      and public.radar_distance_km(
        public.radar_json_lat(f.destination),
        public.radar_json_lng(f.destination),
        public.radar_json_lat(p_request_destination),
        public.radar_json_lng(p_request_destination)
      ) <= greatest(5, least(coalesce(p_destination_radius_km, 25), 100))
  );
$$;

revoke all on function public.driver_favorite_route_matches_request(uuid, jsonb, jsonb, integer, integer)
from public, anon, authenticated;

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
  v_origin_label text;
  v_destination_label text;
  v_departure_text text;
  v_seats integer;
  v_price numeric;
  v_driver record;
  v_distance_km numeric;
  v_notification_id uuid;
  v_route_match boolean;
begin
  begin
    v_request_id := coalesce(
      nullif(v_request->>'id', '')::uuid,
      nullif(v_request->>'request_id', '')::uuid
    );
    v_requester_id := coalesce(
      nullif(v_request->>'user_id', '')::uuid,
      nullif(v_request->>'passenger_id', '')::uuid,
      nullif(v_request->>'requester_id', '')::uuid
    );
  exception when invalid_text_representation then
    return new;
  end;

  v_origin := coalesce(v_request->'origin', '{}'::jsonb);
  v_destination := coalesce(v_request->'destination', '{}'::jsonb);

  begin
    v_origin_lat := public.radar_json_lat(v_origin);
    v_origin_lng := public.radar_json_lng(v_origin);
  exception when others then
    return new;
  end;

  if v_request_id is null or v_origin_lat is null or v_origin_lng is null then
    return new;
  end if;

  begin
    v_seats := greatest(1, coalesce(
      nullif(v_request->>'seats_needed', '')::integer,
      nullif(v_request->>'seats', '')::integer,
      1
    ));
    v_price := coalesce(
      nullif(v_request->>'suggested_price', '')::numeric,
      nullif(v_request->>'price', '')::numeric,
      0
    );
  exception when invalid_text_representation then
    v_seats := 1;
    v_price := 0;
  end;

  v_origin_label := coalesce(v_origin->>'name', v_origin->>'address', 'tu zona');
  v_destination_label := coalesce(v_destination->>'name', v_destination->>'address', 'destino indicado');
  v_departure_text := coalesce(v_request->>'departure_time', v_request->>'date_time', 'próximamente');

  for v_driver in
    select
      p.user_id,
      p.radius_km,
      p.match_favorite_routes,
      p.destination_radius_km,
      public.radar_distance_km(p.latitude, p.longitude, v_origin_lat, v_origin_lng) as distance_km
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

    v_route_match := true;
    if v_driver.match_favorite_routes then
      v_route_match := public.driver_favorite_route_matches_request(
        v_driver.user_id,
        v_origin,
        v_destination,
        v_driver.radius_km,
        v_driver.destination_radius_km
      );
    end if;

    if not v_route_match then
      continue;
    end if;

    begin
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
        case when v_driver.match_favorite_routes
          then 'Radar: solicitud compatible con tu ruta'
          else 'Radar: pasajero cerca de ti'
        end,
        format(
          '%s plaza(s) desde %s hasta %s. Origen a %s km de tu zona.',
          v_seats, v_origin_label, v_destination_label, v_distance_km
        ),
        'ride_request',
        '/request/' || v_request_id::text,
        'ride_request',
        v_request_id::text,
        'normal',
        jsonb_build_object(
          'radar', true,
          'radar_mode', 'driver',
          'smart_route_match', v_driver.match_favorite_routes,
          'request_id', v_request_id,
          'distance_km', v_distance_km,
          'origin', v_origin_label,
          'destination', v_destination_label,
          'departure_time', v_departure_text,
          'seats', v_seats,
          'suggested_price', v_price,
          'action', 'offer_ride'
        )
      ) returning id into v_notification_id;

      update public.ride_request_radar_deliveries
      set notification_id = v_notification_id
      where request_id = v_request_id and driver_id = v_driver.user_id;
    exception when others then
      raise warning 'Smart driver radar failed for request %, driver %: %',
        v_request_id, v_driver.user_id, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

comment on column public.driver_radar_preferences.match_favorite_routes is
  'When enabled, passenger requests must match at least one saved favorite route origin and destination.';
comment on column public.driver_radar_preferences.destination_radius_km is
  'Maximum distance between the request destination and the saved favorite-route destination.';
