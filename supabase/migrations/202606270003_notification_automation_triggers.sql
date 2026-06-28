-- ShareWay notifications automation v1
-- Database-level notification hooks for reviews, chat messages, booking status changes and ride cancellations.
-- All trigger creation is guarded with table/column checks to avoid breaking older environments.

create or replace function public.create_system_notification(
  p_user_id uuid,
  p_actor_id uuid default null,
  p_type text default 'system',
  p_title text default 'ShareWay',
  p_message text default '',
  p_action_url text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  insert into public.notifications (
    user_id,
    actor_id,
    type,
    title,
    message,
    action_url,
    entity_type,
    entity_id,
    priority,
    metadata
  ) values (
    p_user_id,
    p_actor_id,
    coalesce(p_type, 'system'),
    coalesce(p_title, 'ShareWay'),
    p_message,
    p_action_url,
    p_entity_type,
    p_entity_id,
    coalesce(p_priority, 'normal'),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

create or replace function public.notify_review_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_reviewee_id uuid;
  v_reviewer_id uuid;
  v_ride_id text;
  v_rating text;
begin
  v_reviewee_id := nullif(v_payload->>'reviewee_id', '')::uuid;
  v_reviewer_id := nullif(v_payload->>'reviewer_id', '')::uuid;
  v_ride_id := coalesce(v_payload->>'ride_id', v_payload->>'id');
  v_rating := coalesce(v_payload->>'rating', '?');

  perform public.create_system_notification(
    v_reviewee_id,
    v_reviewer_id,
    'review',
    'Nueva valoración recibida',
    'Has recibido una valoración de ' || v_rating || '/5.',
    '/profile/' || v_reviewee_id::text,
    'review',
    v_ride_id,
    'normal',
    jsonb_build_object('rideId', v_ride_id, 'rating', v_rating, 'reviewerId', v_reviewer_id)
  );

  return new;
exception when others then
  raise warning '[notifications] review trigger skipped: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.notify_message_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_sender_id uuid;
  v_recipient_id uuid;
  v_chat_id text;
  v_ride_id text;
  v_preview text;
  v_sql text;
  v_participant record;
begin
  v_sender_id := nullif(v_payload->>'sender_id', '')::uuid;
  v_recipient_id := nullif(coalesce(v_payload->>'recipient_id', v_payload->>'receiver_id'), '')::uuid;
  v_chat_id := coalesce(v_payload->>'chat_id', v_payload->>'conversation_id', v_payload->>'id');
  v_ride_id := coalesce(v_payload->>'ride_id', v_payload->>'trip_id');
  v_preview := left(coalesce(v_payload->>'content', v_payload->>'message', v_payload->>'body', v_payload->>'text', 'Tienes un nuevo mensaje en ShareWay.'), 160);

  if v_recipient_id is not null and v_recipient_id <> v_sender_id then
    perform public.create_system_notification(
      v_recipient_id,
      v_sender_id,
      'chat_message',
      'Nuevo mensaje',
      v_preview,
      case when v_ride_id is not null then '/rides/' || v_ride_id || '/chat/' || v_chat_id else '/chat/' || v_chat_id end,
      'chat',
      v_chat_id,
      'normal',
      jsonb_build_object('senderId', v_sender_id, 'recipientId', v_recipient_id, 'chatId', v_chat_id, 'rideId', v_ride_id)
    );
    return new;
  end if;

  if to_regclass('public.chat_participants') is not null and v_chat_id is not null then
    v_sql := 'select user_id from public.chat_participants where chat_id::text = $1 and user_id <> $2';
    for v_participant in execute v_sql using v_chat_id, v_sender_id loop
      perform public.create_system_notification(
        v_participant.user_id,
        v_sender_id,
        'chat_message',
        'Nuevo mensaje',
        v_preview,
        case when v_ride_id is not null then '/rides/' || v_ride_id || '/chat/' || v_chat_id else '/chat/' || v_chat_id end,
        'chat',
        v_chat_id,
        'normal',
        jsonb_build_object('senderId', v_sender_id, 'recipientId', v_participant.user_id, 'chatId', v_chat_id, 'rideId', v_ride_id)
      );
    end loop;
  end if;

  return new;
exception when others then
  raise warning '[notifications] message trigger skipped: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.notify_booking_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_old_payload jsonb := coalesce(to_jsonb(old), '{}'::jsonb);
  v_status text;
  v_old_status text;
  v_user_id uuid;
  v_ride_id text;
  v_driver_id uuid;
  v_driver_name text := 'El conductor';
begin
  v_status := lower(coalesce(v_payload->>'status', v_payload->>'booking_status', ''));
  v_old_status := lower(coalesce(v_old_payload->>'status', v_old_payload->>'booking_status', ''));

  if tg_op = 'UPDATE' and v_status = v_old_status then
    return new;
  end if;

  v_user_id := nullif(coalesce(v_payload->>'passenger_id', v_payload->>'user_id', v_payload->>'requester_id'), '')::uuid;
  v_ride_id := coalesce(v_payload->>'ride_id', v_payload->>'trip_id');

  if v_ride_id is not null and to_regclass('public.rides') is not null then
    select r.driver_id into v_driver_id
    from public.rides r
    where r.id::text = v_ride_id
    limit 1;
  end if;

  if v_status in ('pending', 'requested', 'request') and v_driver_id is not null then
    perform public.create_system_notification(
      v_driver_id,
      v_user_id,
      'ride_request',
      'Nueva solicitud de plaza',
      'Un pasajero quiere unirse a tu viaje.',
      '/ride/' || v_ride_id,
      'ride',
      v_ride_id,
      'high',
      jsonb_build_object('passengerId', v_user_id, 'rideId', v_ride_id, 'status', v_status)
    );
  elsif v_status in ('accepted', 'confirmed', 'approved') then
    perform public.create_system_notification(
      v_user_id,
      v_driver_id,
      'request_accepted',
      'Solicitud aceptada',
      v_driver_name || ' ha aceptado tu plaza. Ya puedes ver los detalles del viaje.',
      '/ride/' || v_ride_id,
      'ride',
      v_ride_id,
      'high',
      jsonb_build_object('driverId', v_driver_id, 'passengerId', v_user_id, 'rideId', v_ride_id, 'status', v_status)
    );
  elsif v_status in ('rejected', 'declined', 'denied') then
    perform public.create_system_notification(
      v_user_id,
      v_driver_id,
      'request_rejected',
      'Solicitud rechazada',
      v_driver_name || ' no ha podido aceptar tu solicitud para este viaje.',
      '/dashboard',
      'ride',
      v_ride_id,
      'normal',
      jsonb_build_object('driverId', v_driver_id, 'passengerId', v_user_id, 'rideId', v_ride_id, 'status', v_status)
    );
  end if;

  return new;
exception when others then
  raise warning '[notifications] booking trigger skipped: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.notify_ride_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_old_payload jsonb := coalesce(to_jsonb(old), '{}'::jsonb);
  v_ride_id text := v_payload->>'id';
  v_driver_id uuid := nullif(v_payload->>'driver_id', '')::uuid;
  v_origin text := coalesce(v_payload->>'origin_address', v_payload#>>'{origin,address}', '');
  v_destination text := coalesce(v_payload->>'destination_address', v_payload#>>'{destination,address}', '');
  v_status text := lower(coalesce(v_payload->>'status', ''));
  v_old_status text := lower(coalesce(v_old_payload->>'status', ''));
  v_sql text;
  v_passenger record;
begin
  if tg_op <> 'UPDATE' or v_status <> 'cancelled' or v_old_status = 'cancelled' then
    return new;
  end if;

  if to_regclass('public.ride_passengers') is not null then
    v_sql := 'select coalesce(passenger_id, user_id) as user_id from public.ride_passengers where ride_id::text = $1 and coalesce(status, '''') <> ''cancelled''';
    for v_passenger in execute v_sql using v_ride_id loop
      perform public.create_system_notification(
        v_passenger.user_id,
        v_driver_id,
        'ride_cancelled',
        'Viaje cancelado',
        'Se ha cancelado el viaje ' || v_origin || case when v_destination <> '' then ' → ' || v_destination else '' end || '.',
        '/ride/' || v_ride_id,
        'ride',
        v_ride_id,
        'critical',
        jsonb_build_object('driverId', v_driver_id, 'rideId', v_ride_id, 'origin', v_origin, 'destination', v_destination)
      );
    end loop;
  end if;

  if to_regclass('public.bookings') is not null then
    v_sql := 'select coalesce(passenger_id, user_id) as user_id from public.bookings where ride_id::text = $1 and coalesce(status, '''') <> ''cancelled''';
    for v_passenger in execute v_sql using v_ride_id loop
      perform public.create_system_notification(
        v_passenger.user_id,
        v_driver_id,
        'ride_cancelled',
        'Viaje cancelado',
        'Se ha cancelado el viaje ' || v_origin || case when v_destination <> '' then ' → ' || v_destination else '' end || '.',
        '/ride/' || v_ride_id,
        'ride',
        v_ride_id,
        'critical',
        jsonb_build_object('driverId', v_driver_id, 'rideId', v_ride_id, 'origin', v_origin, 'destination', v_destination)
      );
    end loop;
  end if;

  return new;
exception when others then
  raise warning '[notifications] ride cancellation trigger skipped: %', sqlerrm;
  return new;
end;
$$;

-- Attach triggers only when matching tables exist.
do $$
begin
  if to_regclass('public.reviews') is not null then
    execute 'drop trigger if exists reviews_notify_inserted on public.reviews';
    execute 'create trigger reviews_notify_inserted after insert on public.reviews for each row execute function public.notify_review_inserted()';
  end if;

  if to_regclass('public.messages') is not null then
    execute 'drop trigger if exists messages_notify_inserted on public.messages';
    execute 'create trigger messages_notify_inserted after insert on public.messages for each row execute function public.notify_message_inserted()';
  end if;

  if to_regclass('public.ride_passengers') is not null then
    execute 'drop trigger if exists ride_passengers_notify_status on public.ride_passengers';
    execute 'create trigger ride_passengers_notify_status after insert or update on public.ride_passengers for each row execute function public.notify_booking_status_changed()';
  end if;

  if to_regclass('public.bookings') is not null then
    execute 'drop trigger if exists bookings_notify_status on public.bookings';
    execute 'create trigger bookings_notify_status after insert or update on public.bookings for each row execute function public.notify_booking_status_changed()';
  end if;

  if to_regclass('public.rides') is not null then
    execute 'drop trigger if exists rides_notify_cancelled on public.rides';
    execute 'create trigger rides_notify_cancelled after update on public.rides for each row execute function public.notify_ride_cancelled()';
  end if;
end;
$$;
