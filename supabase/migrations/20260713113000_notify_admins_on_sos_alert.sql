-- Notify admins automatically when a new SOS emergency alert is created.
-- Depends on public.emergency_alerts from PR #28 and public.notifications.

create or replace function public.notify_admins_on_emergency_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text := 'Usuario ShareWay';
  v_origin text := null;
  v_destination text := null;
  v_departure_time timestamptz := null;
  v_location jsonb := null;
begin
  select coalesce(nullif(p.display_name, ''), nullif(p.email, ''), 'Usuario ShareWay')
  into v_actor_name
  from public.profiles p
  where p.id = new.user_id;

  select
    coalesce(to_jsonb(r)->'origin'->>'name', to_jsonb(r)->'origin'->>'address', to_jsonb(r)->>'origin', 'Origen no disponible'),
    coalesce(to_jsonb(r)->'destination'->>'name', to_jsonb(r)->'destination'->>'address', to_jsonb(r)->>'destination', 'Destino no disponible'),
    nullif(to_jsonb(r)->>'departure_time', '')::timestamptz
  into v_origin, v_destination, v_departure_time
  from public.rides r
  where r.id = new.ride_id;

  v_location := coalesce(new.current_location, to_jsonb(new)->'location');

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
    is_pinned,
    metadata
  )
  select
    p.id,
    new.user_id,
    '🚨 Alerta SOS activa',
    concat(
      v_actor_name,
      ' ha activado SOS',
      case when v_origin is not null and v_destination is not null then concat(' en el viaje ', v_origin, ' → ', v_destination) else '' end,
      '. Revisa el panel de emergencias.'
    ),
    'system',
    '/admin/sos',
    'emergency_alert',
    new.id::text,
    'critical',
    true,
    jsonb_build_object(
      'alert_id', new.id,
      'ride_id', new.ride_id,
      'chat_id', new.chat_id,
      'triggered_by', new.user_id,
      'status', new.status,
      'severity', new.severity,
      'current_location', v_location,
      'origin', v_origin,
      'destination', v_destination,
      'departure_time', v_departure_time,
      'source', 'notify_admins_on_emergency_alert'
    )
  from public.profiles p
  where coalesce(p.role, '') in ('admin', 'super_admin')
     or coalesce(p.is_admin, false) = true;

  return new;
end;
$$;

comment on function public.notify_admins_on_emergency_alert()
is 'Creates pinned critical notifications for all admins when an emergency_alerts row is inserted.';

drop trigger if exists trg_notify_admins_on_emergency_alert on public.emergency_alerts;
create trigger trg_notify_admins_on_emergency_alert
after insert on public.emergency_alerts
for each row
execute function public.notify_admins_on_emergency_alert();
