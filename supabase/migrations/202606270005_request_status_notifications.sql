-- Notify passengers when their ride request changes status.
-- This avoids coupling notifications to a specific frontend screen.

create or replace function public.notify_requester_on_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_title text;
  notification_message text;
  notification_type text;
  notification_priority text;
begin
  if new.requester_id is null then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status in ('fulfilled', 'accepted') then
    notification_title := 'Solicitud aceptada';
    notification_message := 'Un conductor ha aceptado tu solicitud de viaje.';
    notification_type := 'request_accepted';
    notification_priority := 'high';
  elsif new.status in ('rejected', 'cancelled', 'canceled') then
    notification_title := 'Solicitud no disponible';
    notification_message := 'Tu solicitud de viaje ya no está disponible.';
    notification_type := 'request_rejected';
    notification_priority := 'normal';
  else
    return new;
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
    new.requester_id,
    null,
    notification_type,
    notification_title,
    notification_message,
    '/my-requests',
    'ride_request',
    new.id::text,
    notification_priority,
    jsonb_build_object(
      'request_id', new.id,
      'status', new.status,
      'origin', new.origin,
      'destination', new.destination,
      'departure_time', new.departure_time
    )
  );

  return new;
end;
$$;

drop trigger if exists ride_request_status_notification on public.ride_requests;
create trigger ride_request_status_notification
after update of status on public.ride_requests
for each row
when (old.status is distinct from new.status)
execute function public.notify_requester_on_request_status_change();
