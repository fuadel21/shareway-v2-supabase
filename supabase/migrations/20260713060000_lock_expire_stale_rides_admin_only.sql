-- Lock stale ride expiration to admins only.
-- Public ride searches no longer call this RPC; it is now intended for admin/cron/service maintenance only.

create or replace function public.expire_stale_rides(p_grace_minutes integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace_minutes integer := greatest(coalesce(p_grace_minutes, 120), 0);
  v_expired_count integer := 0;
  v_is_admin boolean := false;
  v_is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_is_service_role then
    select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    ) into v_is_admin;
  end if;

  if not (v_is_admin or v_is_service_role) then
    raise exception 'ADMIN_ONLY: Solo un administrador puede expirar viajes antiguos.'
      using errcode = 'P0001';
  end if;

  update public.rides
  set
    status = 'expired',
    updated_at = now()
  where status = 'scheduled'
    and departure_time < (now() - make_interval(mins => v_grace_minutes));

  get diagnostics v_expired_count = row_count;

  return jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'grace_minutes', v_grace_minutes,
    'ran_at', now()
  );
end;
$$;

comment on function public.expire_stale_rides(integer)
is 'Admin/service-role maintenance RPC. Marks scheduled rides as expired when departure_time is older than the supplied grace period.';

revoke all on function public.expire_stale_rides(integer) from public;
revoke all on function public.expire_stale_rides(integer) from anon;
revoke all on function public.expire_stale_rides(integer) from authenticated;
grant execute on function public.expire_stale_rides(integer) to authenticated;
grant execute on function public.expire_stale_rides(integer) to service_role;
