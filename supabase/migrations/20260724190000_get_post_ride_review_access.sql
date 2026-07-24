-- Participant-aware post-ride review access without exposing completed ride rows.
create or replace function public.get_post_ride_review_access(
  p_ride_id uuid,
  p_reviewee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_reviewer_participated boolean := false;
  v_reviewee_participated boolean := false;
  v_passenger jsonb;
  v_passenger_id uuid;
  v_status text;
begin
  if v_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Sesión no válida.');
  end if;

  if p_ride_id is null or p_reviewee_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Datos de valoración no válidos.');
  end if;

  if v_user_id = p_reviewee_id then
    return jsonb_build_object('allowed', false, 'reason', 'No puedes valorarte a ti mismo.');
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'Viaje no encontrado.');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'completed' then
    return jsonb_build_object('allowed', false, 'reason', 'Solo puedes valorar después de completar el viaje.');
  end if;

  v_reviewer_participated := v_ride.driver_id = v_user_id;
  v_reviewee_participated := v_ride.driver_id = p_reviewee_id;

  if v_ride.participant_ids is not null then
    v_reviewer_participated := v_reviewer_participated or v_user_id = any(v_ride.participant_ids);
    v_reviewee_participated := v_reviewee_participated or p_reviewee_id = any(v_ride.participant_ids);
  end if;

  for v_passenger in
    select value from jsonb_array_elements(coalesce(v_ride.passengers, '[]'::jsonb))
  loop
    begin
      v_passenger_id := coalesce(
        nullif(v_passenger->>'id', '')::uuid,
        nullif(v_passenger->>'user_id', '')::uuid,
        nullif(v_passenger->>'passenger_id', '')::uuid
      );
    exception when invalid_text_representation then
      v_passenger_id := null;
    end;

    v_status := lower(coalesce(v_passenger->>'status', ''));
    if v_passenger_id is not null and (
      v_status = '' or v_status in ('confirmed', 'accepted', 'pending_boarding', 'verified', 'completed')
    ) then
      v_reviewer_participated := v_reviewer_participated or v_passenger_id = v_user_id;
      v_reviewee_participated := v_reviewee_participated or v_passenger_id = p_reviewee_id;
    end if;
  end loop;

  if not v_reviewer_participated then
    return jsonb_build_object('allowed', false, 'reason', 'No participaste en este viaje.');
  end if;
  if not v_reviewee_participated then
    return jsonb_build_object('allowed', false, 'reason', 'El usuario indicado no participó en este viaje.');
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'ride_id', v_ride.id,
    'ride_status', v_ride.status,
    'completed_at', v_ride.completed_at
  );
end;
$$;

revoke all on function public.get_post_ride_review_access(uuid, uuid) from public;
revoke all on function public.get_post_ride_review_access(uuid, uuid) from anon;
grant execute on function public.get_post_ride_review_access(uuid, uuid) to authenticated;
