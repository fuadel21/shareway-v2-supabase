-- ShareWay automatic ride notifications
-- Creates notifications when a passenger joins a ride and when a ride is cancelled.

create or replace function public.notify_driver_on_new_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added_user_id uuid;
  ride_title text;
begin
  if new.participant_ids is null then
    return new;
  end if;

  ride_title := coalesce(new.origin_address, 'Origen') || ' → ' || coalesce(new.destination_address, 'Destino');

  for added_user_id in
    select participant::uuid
    from unnest(new.participant_ids) as participant
    where old.participant_ids is null or participant <> all(old.participant_ids)
  loop
    if added_user_id is not null and added_user_id <> new.driver_id then
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
        new.driver_id,
        added_user_id,
        'ride_request',
        'Nueva reserva en tu viaje',
        'Un pasajero ha reservado plaza en ' || ride_title || '.',
        '/ride/' || new.id::text,
        'ride',
        new.id::text,
        'high',
        jsonb_build_object(
          'ride_id', new.id,
          'passenger_id', added_user_id,
          'origin', new.origin_address,
          'destination', new.destination_address,
          'departure_time', new.departure_time
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists ride_new_participant_notification on public.rides;
create trigger ride_new_participant_notification
after update of participant_ids on public.rides
for each row
when (old.participant_ids is distinct from new.participant_ids)
execute function public.notify_driver_on_new_participant();

create or replace function public.notify_passengers_on_ride_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  passenger_id uuid;
  ride_title text;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  if new.participant_ids is null then
    return new;
  end if;

  ride_title := coalesce(new.origin_address, 'Origen') || ' → ' || coalesce(new.destination_address, 'Destino');

  for passenger_id in
    select participant::uuid
    from unnest(new.participant_ids) as participant
  loop
    if passenger_id is not null and passenger_id <> new.driver_id then
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
        passenger_id,
        new.driver_id,
        'ride_cancelled',
        'Viaje cancelado',
        'El viaje ' || ride_title || ' ha sido cancelado.',
        '/ride/' || new.id::text,
        'ride',
        new.id::text,
        'critical',
        jsonb_build_object(
          'ride_id', new.id,
          'driver_id', new.driver_id,
          'origin', new.origin_address,
          'destination', new.destination_address,
          'departure_time', new.departure_time
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists ride_cancelled_notification on public.rides;
create trigger ride_cancelled_notification
after update of status on public.rides
for each row
when (old.status is distinct from new.status)
execute function public.notify_passengers_on_ride_cancelled();
