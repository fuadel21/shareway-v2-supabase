-- Make admin notifications resilient so SOS alert creation is never blocked by notification delivery.
-- If the notification insert fails, the emergency alert row still remains valid and the trigger only emits a warning.

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
  select coalesce(
    nullif(to_jsonb(p)->>'display_name', ''),
    nullif(to_jsonb(p)->>'email', ''),
    'Usuario ShareWay'
  )
  into v_actor_name
  from public.profiles p
  where p.id = new.user_id;

  select
    coalesce(
      to_jsonb(r)->'origin'->>'name',
      to_jsonb(r)->'origin'->>'address',
      to_jsonb(r)->>'origin',
      'Origen no disponible'
    ),
    coalesce(
      to_jsonb(r)->'destination'->>'name',
      to_jsonb(r)->'destination'->>'address',
      to_jsonb(r)->>'destination',
      'Destino no disponible'
    ),
    nullif(to_jsonb(r)->>'departure_time', '')::timestamptz
  into v_origin, v_destination, v_departure_time
  from public.rides r
  where r.id = new.ride_id;

  v_location := coalesce(to_jsonb(new)->'current_location', to_jsonb(new)->'location');

  begin
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
        case
          when v_origin is not null and v_destination is not null
            then concat(' en el viaje ', v_origin, ' → ', v_destination)
          else ''
        end,
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
    where lower(coalesce(to_jsonb(p)->>'role', '')) in ('admin', 'super_admin')
       or lower(coalesce(to_jsonb(p)->>'is_admin', 'false')) in ('true', '1', 'yes');
  exception
    when check_violation then
      begin
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
          concat(v_actor_name, ' ha activado SOS. Revisa el panel de emergencias.'),
          'system',
          '/admin/sos',
          'emergency_alert',
          new.id::text,
          'high',
          true,
          jsonb_build_object(
            'alert_id', new.id,
            'ride_id', new.ride_id,
            'chat_id', new.chat_id,
            'triggered_by', new.user_id,
            'status', new.status,
            'severity', new.severity,
            'current_location', v_location,
            'fallback_reason', 'priority_check_violation',
            'source', 'notify_admins_on_emergency_alert'
          )
        from public.profiles p
        where lower(coalesce(to_jsonb(p)->>'role', '')) in ('admin', 'super_admin')
           or lower(coalesce(to_jsonb(p)->>'is_admin', 'false')) in ('true', '1', 'yes');
      exception
        when others then
          raise warning 'notify_admins_on_emergency_alert fallback skipped: %', sqlerrm;
      end;
    when others then
      raise warning 'notify_admins_on_emergency_alert skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.notify_admins_on_emergency_alert()
is 'Creates admin notifications for SOS alerts without blocking emergency_alerts inserts if notification delivery fails.';

drop trigger if exists trg_notify_admins_on_emergency_alert on public.emergency_alerts;

create trigger trg_notify_admins_on_emergency_alert
after insert on public.emergency_alerts
for each row
execute function public.notify_admins_on_emergency_alert();
