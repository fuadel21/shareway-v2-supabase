-- ============================================================================
-- SHAREWAY · FIX_RADAR_TYPES.sql
-- ============================================================================
-- Bug critico: notifications.id es BIGINT (serial) en produccion, pero los
-- triggers del radar y create_notification lo trataban como UUID:
--   · notify_driver_radar_for_request -> CRASHEABA la creacion de solicitudes
--     con match real de radar (invalid uuid "727")
--   · notify_passenger_radar_for_ride -> mismo riesgo con viajes nuevos
--   · create_notification (2 overloads) -> notificaciones silenciosamente
--     perdidas (excepcion tragada)
--   · ride_*_radar_deliveries.notification_id era UUID -> BIGINT
-- Ademas: action_url '/requests/' -> '/request/' (ruta real de la app) y
-- recreacion explicita de ambos triggers (idempotente).
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- 1) Tipos de las tablas de entregas (vacias: conversion segura)
ALTER TABLE public.ride_request_radar_deliveries
  ALTER COLUMN notification_id TYPE BIGINT USING NULL::bigint;
ALTER TABLE public.ride_passenger_radar_deliveries
  ALTER COLUMN notification_id TYPE BIGINT USING NULL::bigint;

-- 2) create_notification canonica (BIGINT, robusta, una sola firma)
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSON, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_data JSONB DEFAULT '{}'::JSONB,
  p_priority TEXT DEFAULT 'normal',
  p_category TEXT DEFAULT 'general',
  p_scheduled_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_has_body BOOLEAN;
  v_has_message BOOLEAN;
  v_has_data BOOLEAN;
  v_has_metadata BOOLEAN;
  v_id BIGINT;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='body'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='message'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='data'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='metadata')
    INTO v_has_body, v_has_message, v_has_data, v_has_metadata;

  IF NOT (v_has_body OR v_has_message) THEN RETURN NULL; END IF;

  EXECUTE format(
    'INSERT INTO public.notifications (user_id, type, title, %s, %s, priority, category) '
      || 'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    COALESCE(CASE WHEN v_has_body THEN 'body' END, 'message'),
    COALESCE(CASE WHEN v_has_data THEN 'data' END, CASE WHEN v_has_metadata THEN 'metadata' END, '''{}''::jsonb')
  ) INTO v_id
  USING p_user_id, COALESCE(p_type, 'info'), p_title, p_body,
        CASE WHEN v_has_data OR v_has_metadata THEN COALESCE(p_data, '{}'::JSONB) END,
        COALESCE(p_priority, 'normal'), COALESCE(p_category, 'general');

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[create_notification] omitida: %', SQLERRM;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- 3) Trigger radar CONDUCTOR (parcheado: bigint + ruta /request/)
CREATE OR REPLACE FUNCTION public.notify_driver_radar_for_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_notification_id bigint;
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
      '/request/' || v_request_id::text,
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
$function$;

DROP TRIGGER IF EXISTS ride_request_driver_radar ON public.ride_requests;
CREATE TRIGGER ride_request_driver_radar
  AFTER INSERT ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_driver_radar_for_request();

-- 4) Trigger radar PASAJERO (parcheado: bigint)
CREATE OR REPLACE FUNCTION public.notify_passenger_radar_for_ride()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_notification_id bigint;
  v_route_match boolean;
begin
  begin
    v_ride_id := coalesce(
      nullif(v_ride->>'id', '')::uuid,
      nullif(v_ride->>'ride_id', '')::uuid
    );

    v_driver_id := nullif(v_ride->>'driver_id', '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  v_status := lower(coalesce(v_ride->>'status', 'scheduled'));

  if v_status not in ('scheduled', 'published', 'available') then
    return new;
  end if;

  v_origin := coalesce(v_ride->'origin', '{}'::jsonb);
  v_destination := coalesce(v_ride->'destination', '{}'::jsonb);

  begin
    v_origin_lat := public.radar_json_lat(v_origin);
    v_origin_lng := public.radar_json_lng(v_origin);
  exception when others then
    return new;
  end;

  if v_ride_id is null
     or v_origin_lat is null
     or v_origin_lng is null then
    return new;
  end if;

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

  if v_seats <= 0 then
    return new;
  end if;

  v_origin_label := coalesce(
    v_origin->>'name',
    v_origin->>'address',
    'tu zona'
  );

  v_destination_label := coalesce(
    v_destination->>'name',
    v_destination->>'address',
    'destino indicado'
  );

  v_departure_text := coalesce(
    v_ride->>'departure_time',
    v_ride->>'date_time',
    'próximamente'
  );

  for v_passenger in
    select
      p.user_id,
      p.radius_km,
      p.match_favorite_routes,
      p.destination_radius_km,
      public.radar_distance_km(
        p.latitude,
        p.longitude,
        v_origin_lat,
        v_origin_lng
      ) as distance_km
    from public.passenger_radar_preferences p
    where p.enabled = true
      and p.latitude is not null
      and p.longitude is not null
      and p.last_seen_at >= now() - interval '24 hours'
      and (
        v_driver_id is null
        or p.user_id <> v_driver_id
      )
  loop
    v_distance_km := round(v_passenger.distance_km::numeric, 2);

    if v_distance_km > v_passenger.radius_km then
      continue;
    end if;

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

    if not v_route_match then
      continue;
    end if;

    begin
      insert into public.ride_passenger_radar_deliveries (
        ride_id,
        passenger_id,
        distance_km
      )
      values (
        v_ride_id,
        v_passenger.user_id,
        v_distance_km
      )
      on conflict (ride_id, passenger_id) do nothing;

      if not found then
        continue;
      end if;

      insert into public.notifications (
        user_id,
        actor_id,
        title,
        message,
        type,
        action_url,
        entity_type,
        entity_id,
        priority,
        metadata
      )
      values (
        v_passenger.user_id,
        v_driver_id,
        case
          when v_passenger.match_favorite_routes
            then 'Radar: viaje compatible con tu ruta'
          else 'Radar: nuevo viaje cerca de ti'
        end,
        format(
          '%s plaza(s) desde %s hasta %s por %s €. Origen a %s km.',
          v_seats,
          v_origin_label,
          v_destination_label,
          trim(to_char(v_price, 'FM999999990.00')),
          v_distance_km
        ),
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
      )
      returning id into v_notification_id;

      update public.ride_passenger_radar_deliveries
      set notification_id = v_notification_id
      where ride_id = v_ride_id
        and passenger_id = v_passenger.user_id;

    exception when others then
      raise warning
        'Smart passenger radar failed for ride %, passenger %: %',
        v_ride_id,
        v_passenger.user_id,
        sqlerrm;
    end;
  end loop;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS ride_passenger_radar ON public.rides;
CREATE TRIGGER ride_passenger_radar
  AFTER INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.notify_passenger_radar_for_ride();

NOTIFY pgrst, 'reload schema';
