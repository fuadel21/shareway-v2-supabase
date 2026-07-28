-- Keep enabled driver/passenger radar presence fresh while the authenticated app is active.
-- This never enables a disabled radar and never changes saved coordinates.

create or replace function public.touch_my_radar_presence()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_driver_touched boolean := false;
  v_passenger_touched boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'No autenticado');
  end if;

  update public.driver_radar_preferences
  set last_seen_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and enabled = true;
  v_driver_touched := found;

  update public.passenger_radar_preferences
  set last_seen_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and enabled = true;
  v_passenger_touched := found;

  return jsonb_build_object(
    'success', true,
    'driver_touched', v_driver_touched,
    'passenger_touched', v_passenger_touched,
    'touched_at', now()
  );
end;
$$;

revoke all on function public.touch_my_radar_presence() from public, anon;
grant execute on function public.touch_my_radar_presence() to authenticated;

comment on function public.touch_my_radar_presence() is
  'Refreshes last_seen_at only for the authenticated user radar modes that are already enabled.';
