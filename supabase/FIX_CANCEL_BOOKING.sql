-- ============================================================================
-- SHAREWAY · FIX_CANCEL_BOOKING.sql
-- ============================================================================
-- Instala cancel_booking_and_refund con la firma de 4 parametros que usa la
-- Edge Function cancel-booking-and-refund (en produccion solo existia la de
-- 1 parametro → toda cancelacion de reserva fallaba con non-2xx).
-- Ademas corrige el contrato booked_price = PRECIO POR PLAZA en
-- fulfill_ride_request y confirm_trip_and_pay, y repara los datos existentes.
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- Ride financial ledger.
-- Creates a per-ride financial audit trail without changing existing payment flows.
-- Existing wallet transactions are mirrored best-effort only when a ride_id can be detected.
-- This migration intentionally avoids foreign keys to wallet_transactions.id because older
-- production schemas may use a different primary key name for wallet transactions.

create table if not exists public.ride_financial_ledger (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid,
  actor_user_id uuid,
  wallet_id uuid,
  source_transaction_id uuid unique,
  event_type text not null default 'wallet_transaction',
  status text not null default 'recorded',
  currency text not null default 'EUR',
  gross_amount numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  driver_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ride_financial_ledger is 'Per-ride financial audit trail for gross amounts, platform fees, driver amounts, refunds and wallet transaction mirrors.';
comment on column public.ride_financial_ledger.event_type is 'Examples: booking_paid, platform_fee, driver_payout, refund, cancellation, no_show, wallet_transaction.';
comment on column public.ride_financial_ledger.source_transaction_id is 'Wallet transaction id mirrored into the ride ledger when available.';

create index if not exists ride_financial_ledger_ride_id_idx on public.ride_financial_ledger (ride_id);
create index if not exists ride_financial_ledger_actor_user_id_idx on public.ride_financial_ledger (actor_user_id);
create index if not exists ride_financial_ledger_event_type_idx on public.ride_financial_ledger (event_type);
create index if not exists ride_financial_ledger_created_at_idx on public.ride_financial_ledger (created_at desc);
create index if not exists ride_financial_ledger_metadata_gin_idx on public.ride_financial_ledger using gin (metadata);

alter table public.ride_financial_ledger enable row level security;
alter table public.ride_financial_ledger force row level security;

-- Reads are available to admins and ride participants.
drop policy if exists ride_financial_ledger_select_admin_or_participant on public.ride_financial_ledger;
create policy ride_financial_ledger_select_admin_or_participant
on public.ride_financial_ledger
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.role, '') = 'admin'
  )
  or exists (
    select 1
    from public.rides r
    where r.id = ride_financial_ledger.ride_id
      and (
        r.driver_id = auth.uid()
        or auth.uid() = any(coalesce(r.participant_ids, array[]::uuid[]))
      )
  )
);

-- Direct client inserts are limited to admins. Automated inserts go through security definer helpers/triggers.
drop policy if exists ride_financial_ledger_insert_admin_only on public.ride_financial_ledger;
create policy ride_financial_ledger_insert_admin_only
on public.ride_financial_ledger
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.role, '') = 'admin'
  )
);

drop policy if exists ride_financial_ledger_no_client_update on public.ride_financial_ledger;
create policy ride_financial_ledger_no_client_update
on public.ride_financial_ledger
for update
to authenticated
using (false)
with check (false);

drop policy if exists ride_financial_ledger_no_client_delete on public.ride_financial_ledger;
create policy ride_financial_ledger_no_client_delete
on public.ride_financial_ledger
for delete
to authenticated
using (false);

create or replace function public.touch_ride_financial_ledger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_ride_financial_ledger_updated_at on public.ride_financial_ledger;
create trigger trg_touch_ride_financial_ledger_updated_at
before update on public.ride_financial_ledger
for each row
execute function public.touch_ride_financial_ledger_updated_at();


-- ============================================================================

DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid, numeric, uuid, text);
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid, numeric, uuid);
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid, numeric);
DROP FUNCTION IF EXISTS public.cancel_booking_and_refund(uuid);

CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(
  p_ride_id UUID,
  p_stripe_refunded NUMERIC DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_refund_operation_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role(), '') = 'service_role';
  v_ride public.rides%ROWTYPE;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_passenger_id_text TEXT;
  v_status TEXT;
  v_payment_method TEXT;
  v_price NUMERIC;
  v_seats INTEGER;
  v_total_paid NUMERIC;
  v_refund_percent NUMERIC;
  v_refund_amount NUMERIC;
  v_penalty_amount NUMERIC;
  v_driver_compensation NUMERIC;
  v_platform_penalty NUMERIC;
  v_hours NUMERIC;
  v_balance_updated INTEGER;
  v_driver_wallet_updated INTEGER;
  v_treasury_wallet_updated INTEGER;
  v_passenger_found BOOLEAN := FALSE;
  v_already_cancelled BOOLEAN := FALSE;
  v_status_message TEXT;
  v_captured_amount NUMERIC;
  v_tx_id UUID;
  v_refund_operation public.stripe_refund_operations%ROWTYPE;
BEGIN
  v_user_id := CASE
    WHEN v_is_service_role THEN COALESCE(p_actor_id, auth.uid())
    ELSE auth.uid()
  END;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT v_is_service_role AND (p_stripe_refunded IS NOT NULL OR p_refund_operation_key IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'EXTERNAL_REFUND_MUST_USE_EDGE_FUNCTION'
    );
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress') THEN
    IF lower(COALESCE(v_ride.status, '')) = 'cancelled'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger
         WHERE lower(COALESCE(
           passenger ->> 'id',
           passenger ->> 'passenger_id',
           passenger ->> 'user_id',
           ''
         )) = lower(v_user_id::TEXT)
           AND lower(COALESCE(passenger ->> 'status', '')) IN ('cancelled', 'canceled')
       ) THEN
      RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'status', 'cancelled');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_CANNOT_BE_CANCELLED');
  END IF;

  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    IF lower(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )) = lower(v_user_id::TEXT)
       AND lower(COALESCE(v_passenger ->> 'status', '')) IN (
         'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin'
       ) THEN
      v_passenger_found := TRUE;
      EXIT;
    ELSIF lower(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )) = lower(v_user_id::TEXT)
      AND lower(COALESCE(v_passenger ->> 'status', '')) IN ('cancelled', 'canceled') THEN
      v_already_cancelled := TRUE;
    END IF;
  END LOOP;

  IF NOT v_passenger_found THEN
    IF v_already_cancelled THEN
      RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'status', 'cancelled');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_BOOKING_NOT_FOUND');
  END IF;

  v_passenger_id_text := NULLIF(trim(COALESCE(
    v_passenger ->> 'id',
    v_passenger ->> 'passenger_id',
    v_passenger ->> 'user_id',
    ''
  )), '');
  IF v_passenger_id_text IS NULL THEN
    RAISE EXCEPTION 'PASSENGER_ID_REQUIRED_FOR_CANCELLATION';
  END IF;

  IF trim(COALESCE(v_passenger ->> 'booked_price', '')) !~ '^[0-9]+([.][0-9]+)?$' THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_CANCELLATION';
  END IF;
  v_price := round((v_passenger ->> 'booked_price')::NUMERIC, 6);
  IF v_price < 0.50 OR v_price > 300 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_CANCELLATION';
  END IF;
  v_seats := COALESCE(
    NULLIF(v_passenger ->> 'seats_booked', '')::INTEGER,
    NULLIF(v_passenger ->> 'num_seats', '')::INTEGER,
    NULLIF(v_passenger ->> 'seats', '')::INTEGER,
    1
  );
  IF v_seats < 1 OR v_seats > 8 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_CANCELLATION';
  END IF;
  IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
     AND trim(v_passenger ->> 'payment_amount') !~ '^[0-9]+([.][0-9]+)?$' THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_CANCELLATION';
  END IF;
  IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
     AND round((v_passenger ->> 'payment_amount')::NUMERIC, 2) <> round(v_price * v_seats, 2) THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH_FOR_CANCELLATION';
  END IF;
  v_total_paid := round(v_price * v_seats, 2);
  IF v_total_paid < 0.50 OR v_total_paid > 2400 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_CANCELLATION';
  END IF;
  v_payment_method := lower(COALESCE(v_passenger ->> 'payment_method', 'wallet'));

  IF v_payment_method IN ('stripe', 'card', 'credit_card')
     OR NULLIF(trim(v_passenger ->> 'payment_intent_id'), '') IS NOT NULL THEN
    -- Load the refund operation before checking the current PaymentIntent
    -- status. Stripe can deliver charge.refunded between the external refund
    -- and this SQL transaction, advancing financial_status from captured to
    -- refunded. A settled, identity-checked refund operation is then durable
    -- evidence that this exact captured charge was refunded; it must not make
    -- the retry permanently fail the capture gate.
    IF NULLIF(trim(p_refund_operation_key), '') IS NOT NULL THEN
      SELECT *
        INTO v_refund_operation
      FROM public.stripe_refund_operations
      WHERE operation_key = trim(p_refund_operation_key)
      FOR UPDATE;

      IF NOT FOUND
         OR v_refund_operation.ride_id IS DISTINCT FROM p_ride_id
         OR v_refund_operation.passenger_id IS DISTINCT FROM v_user_id
         OR v_refund_operation.payment_intent_id IS DISTINCT FROM NULLIF(trim(v_passenger ->> 'payment_intent_id'), '')
         OR round(v_refund_operation.refund_amount, 2) <= 0
         OR round(v_refund_operation.refund_amount, 2) > round(v_total_paid, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_INVALID');
      END IF;
    END IF;

    v_captured_amount := public.sw_captured_payment_amount(v_passenger ->> 'payment_intent_id');
    IF v_captured_amount IS NULL
       AND v_refund_operation.status IN ('refunded', 'settled')
       AND v_refund_operation.stripe_refund_id IS NOT NULL THEN
      -- The original capture transition may be missing only when webhook
      -- delivery is out of order. The completed, immutable refund operation
      -- was created after the Edge Function retrieved the captured amount.
      v_captured_amount := v_total_paid;
    END IF;
    IF v_captured_amount IS NULL OR round(v_captured_amount, 2) <> round(v_total_paid, 2) THEN
      RETURN jsonb_build_object('success', false, 'error', 'STRIPE_PAYMENT_NOT_CAPTURED');
    END IF;
  END IF;

  v_hours := EXTRACT(EPOCH FROM (v_ride.departure_time - NOW())) / 3600;
  IF v_hours > 24 THEN
    v_refund_percent := 1.0;
    v_status_message := 'Reembolso total (>24h)';
  ELSIF v_hours >= 2 THEN
    v_refund_percent := 0.5;
    v_status_message := 'Reembolso del 50% (2h-24h)';
  ELSE
    v_refund_percent := 0.0;
    v_status_message := 'Sin reembolso (<2h)';
  END IF;

  v_refund_amount := round(v_total_paid * v_refund_percent, 2);
  v_penalty_amount := round(v_total_paid - v_refund_amount, 2);

  IF v_payment_method IN ('stripe', 'card', 'credit_card')
       OR NULLIF(v_passenger ->> 'payment_intent_id', '') IS NOT NULL THEN
    -- Reuse the first durable policy decision on a retry. This prevents a
    -- request crossing the 24h/2h boundary after Stripe refunded but before
    -- SQL committed from producing a different internal result. The operation
    -- was identity-checked above, before the capture gate.
    IF NULLIF(trim(p_refund_operation_key), '') IS NOT NULL THEN
      v_refund_amount := round(v_refund_operation.refund_amount, 2);
      v_penalty_amount := round(v_total_paid - v_refund_amount, 2);
      v_refund_percent := CASE WHEN v_total_paid > 0 THEN v_refund_amount / v_total_paid ELSE 0 END;
      v_status_message := CASE
        WHEN v_refund_amount = v_total_paid THEN 'Reembolso total (>24h)'
        WHEN v_refund_amount > 0 THEN 'Reembolso del 50% (2h-24h)'
        ELSE 'Sin reembolso (<2h)'
      END;
    END IF;

    IF v_refund_amount > 0
       AND (p_stripe_refunded IS NULL OR round(p_stripe_refunded, 2) <> round(v_refund_amount, 2)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'EXTERNAL_REFUND_REQUIRED',
        'expected_refund', v_refund_amount
      );
    END IF;
    IF p_stripe_refunded IS NOT NULL
       AND (p_stripe_refunded < 0 OR round(p_stripe_refunded, 2) > round(v_refund_amount, 2)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'EXTERNAL_REFUND_EXCEEDS_POLICY');
    END IF;
    IF v_refund_amount > 0
       AND NULLIF(trim(p_refund_operation_key), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_REQUIRED');
    END IF;
    IF v_refund_amount > 0
       AND v_refund_operation.status NOT IN ('refunded', 'settled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_NOT_SETTLED');
    END IF;
  ELSE
    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (v_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets
    SET held_balance = round(COALESCE(held_balance, 0) - v_total_paid, 2),
        balance = round(COALESCE(balance, 0) + v_refund_amount, 2),
        updated_at = NOW()
    WHERE user_id = v_user_id
      AND COALESCE(held_balance, 0) >= v_total_paid;
    GET DIAGNOSTICS v_balance_updated = ROW_COUNT;
    IF v_balance_updated <> 1 THEN
      RAISE EXCEPTION 'PASSENGER_WALLET_MISSING';
    END IF;
  END IF;

  IF v_refund_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, amount, type, description, related_ride_id
    ) VALUES (
      v_user_id,
      v_refund_amount,
      'refund',
      v_status_message,
      p_ride_id
    ) RETURNING id INTO v_tx_id;

    PERFORM public.record_ride_financial_event(
      p_ride_id,
      v_user_id,
      'passenger_refund',
      'refunded',
      v_total_paid,
      0,
      0,
      v_refund_amount,
      v_status_message,
      jsonb_build_object(
        'refund_percent', v_refund_percent,
        'seats', v_seats,
        'payment_method', v_payment_method,
        'refund_operation_key', NULLIF(trim(p_refund_operation_key), ''),
        'stripe_refund_id', v_refund_operation.stripe_refund_id
      ),
      v_tx_id,
      NULL
    );
  END IF;

  -- 80% of a passenger cancellation penalty compensates the driver; the
  -- remainder is the platform share.
  v_driver_compensation := round(v_penalty_amount * 0.80, 2);
  v_platform_penalty := round(v_penalty_amount - v_driver_compensation, 2);

  IF v_driver_compensation > 0 THEN
    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (v_ride.driver_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) + v_driver_compensation, 2),
        updated_at = NOW()
    WHERE user_id = v_ride.driver_id;
    GET DIAGNOSTICS v_driver_wallet_updated = ROW_COUNT;
    IF v_driver_wallet_updated <> 1 THEN
      RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
    END IF;

    INSERT INTO public.transactions (
      user_id, amount, type, description, related_ride_id
    ) VALUES (
      v_ride.driver_id,
      v_driver_compensation,
      'cancellation_compensation',
      'Compensación por cancelación de pasajero (80%)',
      p_ride_id
    );
  END IF;

  IF v_platform_penalty > 0 THEN
    INSERT INTO public.profiles (id, display_name)
    VALUES ('00000000-0000-0000-0000-000000000000', 'Tesoreria ShareWay')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES ('00000000-0000-0000-0000-000000000000', 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) + v_platform_penalty, 2),
        updated_at = NOW()
    WHERE user_id = '00000000-0000-0000-0000-000000000000';
    GET DIAGNOSTICS v_treasury_wallet_updated = ROW_COUNT;
    IF v_treasury_wallet_updated <> 1 THEN
      RAISE EXCEPTION 'TREASURY_WALLET_MISSING';
    END IF;

    INSERT INTO public.transactions (
      user_id, amount, type, description, related_ride_id
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_platform_penalty,
      'fee',
      'Comisión por penalización de pasajero (20%)',
      p_ride_id
    );
  END IF;

  IF v_penalty_amount > 0 THEN
    PERFORM public.record_ride_financial_event(
      p_ride_id,
      v_user_id,
      'passenger_cancellation_penalty',
      'settled',
      v_penalty_amount,
      v_platform_penalty,
      v_driver_compensation,
      0,
      'Distribución de penalización por cancelación de pasajero',
      jsonb_build_object('driver_share', 0.80, 'platform_share', 0.20, 'seats', v_seats),
      NULL,
      NULL
    );
  END IF;

  IF NULLIF(trim(p_refund_operation_key), '') IS NOT NULL THEN
    UPDATE public.stripe_refund_operations
    SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
    WHERE operation_key = trim(p_refund_operation_key)
      AND status IN ('refunded', 'settled');
  END IF;

  IF NULLIF(trim(v_passenger ->> 'payment_intent_id'), '') IS NOT NULL THEN
    UPDATE public.payment_intents
    SET financial_status = CASE WHEN v_refund_amount > 0 THEN 'refunded' ELSE 'captured' END,
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
          'ride_id', p_ride_id,
          'user_id', v_user_id,
          'refund_amount', v_refund_amount,
          'penalty_amount', v_penalty_amount,
          'refund_operation_key', NULLIF(trim(p_refund_operation_key), ''),
          'stripe_refund_id', v_refund_operation.stripe_refund_id
        ),
        updated_at = NOW()
    WHERE external_id = trim(v_passenger ->> 'payment_intent_id');
  END IF;

  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    IF lower(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )) = lower(v_user_id::TEXT)
       AND lower(COALESCE(v_passenger ->> 'status', '')) IN (
         'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin'
       ) THEN
      v_new_passengers := v_new_passengers || jsonb_build_array(
        v_passenger || jsonb_build_object(
          'status', 'cancelled',
          'cancelled_at', NOW(),
          'refund_amount', v_refund_amount,
          'penalty_amount', v_penalty_amount,
          'driver_compensation', v_driver_compensation,
          'platform_penalty', v_platform_penalty
        )
      );
    ELSE
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
    END IF;
  END LOOP;

  UPDATE public.rides
  SET passengers = v_new_passengers,
      participant_ids = array_remove(participant_ids, v_user_id),
      updated_at = NOW()
  WHERE id = p_ride_id;

  -- Keep the durable request terminal as well as the passenger JSON terminal.
  -- Otherwise a late payment_intent.succeeded could see a pending request and
  -- create a new booking after the passenger has already canceled.
  UPDATE public.ride_requests
  SET status = 'cancelled'
  WHERE ride_id = p_ride_id
    AND requester_id = v_user_id
    AND lower(COALESCE(status, '')) IN (
      'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid',
      'fulfilled', 'confirmed', 'accepted', 'completed'
    );

  PERFORM public.create_notification(
    v_ride.driver_id,
    'passenger_cancelled',
    'Baja en tu viaje',
    'Un pasajero ha cancelado su reserva (' || v_seats || ' plaza(s)).',
    jsonb_build_object('ride_id', p_ride_id, 'seats_recovered', v_seats)
  );

  PERFORM public.create_notification(
    v_user_id,
    'booking_cancelled',
    'Reserva cancelada',
    v_status_message,
    jsonb_build_object(
      'ride_id', p_ride_id,
      'refund', v_refund_amount,
      'penalty', v_penalty_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', v_status_message,
    'refunded', v_refund_amount,
    'penalty', v_penalty_amount,
    'driver_compensation', v_driver_compensation,
    'platform_penalty', v_platform_penalty,
    'seats_recovered', v_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking_and_refund(uuid, numeric, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_booking_and_refund(uuid, numeric, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_booking_and_refund(uuid, numeric, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_refund(uuid, numeric, uuid, text) TO service_role;

create or replace function public.record_ride_financial_event(
  p_ride_id uuid,
  p_actor_user_id uuid default null,
  p_event_type text default 'manual',
  p_status text default 'recorded',
  p_gross_amount numeric default 0,
  p_platform_fee numeric default 0,
  p_driver_amount numeric default 0,
  p_refund_amount numeric default 0,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_transaction_id uuid default null,
  p_wallet_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ride_financial_ledger (
    ride_id,
    actor_user_id,
    wallet_id,
    source_transaction_id,
    event_type,
    status,
    gross_amount,
    platform_fee,
    driver_amount,
    refund_amount,
    net_amount,
    description,
    metadata
  ) values (
    p_ride_id,
    p_actor_user_id,
    p_wallet_id,
    p_source_transaction_id,
    coalesce(nullif(trim(p_event_type), ''), 'manual'),
    coalesce(nullif(trim(p_status), ''), 'recorded'),
    round(coalesce(p_gross_amount, 0)::numeric, 2),
    round(coalesce(p_platform_fee, 0)::numeric, 2),
    round(coalesce(p_driver_amount, 0)::numeric, 2),
    round(coalesce(p_refund_amount, 0)::numeric, 2),
    round((coalesce(p_gross_amount, 0) - coalesce(p_platform_fee, 0) - coalesce(p_refund_amount, 0))::numeric, 2),
    p_description,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_transaction_id) do update set
    metadata = public.ride_financial_ledger.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid)
is 'Security definer helper to append a normalized financial event to the ride ledger.';

revoke all on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid) from public;
revoke execute on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid) from authenticated;

NOTIFY pgrst, 'reload schema';
