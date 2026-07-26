-- Normalize legacy and current passenger payloads during final ride settlement.
--
-- This keeps complete_ride as the existing authoritative RPC while aligning its
-- financial interpretation with the passenger aliases already supported by the
-- booking and seat-integrity contracts.

create or replace function public.complete_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride_status text;
  v_passenger jsonb;
  v_passenger_id_text text;
  v_passenger_id uuid;
  v_status text;
  v_price_text text;
  v_seats_text text;
  v_price numeric;
  v_seats integer;
  v_subtotal numeric;
  v_net_payout numeric;
  v_fee numeric;
  v_total_payout numeric := 0;
  v_platform_fee_total numeric := 0;
  v_treasury_id uuid := '00000000-0000-0000-0000-000000000000';
  v_driver_wallet_updated integer;
  v_passenger_wallet_updated integer;
  v_treasury_wallet_updated integer;
begin
  if v_driver_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No autenticado'
    );
  end if;

  select lower(coalesce(status, ''))
  into v_ride_status
  from public.rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'No autorizado o viaje no encontrado'
    );
  end if;

  if v_ride_status not in ('active', 'in_progress') then
    return jsonb_build_object(
      'success', false,
      'error', 'Solo se puede completar un viaje iniciado (Estado actual: ' || v_ride_status || ')'
    );
  end if;

  for v_passenger in
    select value
    from public.rides as ride,
         jsonb_array_elements(coalesce(ride.passengers, '[]'::jsonb))
    where ride.id = p_ride_id
  loop
    v_passenger_id_text := nullif(trim(coalesce(
      v_passenger->>'id',
      v_passenger->>'passenger_id',
      v_passenger->>'user_id',
      ''
    )), '');

    v_status := lower(trim(coalesce(v_passenger->>'status', 'confirmed')));

    -- Cancelled, rejected and no-show passengers have no remaining settlement
    -- in this RPC. Their cancellation/refund RPC remains authoritative.
    if v_status in ('cancelled', 'canceled', 'rejected', 'no_show') then
      continue;
    end if;

    if v_passenger_id_text is null then
      raise exception using
        errcode = 'P0001',
        message = 'PASSENGER_ID_REQUIRED_FOR_SETTLEMENT';
    end if;

    begin
      v_passenger_id := v_passenger_id_text::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = 'P0001',
          message = 'INVALID_PASSENGER_ID_FOR_SETTLEMENT',
          detail = v_passenger_id_text;
    end;

    v_price_text := trim(coalesce(
      v_passenger->>'booked_price',
      v_passenger->>'price_per_seat',
      v_passenger->>'price',
      '0'
    ));

    if v_price_text ~ '^[0-9]+([.][0-9]+)?$' then
      v_price := round(v_price_text::numeric, 2);
    else
      raise exception using
        errcode = 'P0001',
        message = 'INVALID_PASSENGER_PRICE_FOR_SETTLEMENT',
        detail = v_price_text;
    end if;

    v_seats_text := trim(coalesce(
      v_passenger->>'seats_booked',
      v_passenger->>'num_seats',
      v_passenger->>'seats',
      v_passenger->>'seat_count',
      '1'
    ));

    if v_seats_text ~ '^[0-9]+$' then
      v_seats := greatest(v_seats_text::integer, 1);
    else
      raise exception using
        errcode = 'P0001',
        message = 'INVALID_PASSENGER_SEATS_FOR_SETTLEMENT',
        detail = v_seats_text;
    end if;

    v_subtotal := round(v_price * v_seats, 2);

    if v_subtotal < 0 then
      raise exception using
        errcode = 'P0001',
        message = 'NEGATIVE_PASSENGER_SETTLEMENT';
    end if;

    -- A passenger can already be marked completed by a per-stop flow. Both
    -- verified and completed mean the travelled amount must be released.
    if v_status in ('verified', 'completed') then
      v_net_payout := round(v_subtotal * 0.90, 2);
      v_fee := v_subtotal - v_net_payout;

      update public.wallets
      set balance = coalesce(balance, 0) + v_net_payout,
          updated_at = now()
      where user_id = v_driver_id;

      get diagnostics v_driver_wallet_updated = row_count;
      if v_driver_wallet_updated <> 1 then
        raise exception using
          errcode = 'P0001',
          message = 'DRIVER_WALLET_MISSING';
      end if;

      update public.wallets
      set held_balance = greatest(0, coalesce(held_balance, 0) - v_subtotal),
          updated_at = now()
      where user_id = v_passenger_id;

      get diagnostics v_passenger_wallet_updated = row_count;
      if v_passenger_wallet_updated <> 1 then
        raise exception using
          errcode = 'P0001',
          message = 'PASSENGER_WALLET_MISSING',
          detail = v_passenger_id::text;
      end if;

      update public.wallets
      set balance = coalesce(balance, 0) + v_fee,
          updated_at = now()
      where user_id = v_treasury_id;

      get diagnostics v_treasury_wallet_updated = row_count;
      if v_treasury_wallet_updated <> 1 then
        raise exception using
          errcode = 'P0001',
          message = 'TREASURY_WALLET_MISSING';
      end if;

      insert into public.transactions (
        user_id,
        amount,
        type,
        related_ride_id,
        description
      ) values (
        v_driver_id,
        v_net_payout,
        'earning',
        p_ride_id,
        'Ingreso finalización viaje'
      );

      insert into public.transactions (
        user_id,
        amount,
        type,
        related_ride_id,
        description
      ) values (
        v_treasury_id,
        v_fee,
        'fee',
        p_ride_id,
        'Comisión servicio trayecto'
      );

      v_total_payout := v_total_payout + v_net_payout;
      v_platform_fee_total := v_platform_fee_total + v_fee;

    -- These states should normally be resolved before ride start. For legacy
    -- rides, preserve the existing behaviour and return the held amount.
    elsif v_status in ('confirmed', 'accepted', 'pending_boarding') then
      update public.wallets
      set balance = coalesce(balance, 0) + v_subtotal,
          held_balance = greatest(0, coalesce(held_balance, 0) - v_subtotal),
          updated_at = now()
      where user_id = v_passenger_id;

      get diagnostics v_passenger_wallet_updated = row_count;
      if v_passenger_wallet_updated <> 1 then
        raise exception using
          errcode = 'P0001',
          message = 'PASSENGER_WALLET_MISSING',
          detail = v_passenger_id::text;
      end if;
    else
      raise exception using
        errcode = 'P0001',
        message = 'UNSUPPORTED_PASSENGER_STATUS_FOR_SETTLEMENT',
        detail = v_status;
    end if;
  end loop;

  update public.rides
  set status = 'completed',
      updated_at = now(),
      completed_at = now()
  where id = p_ride_id
    and status in ('active', 'in_progress');

  if not found then
    raise exception 'El viaje cambió de estado durante la finalización';
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'completed',
    'ride_id', p_ride_id,
    'completed_at', now(),
    'payout', v_total_payout,
    'fee', v_platform_fee_total
  );
end;
$$;

revoke all
on function public.complete_ride(uuid)
from public;

revoke all
on function public.complete_ride(uuid)
from anon;

grant execute
on function public.complete_ride(uuid)
to authenticated;

comment on function public.complete_ride(uuid) is
  'Completes an active ride and settles normalized passenger records using supported identity, seat and price aliases.';
