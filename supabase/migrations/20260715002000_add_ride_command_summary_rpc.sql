-- Add a compact ride command summary for RideDetails and future mobile surfaces.
-- This keeps UI action decisions consistent and server-side.

set check_function_bodies = off;

create or replace function public.fetch_ride_command_summary_v1(p_ride_id uuid, p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := coalesce(p_user_id, auth.uid());
    v_now timestamptz := now();
    v_ride public.rides%rowtype;
    v_is_driver boolean := false;
    v_is_passenger boolean := false;
    v_is_participant boolean := false;
    v_status text := 'unknown';
    v_departed boolean := false;
    v_too_late boolean := false;
    v_minutes_to_departure int := null;
    v_seats_available int := 0;
    v_total_seats int := 0;
    v_pending_requests int := 0;
    v_can_book boolean := false;
    v_can_chat boolean := false;
    v_can_start boolean := false;
    v_can_complete boolean := false;
    v_can_cancel_ride boolean := false;
    v_can_cancel_booking boolean := false;
    v_can_open_sos boolean := false;
    v_can_verify_passengers boolean := false;
    v_primary_action text := 'view';
    v_status_label text := 'Viaje';
begin
    if p_ride_id is null then
        return jsonb_build_object(
            'success', false,
            'error', 'missing_ride_id',
            'generated_at', v_now
        );
    end if;

    if to_regclass('public.rides') is null then
        return jsonb_build_object(
            'success', false,
            'error', 'rides_table_missing',
            'generated_at', v_now
        );
    end if;

    select *
      into v_ride
      from public.rides r
     where r.id = p_ride_id
     limit 1;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'ride_not_found',
            'generated_at', v_now
        );
    end if;

    v_status := coalesce(v_ride.status, 'scheduled');
    v_is_driver := v_user_id is not null and v_ride.driver_id = v_user_id;
    v_is_passenger := v_user_id is not null and v_user_id = any(coalesce(v_ride.participant_ids, array[]::uuid[]));
    v_is_participant := v_is_driver or v_is_passenger;
    v_seats_available := greatest(0, coalesce(v_ride.seats_available, 0));
    v_total_seats := greatest(0, coalesce(v_ride.total_seats, v_ride.seats, v_seats_available, 0));

    if v_ride.departure_time is not null then
        v_minutes_to_departure := floor(extract(epoch from (v_ride.departure_time - v_now)) / 60)::int;
        v_departed := v_ride.departure_time <= v_now;
        v_too_late := v_now > (v_ride.departure_time + interval '2 hours');
    end if;

    if to_regclass('public.ride_requests') is not null then
        select count(*)::int
          into v_pending_requests
          from public.ride_requests rr
         where rr.ride_id = p_ride_id
           and rr.status = 'pending';
    end if;

    v_can_chat := v_is_participant and v_status in ('scheduled', 'active', 'in_progress', 'completed');
    v_can_start := v_is_driver
                   and v_status = 'scheduled'
                   and coalesce(v_minutes_to_departure, 999999) <= 15
                   and not v_too_late;
    v_can_complete := v_is_driver and v_status in ('active', 'in_progress');
    v_can_cancel_ride := v_is_driver and v_status = 'scheduled' and not v_too_late;
    v_can_cancel_booking := v_is_passenger and v_status in ('scheduled', 'active', 'in_progress') and not v_too_late;
    v_can_open_sos := v_is_participant and v_status in ('active', 'in_progress');
    v_can_verify_passengers := v_is_driver and v_status in ('active', 'in_progress');
    v_can_book := not v_is_participant
                  and v_status = 'scheduled'
                  and not v_departed
                  and not v_too_late
                  and v_seats_available > 0;

    if v_status = 'cancelled' then
        v_status_label := 'Cancelado';
        v_primary_action := 'closed';
    elsif v_status = 'completed' then
        v_status_label := 'Finalizado';
        v_primary_action := 'rate_or_view';
    elsif v_status in ('active', 'in_progress') then
        v_status_label := 'En viaje';
        v_primary_action := case when v_can_complete then 'complete_ride' when v_can_chat then 'open_chat' else 'view' end;
    elsif v_too_late then
        v_status_label := 'Expirado';
        v_primary_action := 'closed';
    elsif v_departed then
        v_status_label := 'Salida iniciada';
        v_primary_action := case when v_can_start then 'start_ride' else 'view' end;
    elsif v_status = 'scheduled' then
        v_status_label := 'Programado';
        v_primary_action := case
            when v_can_start then 'start_ride'
            when v_can_book then 'book_ride'
            when v_can_chat then 'open_chat'
            else 'view'
        end;
    else
        v_status_label := initcap(v_status);
        v_primary_action := 'view';
    end if;

    return jsonb_build_object(
        'success', true,
        'ride_id', p_ride_id,
        'role', case when v_is_driver then 'driver' when v_is_passenger then 'passenger' else 'viewer' end,
        'status', v_status,
        'status_label', v_status_label,
        'primary_action', v_primary_action,
        'departure_time', v_ride.departure_time,
        'minutes_to_departure', v_minutes_to_departure,
        'has_departed', v_departed,
        'is_too_late', v_too_late,
        'seats_available', v_seats_available,
        'total_seats', v_total_seats,
        'pending_requests', coalesce(v_pending_requests, 0),
        'can_book', v_can_book,
        'can_chat', v_can_chat,
        'can_start', v_can_start,
        'can_complete', v_can_complete,
        'can_cancel_ride', v_can_cancel_ride,
        'can_cancel_booking', v_can_cancel_booking,
        'can_open_sos', v_can_open_sos,
        'can_verify_passengers', v_can_verify_passengers,
        'generated_at', v_now
    );
end;
$$;

grant execute on function public.fetch_ride_command_summary_v1(uuid, uuid) to authenticated;
