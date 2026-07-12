-- Expire stale scheduled rides so old trips stop looking bookable.
-- This function is safe to run repeatedly and can be called manually from admin,
-- from the app before ride listings, or later from a scheduled cron job.

create or replace function public.expire_stale_rides(p_grace_minutes integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace_minutes integer := greatest(coalesce(p_grace_minutes, 120), 0);
  v_expired_count integer := 0;
begin
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
is 'Marks scheduled rides as expired when departure_time is older than the supplied grace period.';

grant execute on function public.expire_stale_rides(integer) to authenticated;
