-- Add a compact user activity summary for mobile/dashboard surfaces.
-- This keeps dashboard widgets light and reuses server-side permissions.

set check_function_bodies = off;

create or replace function public.fetch_user_activity_summary_v1(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := coalesce(p_user_id, auth.uid());
    v_now timestamptz := now();
    v_upcoming_driver int := 0;
    v_upcoming_passenger int := 0;
    v_active_rides int := 0;
    v_pending_requests int := 0;
    v_my_open_requests int := 0;
    v_pending_payments int := 0;
    v_next_ride jsonb := null;
    v_recent_request jsonb := null;
begin
    if v_user_id is null then
        return jsonb_build_object(
            'upcoming_driver', 0,
            'upcoming_passenger', 0,
            'active_rides', 0,
            'pending_requests', 0,
            'my_open_requests', 0,
            'pending_payments', 0,
            'next_ride', null,
            'recent_request', null,
            'generated_at', v_now
        );
    end if;

    if to_regclass('public.rides') is not null then
        select count(*)::int
          into v_upcoming_driver
          from public.rides r
         where r.driver_id = v_user_id
           and coalesce(r.status, 'scheduled') = 'scheduled'
           and r.departure_time >= v_now;

        select count(*)::int
          into v_upcoming_passenger
          from public.rides r
         where v_user_id = any(coalesce(r.participant_ids, array[]::uuid[]))
           and coalesce(r.status, 'scheduled') = 'scheduled'
           and r.departure_time >= v_now;

        select count(*)::int
          into v_active_rides
          from public.rides r
         where (r.driver_id = v_user_id or v_user_id = any(coalesce(r.participant_ids, array[]::uuid[])))
           and coalesce(r.status, 'scheduled') in ('active', 'in_progress');

        select jsonb_build_object(
            'id', r.id,
            'role', case when r.driver_id = v_user_id then 'driver' else 'passenger' end,
            'status', r.status,
            'departure_time', r.departure_time,
            'origin', r.origin,
            'destination', r.destination,
            'price', r.price,
            'seats_available', r.seats_available
        )
          into v_next_ride
          from public.rides r
         where (r.driver_id = v_user_id or v_user_id = any(coalesce(r.participant_ids, array[]::uuid[])))
           and coalesce(r.status, 'scheduled') in ('scheduled', 'active', 'in_progress')
           and r.departure_time >= (v_now - interval '2 hours')
         order by r.departure_time asc
         limit 1;
    end if;

    if to_regclass('public.ride_requests') is not null then
        select count(*)::int
          into v_pending_requests
          from public.ride_requests rr
         where rr.status = 'pending'
           and exists (
                select 1
                  from public.rides r
                 where r.id = rr.ride_id
                   and r.driver_id = v_user_id
           );

        select count(*)::int
          into v_my_open_requests
          from public.ride_requests rr
         where rr.requester_id = v_user_id
           and coalesce(rr.status, 'pending') in ('pending', 'accepted')
           and coalesce(rr.departure_time, v_now + interval '1 day') >= (v_now - interval '2 hours');

        select jsonb_build_object(
            'id', rr.id,
            'status', rr.status,
            'departure_time', rr.departure_time,
            'origin', rr.origin,
            'destination', rr.destination,
            'price', coalesce(rr.suggested_price, rr.price)
        )
          into v_recent_request
          from public.ride_requests rr
         where rr.requester_id = v_user_id
           and coalesce(rr.status, 'pending') in ('pending', 'accepted')
         order by rr.created_at desc nulls last, rr.departure_time asc nulls last
         limit 1;
    end if;

    if to_regclass('public.wallet_transactions') is not null then
        select count(*)::int
          into v_pending_payments
          from public.wallet_transactions wt
         where wt.user_id = v_user_id
           and coalesce(wt.status, '') in ('pending', 'processing', 'requires_action');
    end if;

    return jsonb_build_object(
        'upcoming_driver', coalesce(v_upcoming_driver, 0),
        'upcoming_passenger', coalesce(v_upcoming_passenger, 0),
        'active_rides', coalesce(v_active_rides, 0),
        'pending_requests', coalesce(v_pending_requests, 0),
        'my_open_requests', coalesce(v_my_open_requests, 0),
        'pending_payments', coalesce(v_pending_payments, 0),
        'next_ride', v_next_ride,
        'recent_request', v_recent_request,
        'generated_at', v_now
    );
end;
$$;

grant execute on function public.fetch_user_activity_summary_v1(uuid) to authenticated;
