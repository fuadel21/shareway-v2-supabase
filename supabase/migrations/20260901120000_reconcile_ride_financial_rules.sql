-- ============================================================================
-- ShareWay: canonical pricing, booking amounts, refunds and settlement
-- Date: 2026-09-01
--
-- This migration is the database source of truth for money-moving ride flows.
--
-- Canonical rules:
--   * Ride price is EUR per seat, from the progressive distance tiers used by
--     the current client: 15km/0.30, 50km/0.216, then 0.15 EUR/km
--     without an upper distance tier.
--   * Suggested ride price is clamped to 0.50..300.00 EUR per seat. A driver
--     may offer less, but never more than suggested price + 0.05 EUR.
--   * Booking total = (ride price / ride distance * passenger distance +
--     pickup supplement) * seats. Passenger distance and pickup detour are
--     calculated from server-side coordinates; pickup supplement is 1.50 EUR
--     per seat when the pickup is more than 3km from the ride origin.
--   * Completed settlements split the amount actually paid 90% to the driver
--     and 10% to the platform. Both values are rounded to cents and the fee is
--     the remainder, so driver + platform always equals the gross amount.
--   * Passenger cancellation: >24h = 100%, 2..24h = 50%, <2h = 0%.
--     Passenger cancellation penalties are split 80% driver / 20% platform.
--   * Driver cancellation refunds every eligible passenger 100%. The driver
--     penalty is 5.00 EUR under 2h, 2.00 EUR from 2h to under 24h, and 0.00
--     EUR at 24h or more. Half is shared between passengers and the remainder
--     goes to the platform (rounding remainder included).
--
-- Card refunds are performed by the authenticated Edge Functions, then the
-- exact external refund amount is passed to the SQL RPC. Direct SQL calls for
-- card bookings fail closed instead of crediting an in-app wallet as well.
-- ============================================================================

-- Payment/reconciliation metadata used by the card webhook and cancellation
-- functions. All are additive so existing projects remain migratable.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS total_seats INTEGER,
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_address TEXT,
  ADD COLUMN IF NOT EXISTS driver_display_name TEXT,
  ADD COLUMN IF NOT EXISTS driver_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS rides_idempotency_key_uidx
  ON public.rides (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC DEFAULT 20,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS requested_seats INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS distance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overview_polyline TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS details TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_women_only BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS driver_id UUID,
  ADD COLUMN IF NOT EXISTS matched_ride_id UUID,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS pin TEXT,
  ADD COLUMN IF NOT EXISTS pickup_location JSONB,
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_location JSONB,
  ADD COLUMN IF NOT EXISTS dropoff_address TEXT,
  ADD COLUMN IF NOT EXISTS booking_signature TEXT;

-- The card-booking Edge Function uses this exact conflict target. The old
-- constraint lived only in _LEGACY_HISTORY_, so a clean migration run must
-- create it here instead of assuming that a manually applied SQL file exists.
-- Do not silently pick a duplicate request: duplicate rows are data corruption
-- and must be reconciled before this unique index can be deployed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ride_requests
    WHERE ride_id IS NOT NULL
      AND requester_id IS NOT NULL
    GROUP BY ride_id, requester_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'RIDE_REQUESTS_DUPLICATE_RIDE_REQUESTER: reconcile duplicate ride_requests before deploying the booking payment flow';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ride_requests_ride_requester_uidx
  ON public.ride_requests (ride_id, requester_id);

COMMENT ON INDEX ride_requests_ride_requester_uidx IS
  'One current booking/payment request per ride and requester; required by the idempotent card-booking upsert.';

-- Payouts reserve balance while they wait for an administrator/Stripe to
-- finish the transfer. This prevents two pending requests from spending the
-- same wallet balance and keeps the external transfer retryable.
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS payout_reserved NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- payment_intents historically tracked wallet deposits only. Keep its business
-- status compatible with that schema and add a separate financial status so a
-- ride PaymentIntent can be audited as created/captured/refunded without
-- pretending that the ride has already been fulfilled.
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS financial_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS ride_id UUID,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS booking_signature TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS booking_attempt INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_booking_operation_uidx
  ON public.payment_intents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_intents_booking_request_idx
  ON public.payment_intents (request_id, booking_attempt DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_intents_booking_ride_user_idx
  ON public.payment_intents (ride_id, user_id, created_at DESC)
  WHERE ride_id IS NOT NULL;

COMMENT ON COLUMN public.payment_intents.ride_id IS
  'Ride associated with a card booking reservation; NULL for wallet top-ups.';
COMMENT ON COLUMN public.payment_intents.request_id IS
  'Durable ride_requests reservation associated with this PaymentIntent attempt.';
COMMENT ON COLUMN public.payment_intents.booking_signature IS
  'Server-validated pickup/dropoff/seats quote signature for a ride booking.';
COMMENT ON COLUMN public.payment_intents.idempotency_key IS
  'Stable Stripe idempotency key for this durable booking attempt.';

CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_stripe_transfer_id_uidx
  ON public.payout_requests (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_user_idempotency_uidx
  ON public.payout_requests (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Reconcile requests created by the historical payout RPC before this
-- migration. Re-running this statement is safe and avoids releasing their
-- reservation when the canonical endpoint takes over.
UPDATE public.wallets AS wallet
SET payout_reserved = COALESCE((
  SELECT round(sum(pr.amount), 2)
  FROM public.payout_requests AS pr
  WHERE pr.user_id = wallet.user_id
    AND lower(COALESCE(pr.status, '')) = 'pending'
), 0),
    updated_at = NOW();

COMMENT ON COLUMN public.wallets.payout_reserved IS
  'Wallet funds reserved by pending payout requests; never spendable by a second request.';
COMMENT ON COLUMN public.payout_requests.stripe_transfer_id IS
  'Stripe transfer id recorded after the payout is settled; used for idempotent retries.';

COMMENT ON COLUMN public.ride_requests.requested_seats IS
  'Number of seats requested; persisted so Stripe webhook fulfillment cannot default a multi-seat booking to one seat.';
COMMENT ON COLUMN public.ride_requests.amount IS
  'Server-quoted total booking amount in EUR, including seats and pickup supplement.';

-- Stripe events are persisted before any money-moving RPC runs. This is the
-- durable hand-off between an external provider and SQL: retries can reclaim a
-- failed/stale event, while a processed event is a permanent idempotency key.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'received',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_idx
  ON public.stripe_webhook_events (status, last_attempt_at);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- A PaymentIntent can have several financial states over its lifetime. This
-- append-only-ish table makes the generic Stripe transition observable even
-- when the intent is a ride booking (which is fulfilled through
-- fulfill_booking_after_payment rather than a wallet deposit).
CREATE TABLE IF NOT EXISTS public.stripe_financial_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_id TEXT NOT NULL,
  status TEXT NOT NULL,
  event_id TEXT,
  user_id UUID,
  ride_id UUID,
  amount NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'EUR',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_id, status)
);

CREATE INDEX IF NOT EXISTS stripe_financial_transitions_stripe_id_idx
  ON public.stripe_financial_transitions (stripe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stripe_financial_transitions_ride_id_idx
  ON public.stripe_financial_transitions (ride_id, created_at DESC);

ALTER TABLE public.stripe_financial_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_financial_transitions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.stripe_financial_transitions IS
  'Durable audit trail for Stripe PaymentIntent status transitions; money is moved only by the canonical fulfillment/refund operations.';

-- Refunds are an external side effect, so cancellation creates a durable
-- operation before calling Stripe. If the Edge Function dies after Stripe
-- accepts the refund, the same operation key and Stripe idempotency key allow a
-- later retry to close SQL without issuing a second refund.
CREATE TABLE IF NOT EXISTS public.stripe_refund_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT NOT NULL,
  ride_id UUID NOT NULL,
  passenger_id UUID NOT NULL,
  refund_amount NUMERIC(12, 2) NOT NULL CHECK (refund_amount >= 0),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'refunded', 'settled', 'failed')),
  stripe_refund_id TEXT,
  stripe_event_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_refund_operations_refund_id_uidx
  ON public.stripe_refund_operations (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stripe_refund_operations_status_idx
  ON public.stripe_refund_operations (status, updated_at);
CREATE INDEX IF NOT EXISTS stripe_refund_operations_ride_id_idx
  ON public.stripe_refund_operations (ride_id, passenger_id);

ALTER TABLE public.stripe_refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_refund_operations FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.stripe_refund_operations IS
  'Durable Stripe refund outbox/state machine. A prepared operation is retryable until its external refund and internal settlement are both recorded.';

COMMENT ON TABLE public.stripe_webhook_events IS
  'Durable Stripe webhook inbox. Service role claims, retries and closes events atomically.';

-- Persist generic Stripe status changes instead of returning a misleading
-- success from the historical no-op transition_financial_status RPC.
DROP FUNCTION IF EXISTS public.transition_financial_status(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.transition_financial_status(
  p_stripe_id TEXT,
  p_new_status TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stripe_id TEXT := NULLIF(trim(p_stripe_id), '');
  v_status TEXT := lower(NULLIF(trim(p_new_status), ''));
  v_metadata JSONB := COALESCE(p_metadata, '{}'::JSONB);
  v_transition public.stripe_financial_transitions%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_event_id TEXT;
  v_user_id UUID;
  v_ride_id UUID;
  v_amount NUMERIC;
  v_currency TEXT := 'EUR';
  v_value TEXT;
  v_already_recorded BOOLEAN := FALSE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF v_stripe_id IS NULL OR v_status NOT IN (
    'created', 'requires_payment_method', 'requires_action', 'processing',
    'captured', 'succeeded', 'failed', 'refunded', 'canceled', 'cancelled',
    'disputed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_FINANCIAL_STATUS_TRANSITION');
  END IF;

  v_event_id := NULLIF(v_metadata ->> 'stripe_event_id', '');
  v_currency := upper(COALESCE(NULLIF(v_metadata ->> 'currency', ''), 'EUR'));

  BEGIN
    v_value := COALESCE(
      NULLIF(v_metadata ->> 'user_id', ''),
      NULLIF(v_metadata ->> 'requester_id', '')
    );
    IF v_value IS NOT NULL THEN v_user_id := v_value::UUID; END IF;
    v_value := NULLIF(v_metadata ->> 'ride_id', '');
    IF v_value IS NOT NULL THEN v_ride_id := v_value::UUID; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_FINANCIAL_METADATA');
  END;

  BEGIN
    v_value := COALESCE(
      NULLIF(v_metadata ->> 'amount', ''),
      NULLIF(v_metadata ->> 'amount_eur', ''),
      NULLIF(v_metadata ->> 'amount_received', '')
    );
    IF v_value IS NOT NULL THEN v_amount := round(v_value::NUMERIC, 2); END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_FINANCIAL_AMOUNT');
  END;

  -- A captured/succeeded transition is the SQL boundary used by the webhook
  -- before any wallet credit or booking fulfillment. If this PaymentIntent is
  -- known locally, its immutable requested amount and currency must agree with
  -- the amount Stripe reported; otherwise an internal caller could manufacture
  -- a captured amount and make fulfillment rely on it.
  IF v_status IN ('captured', 'succeeded') THEN
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'CAPTURED_AMOUNT_REQUIRED');
    END IF;

    SELECT *
      INTO v_intent
    FROM public.payment_intents
    WHERE external_id = v_stripe_id
    FOR UPDATE;

    IF FOUND AND (
      v_intent.amount IS NULL
      OR round(v_intent.amount, 2) IS DISTINCT FROM round(v_amount, 2)
      OR upper(COALESCE(v_intent.currency, 'EUR')) IS DISTINCT FROM v_currency
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CAPTURED_AMOUNT_MISMATCH');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stripe_financial_transitions
    WHERE stripe_id = v_stripe_id AND status = v_status
  ) INTO v_already_recorded;

  INSERT INTO public.stripe_financial_transitions (
    stripe_id, status, event_id, user_id, ride_id, amount, currency, metadata,
    updated_at
  ) VALUES (
    v_stripe_id, v_status, v_event_id, v_user_id, v_ride_id, v_amount,
    v_currency, v_metadata, NOW()
  )
  ON CONFLICT (stripe_id, status) DO UPDATE SET
    event_id = COALESCE(EXCLUDED.event_id, stripe_financial_transitions.event_id),
    user_id = COALESCE(EXCLUDED.user_id, stripe_financial_transitions.user_id),
    ride_id = COALESCE(EXCLUDED.ride_id, stripe_financial_transitions.ride_id),
    amount = COALESCE(EXCLUDED.amount, stripe_financial_transitions.amount),
    currency = COALESCE(EXCLUDED.currency, stripe_financial_transitions.currency),
    metadata = stripe_financial_transitions.metadata || EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING * INTO v_transition;

  -- payment_intents.status remains the wallet/deposit business state. The
  -- separate financial_status column is safe for both deposits and bookings.
  -- Stripe deliveries are not guaranteed to arrive in order. Keep the
  -- current financial status monotonic while still recording every accepted
  -- status in the audit table above.
  UPDATE public.payment_intents
  SET financial_status = CASE
        WHEN CASE v_status
          WHEN 'created' THEN 1
          WHEN 'requires_payment_method' THEN 1
          WHEN 'requires_action' THEN 2
          WHEN 'processing' THEN 3
          WHEN 'failed' THEN 4
          WHEN 'canceled' THEN 4
          WHEN 'cancelled' THEN 4
          WHEN 'captured' THEN 5
          WHEN 'succeeded' THEN 5
          WHEN 'refunded' THEN 6
          WHEN 'disputed' THEN 7
          ELSE 0
        END >= CASE COALESCE(financial_status, 'pending')
          WHEN 'pending' THEN 0
          WHEN 'created' THEN 1
          WHEN 'requires_payment_method' THEN 1
          WHEN 'requires_action' THEN 2
          WHEN 'processing' THEN 3
          WHEN 'failed' THEN 4
          WHEN 'canceled' THEN 4
          WHEN 'cancelled' THEN 4
          WHEN 'captured' THEN 5
          WHEN 'succeeded' THEN 5
          WHEN 'refunded' THEN 6
          WHEN 'disputed' THEN 7
          ELSE 0
        END
        THEN v_status
        ELSE financial_status
      END,
      metadata = COALESCE(metadata, '{}'::JSONB) || v_metadata,
      updated_at = NOW()
  WHERE external_id = v_stripe_id;

  RETURN jsonb_build_object(
    'success', true,
    'transition_id', v_transition.id,
    'stripe_id', v_transition.stripe_id,
    'status', v_transition.status,
    'already_recorded', v_already_recorded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_financial_status(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_financial_status(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.transition_financial_status(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_financial_status(text, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.prepare_stripe_refund_operation(text, text, uuid, uuid, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.prepare_stripe_refund_operation(
  p_operation_key TEXT,
  p_payment_intent_id TEXT,
  p_ride_id UUID,
  p_passenger_id UUID,
  p_refund_amount NUMERIC,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.stripe_refund_operations%ROWTYPE;
  v_key TEXT := NULLIF(trim(p_operation_key), '');
  v_payment_intent_id TEXT := NULLIF(trim(p_payment_intent_id), '');
  v_amount NUMERIC := round(COALESCE(p_refund_amount, 0), 2);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF v_key IS NULL OR length(v_key) > 200
     OR v_payment_intent_id IS NULL
     OR p_ride_id IS NULL OR p_passenger_id IS NULL
     OR v_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_REFUND_OPERATION');
  END IF;

  SELECT * INTO v_operation
  FROM public.stripe_refund_operations
  WHERE operation_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.payment_intent_id IS DISTINCT FROM v_payment_intent_id
       OR v_operation.ride_id IS DISTINCT FROM p_ride_id
       OR v_operation.passenger_id IS DISTINCT FROM p_passenger_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_KEY_REUSED');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'already_prepared', true,
      'operation_key', v_operation.operation_key,
      'payment_intent_id', v_operation.payment_intent_id,
      'ride_id', v_operation.ride_id,
      'passenger_id', v_operation.passenger_id,
      'refund_amount', v_operation.refund_amount,
      'status', v_operation.status,
      'stripe_refund_id', v_operation.stripe_refund_id,
      'attempt_count', v_operation.attempt_count
    );
  END IF;

  -- DO NOTHING closes the SELECT/INSERT race when two Edge retries start
  -- the same cancellation concurrently. The winner's immutable amount is
  -- then returned to the losing retry below.
  INSERT INTO public.stripe_refund_operations (
    operation_key, payment_intent_id, ride_id, passenger_id, refund_amount,
    status, metadata, updated_at
  ) VALUES (
    v_key, v_payment_intent_id, p_ride_id, p_passenger_id, v_amount,
    'prepared', COALESCE(p_metadata, '{}'::JSONB), NOW()
  )
  ON CONFLICT (operation_key) DO NOTHING
  RETURNING * INTO v_operation;

  IF NOT FOUND THEN
    SELECT * INTO v_operation
    FROM public.stripe_refund_operations
    WHERE operation_key = v_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_NOT_FOUND');
    END IF;
    IF v_operation.payment_intent_id IS DISTINCT FROM v_payment_intent_id
       OR v_operation.ride_id IS DISTINCT FROM p_ride_id
       OR v_operation.passenger_id IS DISTINCT FROM p_passenger_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_KEY_REUSED');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'already_prepared', true,
      'operation_key', v_operation.operation_key,
      'payment_intent_id', v_operation.payment_intent_id,
      'ride_id', v_operation.ride_id,
      'passenger_id', v_operation.passenger_id,
      'refund_amount', v_operation.refund_amount,
      'status', v_operation.status,
      'stripe_refund_id', v_operation.stripe_refund_id,
      'attempt_count', v_operation.attempt_count
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'operation_key', v_operation.operation_key,
    'payment_intent_id', v_operation.payment_intent_id,
    'ride_id', v_operation.ride_id,
    'passenger_id', v_operation.passenger_id,
    'refund_amount', v_operation.refund_amount,
    'status', v_operation.status,
    'stripe_refund_id', v_operation.stripe_refund_id,
    'attempt_count', v_operation.attempt_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_stripe_refund_operation(text, text, uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_stripe_refund_operation(text, text, uuid, uuid, numeric, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_stripe_refund_operation(text, text, uuid, uuid, numeric, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_stripe_refund_operation(text, text, uuid, uuid, numeric, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.complete_stripe_refund_operation(text, text, numeric, text, jsonb);

CREATE OR REPLACE FUNCTION public.complete_stripe_refund_operation(
  p_operation_key TEXT,
  p_stripe_refund_id TEXT,
  p_refund_amount NUMERIC,
  p_stripe_event_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.stripe_refund_operations%ROWTYPE;
  v_key TEXT := NULLIF(trim(p_operation_key), '');
  v_refund_id TEXT := NULLIF(trim(p_stripe_refund_id), '');
  v_amount NUMERIC := round(COALESCE(p_refund_amount, 0), 2);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF v_key IS NULL OR v_refund_id IS NULL OR v_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_REFUND_OPERATION_COMPLETION');
  END IF;

  SELECT * INTO v_operation
  FROM public.stripe_refund_operations
  WHERE operation_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_NOT_FOUND');
  END IF;
  IF round(v_operation.refund_amount, 2) <> v_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_AMOUNT_MISMATCH');
  END IF;
  IF v_operation.status = 'settled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_settled', true,
      'operation_key', v_key,
      'refund_amount', v_operation.refund_amount,
      'stripe_refund_id', v_operation.stripe_refund_id
    );
  END IF;
  IF v_operation.stripe_refund_id IS NOT NULL
     AND v_operation.stripe_refund_id IS DISTINCT FROM v_refund_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_ID_MISMATCH');
  END IF;

  UPDATE public.stripe_refund_operations
  SET status = 'refunded',
      stripe_refund_id = v_refund_id,
      stripe_event_id = COALESCE(NULLIF(trim(p_stripe_event_id), ''), stripe_event_id),
      attempt_count = attempt_count + 1,
      metadata = COALESCE(metadata, '{}'::JSONB) || COALESCE(p_metadata, '{}'::JSONB),
      updated_at = NOW()
  WHERE operation_key = v_key
  RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'success', true,
    'operation_key', v_operation.operation_key,
    'refund_amount', v_operation.refund_amount,
    'status', v_operation.status,
    'stripe_refund_id', v_operation.stripe_refund_id,
    'attempt_count', v_operation.attempt_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stripe_refund_operation(text, text, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_stripe_refund_operation(text, text, numeric, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_stripe_refund_operation(text, text, numeric, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_refund_operation(text, text, numeric, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.stripe_webhook_events%ROWTYPE;
  v_event_id TEXT := NULLIF(trim(p_event_id), '');
  v_event_type TEXT := COALESCE(NULLIF(trim(p_event_type), ''), 'unknown');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF v_event_id IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STRIPE_EVENT');
  END IF;

  SELECT *
    INTO v_event
  FROM public.stripe_webhook_events
  WHERE event_id = v_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.stripe_webhook_events (
      event_id, event_type, payload, status, attempt_count,
      first_received_at, last_attempt_at, updated_at
    ) VALUES (
      v_event_id, v_event_type, p_payload, 'processing', 1,
      NOW(), NOW(), NOW()
    );

    RETURN jsonb_build_object('success', true, 'claimed', true, 'attempt_count', 1);
  END IF;

  IF v_event.status = 'processed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true,
      'attempt_count', v_event.attempt_count
    );
  END IF;

  -- Do not let two webhook workers perform external refunds/transfers for the
  -- same event concurrently. A crashed worker is reclaimable after ten minutes;
  -- all downstream SQL and Stripe calls remain idempotent on that retry.
  IF v_event.status = 'processing'
     AND COALESCE(v_event.last_attempt_at, v_event.updated_at, NOW()) > NOW() - INTERVAL '10 minutes' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processing', true,
      'attempt_count', v_event.attempt_count
    );
  END IF;

  UPDATE public.stripe_webhook_events
  SET event_type = v_event_type,
      payload = p_payload,
      status = 'processing',
      attempt_count = v_event.attempt_count + 1,
      last_attempt_at = NOW(),
      last_error = NULL,
      updated_at = NOW()
  WHERE event_id = v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'claimed', true,
    'attempt_count', v_event.attempt_count + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.complete_stripe_webhook_event(text, text, text);

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(
  p_event_id TEXT,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT := lower(trim(COALESCE(p_status, '')));
  v_event_id TEXT := NULLIF(trim(p_event_id), '');
  v_updated INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF v_event_id IS NULL OR v_status NOT IN ('processed', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STRIPE_EVENT_STATUS');
  END IF;

  UPDATE public.stripe_webhook_events
  SET status = v_status,
      processed_at = CASE WHEN v_status = 'processed' THEN NOW() ELSE NULL END,
      last_error = CASE WHEN v_status = 'failed' THEN left(NULLIF(trim(p_error), ''), 2000) ELSE NULL END,
      updated_at = NOW()
  WHERE event_id = v_event_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'STRIPE_EVENT_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text, text, text) TO service_role;

-- --------------------------------------------------------------------------
-- Wallet deposits and payouts
-- --------------------------------------------------------------------------
-- Stripe is the authority that says whether a card was charged. The webhook
-- supplies that fact to these service-role-only RPCs; neither amount nor user
-- identity is accepted from an untrusted browser as a wallet mutation.

CREATE OR REPLACE FUNCTION public.settle_wallet_deposit(
  p_external_id TEXT,
  p_paid_amount NUMERIC,
  p_stripe_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_wallet_updated INTEGER;
  v_transaction_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  IF p_external_id IS NULL OR trim(p_external_id) = ''
     OR p_paid_amount IS NULL OR p_paid_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DEPOSIT');
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE external_id = p_external_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEPOSIT_INTENT_NOT_FOUND');
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true,
      'intent_id', v_intent.id,
      'user_id', v_intent.user_id,
      'amount', v_intent.amount
    );
  END IF;

  IF v_intent.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEPOSIT_NOT_PENDING');
  END IF;

  IF v_intent.user_id IS NULL OR v_intent.amount IS NULL
     OR round(v_intent.amount, 2) <> round(p_paid_amount, 2) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEPOSIT_AMOUNT_MISMATCH');
  END IF;

  UPDATE public.wallets
  SET balance = round(COALESCE(balance, 0) + round(v_intent.amount, 2), 2),
      updated_at = NOW()
  WHERE user_id = v_intent.user_id;
  GET DIAGNOSTICS v_wallet_updated = ROW_COUNT;

  IF v_wallet_updated <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_NOT_FOUND');
  END IF;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    v_intent.user_id,
    round(v_intent.amount, 2),
    'deposit',
    'Recarga confirmada por Stripe' || CASE
      WHEN p_stripe_event_id IS NULL THEN ''
      ELSE ' (' || left(p_stripe_event_id, 80) || ')'
    END,
    NULL
  )
  RETURNING id INTO v_transaction_id;

  UPDATE public.payment_intents
  SET status = 'completed',
      financial_status = 'captured',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('stripe_event_id', p_stripe_event_id),
      updated_at = NOW()
  WHERE id = v_intent.id;

  PERFORM public.create_notification(
    v_intent.user_id,
    'payment_success',
    'Recarga completada',
    'Se han añadido ' || round(v_intent.amount, 2) || ' EUR a tu saldo.',
    jsonb_build_object(
      'payment_intent_id', p_external_id,
      'stripe_event_id', p_stripe_event_id,
      'transaction_id', v_transaction_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'intent_id', v_intent.id,
    'transaction_id', v_transaction_id,
    'credited', round(v_intent.amount, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_wallet_deposit(text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_wallet_deposit(text, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.settle_wallet_deposit(text, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_wallet_deposit(text, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_wallet_deposit_failed(
  p_external_id TEXT,
  p_stripe_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE external_id = p_external_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEPOSIT_INTENT_NOT_FOUND');
  END IF;

  IF v_intent.status = 'failed' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;
  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEPOSIT_ALREADY_COMPLETED');
  END IF;

  UPDATE public.payment_intents
  SET status = 'failed',
      financial_status = 'failed',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('stripe_event_id', p_stripe_event_id),
      updated_at = NOW()
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'failed',
    'stripe_event_id', p_stripe_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_wallet_deposit_failed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_wallet_deposit_failed(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mark_wallet_deposit_failed(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_wallet_deposit_failed(text, text) TO service_role;

DROP FUNCTION IF EXISTS public.request_payout(numeric);

CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet public.wallets%ROWTYPE;
  v_existing_payout public.payout_requests%ROWTYPE;
  v_payout_id UUID;
  v_amount NUMERIC;
  v_available NUMERIC;
  v_idempotency_key TEXT := NULLIF(trim(p_idempotency_key), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  v_amount := round(COALESCE(p_amount, 0), 2);
  IF v_amount < 5.00 OR v_amount > 3000.00 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYOUT_AMOUNT_OUT_OF_RANGE');
  END IF;
  IF v_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  END IF;
  IF length(v_idempotency_key) > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_IDEMPOTENCY_KEY');
  END IF;

  -- Lock the wallet before checking and creating the request. This makes the
  -- available-balance calculation and the reservation one serialized decision.
  SELECT *
    INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_NOT_FOUND');
  END IF;

  SELECT *
    INTO v_existing_payout
  FROM public.payout_requests
  WHERE user_id = v_user_id
    AND idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF round(v_existing_payout.amount, 2) IS DISTINCT FROM v_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_AMOUNT');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'already_requested', true,
      'payout_id', v_existing_payout.id,
      'amount', v_existing_payout.amount,
      'available_balance', NULL,
      'status', v_existing_payout.status
    );
  END IF;

  v_available := round(COALESCE(v_wallet.balance, 0) - COALESCE(v_wallet.payout_reserved, 0), 2);
  IF v_available < v_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALDO_INSUFICIENTE');
  END IF;

  INSERT INTO public.payout_requests (
    user_id, amount, status, reserved_at, idempotency_key
  ) VALUES (
    v_user_id, v_amount, 'pending', NOW(), v_idempotency_key)
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_payout_id;

  IF NOT FOUND THEN
    -- Another request won the unique-key race. Re-read the durable row and
    -- reject accidental idempotency-key reuse with a different amount.
    SELECT *
      INTO v_existing_payout
    FROM public.payout_requests
    WHERE user_id = v_user_id
      AND idempotency_key = v_idempotency_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYOUT_RESERVATION_NOT_PERSISTED');
    END IF;
    IF round(v_existing_payout.amount, 2) IS DISTINCT FROM v_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_AMOUNT');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'already_requested', true,
      'payout_id', v_existing_payout.id,
      'amount', v_existing_payout.amount,
      'available_balance', NULL,
      'status', v_existing_payout.status
    );
  END IF;

  UPDATE public.wallets
  SET payout_reserved = round(COALESCE(payout_reserved, 0) + v_amount, 2),
      updated_at = NOW()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout_id,
    'amount', v_amount,
    'available_balance', round(v_available - v_amount, 2),
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_payout(numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_payout(numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_payout(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_payout(numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.process_payout(
  p_payout_id UUID,
  p_status TEXT DEFAULT 'completed',
  p_stripe_transfer_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payout public.payout_requests%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_transaction_id UUID;
  v_status TEXT := lower(trim(COALESCE(p_status, 'completed')));
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles p
       WHERE p.id = auth.uid()
         AND (COALESCE(p.is_admin, FALSE) OR p.role IN ('admin', 'super_admin'))
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ADMIN_REQUIRED');
  END IF;

  IF p_payout_id IS NULL OR v_status NOT IN ('completed', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYOUT_TRANSITION');
  END IF;

  -- An authenticated administrator may reject a request, but only the
  -- service-role Stripe Edge Function may close it as completed. The transfer
  -- id is an external fact and must not be invented by a dashboard caller.
  IF v_status = 'completed' AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED_FOR_PAYOUT_SETTLEMENT');
  END IF;

  SELECT *
    INTO v_payout
  FROM public.payout_requests
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYOUT_NOT_FOUND');
  END IF;

  IF v_payout.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true,
      'payout_id', p_payout_id,
      'transfer_id', v_payout.stripe_transfer_id
    );
  END IF;

  IF v_payout.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYOUT_NOT_PENDING');
  END IF;

  SELECT *
    INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_payout.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_NOT_FOUND');
  END IF;

  IF v_status = 'completed' THEN
    IF p_stripe_transfer_id IS NULL OR trim(p_stripe_transfer_id) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'STRIPE_TRANSFER_REQUIRED');
    END IF;

    IF COALESCE(v_wallet.payout_reserved, 0) < v_payout.amount
       OR COALESCE(v_wallet.balance, 0) < v_payout.amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALDO_RESERVADO_INSUFICIENTE');
    END IF;

    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) - v_payout.amount, 2),
        payout_reserved = round(COALESCE(payout_reserved, 0) - v_payout.amount, 2),
        updated_at = NOW()
    WHERE user_id = v_payout.user_id;

    INSERT INTO public.transactions (
      user_id, amount, type, description, related_ride_id
    ) VALUES (
      v_payout.user_id,
      -round(v_payout.amount, 2),
      'withdrawal',
      'Retiro enviado a Stripe (' || left(p_stripe_transfer_id, 80) || ')',
      NULL
    )
    RETURNING id INTO v_transaction_id;

    UPDATE public.payout_requests
    SET status = 'completed',
        stripe_transfer_id = p_stripe_transfer_id,
        processed_at = NOW(),
        completed_at = NOW()
    WHERE id = p_payout_id;

    PERFORM public.record_ride_financial_event(
      NULL,
      v_payout.user_id,
      'payout',
      'settled',
      v_payout.amount,
      0,
      v_payout.amount,
      0,
      'Retiro procesado por Stripe',
      jsonb_build_object('payout_id', p_payout_id, 'stripe_transfer_id', p_stripe_transfer_id),
      v_transaction_id,
      NULL
    );
  ELSE
    UPDATE public.wallets
    SET payout_reserved = greatest(round(COALESCE(payout_reserved, 0) - v_payout.amount, 2), 0),
        updated_at = NOW()
    WHERE user_id = v_payout.user_id;

    UPDATE public.payout_requests
    SET status = 'rejected',
        rejection_reason = COALESCE(p_stripe_transfer_id, 'Retiro rechazado'),
        processed_at = NOW()
    WHERE id = p_payout_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', p_payout_id,
    'status', v_status,
    'amount', round(v_payout.amount, 2),
    'transaction_id', v_transaction_id,
    'transfer_id', p_stripe_transfer_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_payout(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_payout(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_payout(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_payout(uuid, text, text) TO authenticated;

-- The historical elite RPC performs wallet deductions without the canonical
-- reservation/Stripe transition. Remove it rather than leaving an old
-- authenticated grant in place. DROP is idempotent for projects that never
-- installed that historical migration.
DROP FUNCTION IF EXISTS public.process_payout_elite(uuid, text, text);

-- --------------------------------------------------------------------------
-- Pure server-side pricing helpers
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sw_json_coordinate(
  p_location JSONB,
  p_axis TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value TEXT;
BEGIN
  IF lower(p_axis) = 'lat' THEN
    v_value := COALESCE(
      p_location ->> 'lat',
      p_location ->> 'latitude',
      p_location -> 'coordinates' ->> 'lat',
      p_location -> 'coordinates' ->> 'latitude'
    );
  ELSIF lower(p_axis) = 'lng' THEN
    v_value := COALESCE(
      p_location ->> 'lng',
      p_location ->> 'longitude',
      p_location -> 'coordinates' ->> 'lng',
      p_location -> 'coordinates' ->> 'longitude'
    );
  ELSE
    RETURN NULL;
  END IF;

  IF v_value IS NULL OR trim(v_value) !~ '^[-+]?[0-9]+([.][0-9]+)?$' THEN
    RETURN NULL;
  END IF;

  RETURN trim(v_value)::NUMERIC;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sw_haversine_km(
  p_lat1 NUMERIC,
  p_lng1 NUMERIC,
  p_lat2 NUMERIC,
  p_lng2 NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dlat NUMERIC;
  v_dlng NUMERIC;
  v_a NUMERIC;
BEGIN
  IF p_lat1 < -90 OR p_lat1 > 90
     OR p_lat2 < -90 OR p_lat2 > 90
     OR p_lng1 < -180 OR p_lng1 > 180
     OR p_lng2 < -180 OR p_lng2 > 180 THEN
    RETURN NULL;
  END IF;

  v_dlat := radians(p_lat2 - p_lat1);
  v_dlng := radians(p_lng2 - p_lng1);
  v_a := power(sin(v_dlat / 2), 2)
       + cos(radians(p_lat1))
       * cos(radians(p_lat2))
       * power(sin(v_dlng / 2), 2);

  RETURN 6371::NUMERIC * 2 * asin(sqrt(least(1::NUMERIC, greatest(0::NUMERIC, v_a))));
END;
$$;

CREATE OR REPLACE FUNCTION public.sw_progressive_price(
  p_distance_km NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining NUMERIC;
  v_total NUMERIC := 0;
  v_segment NUMERIC;
BEGIN
  IF p_distance_km IS NULL OR p_distance_km <= 0 THEN
    RETURN 0.00;
  END IF;

  v_remaining := p_distance_km;

  v_segment := LEAST(v_remaining, 15);
  v_total := v_total + v_segment * 0.30;
  v_remaining := v_remaining - v_segment;

  IF v_remaining > 0 THEN
    v_segment := LEAST(v_remaining, 35);
    v_total := v_total + v_segment * 0.216;
    v_remaining := v_remaining - v_segment;
  END IF;

  IF v_remaining > 0 THEN
    v_total := v_total + v_remaining * 0.15;
  END IF;

  RETURN round(greatest(0.50::NUMERIC, least(300::NUMERIC, v_total)), 2);
END;
$$;

-- Returns a captured amount only when the durable SQL payment state proves it.
-- Settlement/no-show/cancellation code uses this instead of trusting the
-- payment_amount value embedded in the passenger JSON.
CREATE OR REPLACE FUNCTION public.sw_captured_payment_amount(
  p_payment_intent_id TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount NUMERIC;
  v_status TEXT;
BEGIN
  IF NULLIF(trim(p_payment_intent_id), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT round(amount, 2), lower(COALESCE(financial_status, ''))
    INTO v_amount, v_status
  FROM public.payment_intents
  WHERE external_id = trim(p_payment_intent_id);

  IF FOUND THEN
    IF v_status IN ('captured', 'succeeded') THEN
      RETURN v_amount;
    END IF;
    RETURN NULL;
  END IF;

  SELECT round(amount, 2)
    INTO v_amount
  FROM public.stripe_financial_transitions
  WHERE stripe_id = trim(p_payment_intent_id)
    AND status IN ('captured', 'succeeded')
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  RETURN v_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.sw_captured_payment_amount(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_captured_payment_amount(text) FROM anon;
REVOKE ALL ON FUNCTION public.sw_captured_payment_amount(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sw_captured_payment_amount(text) TO service_role;

-- Internal quote builder. It is intentionally not granted to clients; the
-- public wrapper below performs the authentication check.
CREATE OR REPLACE FUNCTION public.sw_build_booking_quote(
  p_ride_id UUID,
  p_pickup_location JSONB,
  p_dropoff_location JSONB,
  p_num_seats INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_origin_lat NUMERIC;
  v_origin_lng NUMERIC;
  v_destination_lat NUMERIC;
  v_destination_lng NUMERIC;
  v_pickup_lat NUMERIC;
  v_pickup_lng NUMERIC;
  v_dropoff_lat NUMERIC;
  v_dropoff_lng NUMERIC;
  v_geodesic_distance NUMERIC;
  v_ride_distance NUMERIC;
  v_passenger_distance NUMERIC;
  v_detour_distance NUMERIC;
  v_supplement NUMERIC := 0;
  v_total NUMERIC;
  v_price_per_seat NUMERIC;
  v_suggested_price NUMERIC;
BEGIN
  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF v_ride.status IS DISTINCT FROM 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_SCHEDULED');
  END IF;

  IF v_ride.departure_time IS NULL OR v_ride.departure_time <= NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_ALREADY_DEPARTED');
  END IF;

  IF v_ride.driver_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'DRIVER_CANNOT_BOOK_OWN_RIDE');
  END IF;

  IF p_num_seats IS NULL OR p_num_seats < 1 OR p_num_seats > 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SEAT_COUNT');
  END IF;

  IF COALESCE(v_ride.seats_available, 0) < p_num_seats THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_SEATS_AVAILABLE');
  END IF;

  IF v_ride.price IS NULL OR v_ride.price < 0.50 OR v_ride.price > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RIDE_PRICE');
  END IF;

  v_origin_lat := public.sw_json_coordinate(v_ride.origin, 'lat');
  v_origin_lng := public.sw_json_coordinate(v_ride.origin, 'lng');
  v_destination_lat := public.sw_json_coordinate(v_ride.destination, 'lat');
  v_destination_lng := public.sw_json_coordinate(v_ride.destination, 'lng');

  v_pickup_lat := COALESCE(
    public.sw_json_coordinate(p_pickup_location, 'lat'),
    v_origin_lat
  );
  v_pickup_lng := COALESCE(
    public.sw_json_coordinate(p_pickup_location, 'lng'),
    v_origin_lng
  );
  v_dropoff_lat := COALESCE(
    public.sw_json_coordinate(p_dropoff_location, 'lat'),
    v_destination_lat
  );
  v_dropoff_lng := COALESCE(
    public.sw_json_coordinate(p_dropoff_location, 'lng'),
    v_destination_lng
  );

  IF v_origin_lat IS NULL OR v_origin_lng IS NULL
     OR v_destination_lat IS NULL OR v_destination_lng IS NULL
     OR v_pickup_lat IS NULL OR v_pickup_lng IS NULL
     OR v_dropoff_lat IS NULL OR v_dropoff_lng IS NULL
     OR v_origin_lat NOT BETWEEN -90 AND 90
     OR v_destination_lat NOT BETWEEN -90 AND 90
     OR v_pickup_lat NOT BETWEEN -90 AND 90
     OR v_dropoff_lat NOT BETWEEN -90 AND 90
     OR v_origin_lng NOT BETWEEN -180 AND 180
     OR v_destination_lng NOT BETWEEN -180 AND 180
     OR v_pickup_lng NOT BETWEEN -180 AND 180
     OR v_dropoff_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BOOKING_COORDINATES');
  END IF;

  v_geodesic_distance := public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_destination_lat,
    v_destination_lng
  );

  IF v_ride.distance IS NULL OR v_ride.distance <= 0 THEN
    -- A legacy row without a persisted route distance falls back to the
    -- server-derived geodesic distance; it is still subject to the price band.
    v_ride_distance := greatest(COALESCE(v_geodesic_distance, 0), 1);
  ELSE
    IF v_ride.distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
       OR v_ride.distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
      RETURN jsonb_build_object('success', false, 'error', 'DISTANCE_OUT_OF_ROUTE_BOUNDS');
    END IF;
    v_ride_distance := greatest(v_ride.distance, 1);
  END IF;

  -- Scheduled legacy rides are not repriced silently. They can continue to
  -- exist, but a new booking is rejected if their stored per-seat price is
  -- above the current server-side suggestion plus the agreed 0.05 EUR band.
  v_suggested_price := public.sw_progressive_price(v_ride_distance);
  IF round(v_ride.price, 2) > v_suggested_price + 0.05 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RIDE_PRICE_OUTSIDE_CANONICAL_BAND',
      'suggested_price', v_suggested_price,
      'stored_price', round(v_ride.price, 2)
    );
  END IF;

  v_passenger_distance := greatest(
    COALESCE(public.sw_haversine_km(
      v_pickup_lat,
      v_pickup_lng,
      v_dropoff_lat,
      v_dropoff_lng
    ), 0),
    0.5
  );

  v_detour_distance := COALESCE(public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_pickup_lat,
    v_pickup_lng
  ), 0);

  IF v_detour_distance > 3 THEN
    v_supplement := 1.50;
  END IF;

  v_total := round(greatest(
    0.50 * p_num_seats,
    (
      (v_ride.price / v_ride_distance) * v_passenger_distance
      + v_supplement
    ) * p_num_seats
  ), 2);

  IF v_total < 0.50 OR v_total > 2400 THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_AMOUNT_OUT_OF_RANGE');
  END IF;

  v_price_per_seat := round(v_total / p_num_seats, 6);

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', v_ride.id,
    'ride_price_per_seat', round(v_ride.price, 2),
    'ride_distance_km', round(v_ride_distance, 3),
    'passenger_distance_km', round(v_passenger_distance, 3),
    'detour_distance_km', round(v_detour_distance, 3),
    'pickup_supplement_per_seat', v_supplement,
    'num_seats', p_num_seats,
    'price_per_seat', v_price_per_seat,
    'total', v_total,
    'platform_fee_rate', 0.10,
    'platform_fee', round(v_total * 0.10, 2),
    'driver_payout', round(v_total - round(v_total * 0.10, 2), 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_ride_booking(
  p_ride_id UUID,
  p_pickup_location JSONB DEFAULT NULL,
  p_dropoff_location JSONB DEFAULT NULL,
  p_num_seats INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  RETURN public.sw_build_booking_quote(
    p_ride_id,
    p_pickup_location,
    p_dropoff_location,
    p_num_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM anon;
REVOKE ALL ON FUNCTION public.sw_build_booking_quote(uuid, jsonb, jsonb, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.quote_ride_booking(uuid, jsonb, jsonb, integer) TO authenticated;

-- --------------------------------------------------------------------------
-- Durable card-booking reservation.
--
-- Stripe creates an external object, so the database cannot allocate its id in
-- the same transaction. Reserve the ride request and a payment_intents row
-- first, then attach Stripe's id in a second, idempotent RPC. A crashed worker
-- therefore leaves a retryable operation instead of an uncoupled PaymentIntent.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.prepare_booking_payment(
  p_user_id UUID,
  p_ride_id UUID,
  p_amount NUMERIC,
  p_num_seats INTEGER,
  p_pickup_location JSONB,
  p_pickup_address TEXT,
  p_dropoff_location JSONB,
  p_dropoff_address TEXT,
  p_booking_signature TEXT,
  p_previous_payment_intent_id TEXT DEFAULT NULL,
  p_previous_payment_intent_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_request public.ride_requests%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_request_found BOOLEAN := FALSE;
  v_intent_found BOOLEAN := FALSE;
  v_orphan_reservation public.payment_intents%ROWTYPE;
  v_orphan_found BOOLEAN := FALSE;
  v_quote JSONB;
  v_expected_total NUMERIC;
  v_amount NUMERIC;
  v_signature TEXT := NULLIF(trim(p_booking_signature), '');
  v_previous_id TEXT := NULLIF(trim(p_previous_payment_intent_id), '');
  v_previous_status TEXT := lower(NULLIF(trim(p_previous_payment_intent_status), ''));
  v_status TEXT;
  v_attempt INTEGER := 1;
  v_operation_key TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  IF p_user_id IS NULL OR p_ride_id IS NULL OR v_signature IS NULL
     OR length(v_signature) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BOOKING_RESERVATION');
  END IF;

  IF p_num_seats IS NULL OR p_num_seats < 1 OR p_num_seats > 8
     OR p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BOOKING_AMOUNT_OR_SEATS');
  END IF;
  v_amount := round(p_amount, 2);

  -- Lock the ride before inspecting the request. This serializes preparation
  -- with seat changes and makes the quote/request pair one database decision.
  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;
  IF v_ride.driver_id = p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DRIVER_CANNOT_BOOK_OWN_RIDE');
  END IF;

  v_quote := public.sw_build_booking_quote(
    p_ride_id,
    p_pickup_location,
    p_dropoff_location,
    p_num_seats
  );
  IF COALESCE((v_quote ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_quote ->> 'error', 'PAYMENT_QUOTE_NOT_AVAILABLE')
    );
  END IF;
  v_expected_total := round((v_quote ->> 'total')::NUMERIC, 2);
  IF v_amount IS DISTINCT FROM v_expected_total THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_QUOTE_STALE',
      'expected', v_expected_total,
      'received', v_amount
    );
  END IF;

  SELECT *
    INTO v_request
  FROM public.ride_requests
  WHERE ride_id = p_ride_id
    AND requester_id = p_user_id
  FOR UPDATE;
  v_request_found := FOUND;

  IF v_request_found THEN
    v_status := lower(COALESCE(v_request.status, ''));

    IF v_status IN ('fulfilled', 'confirmed', 'accepted', 'completed') THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_ALREADY_FULFILLED');
    END IF;
    IF v_status NOT IN (
      'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid',
      'canceled', 'cancelled', 'expired'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
    END IF;

    -- An active request is immutable for the duration of its payment attempt.
    -- A canceled/expired request is the only replaceable row, and the Edge
    -- Function must still prove that its previous Stripe PaymentIntent is
    -- canceled before this branch can write a new attempt.
    IF v_status NOT IN ('canceled', 'cancelled', 'expired')
       AND v_request.booking_signature IS NOT NULL
       AND v_request.booking_signature <> v_signature THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
    END IF;
    IF v_status NOT IN ('canceled', 'cancelled', 'expired')
       AND (
         (v_request.amount IS NOT NULL AND round(v_request.amount, 2) <> v_amount)
         OR (v_request.requested_seats IS NOT NULL AND v_request.requested_seats <> p_num_seats)
       ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
    END IF;

    IF v_request.payment_intent_id IS NOT NULL THEN
      -- Never replace or overwrite an active request merely because another
      -- browser made a concurrent call. The Edge Function retrieves this id
      -- from Stripe and only retries this RPC after Stripe says it is canceled.
      IF v_previous_id IS NULL THEN
        SELECT *
          INTO v_intent
        FROM public.payment_intents
        WHERE external_id = v_request.payment_intent_id
        FOR UPDATE;
        v_intent_found := FOUND;

        RETURN jsonb_build_object(
          'success', true,
          'reservation', 'existing',
          'request_id', v_request.id,
          'payment_intent_record_id', CASE WHEN v_intent_found THEN v_intent.id ELSE NULL END,
          'payment_intent_id', v_request.payment_intent_id,
          'operation_key', CASE WHEN v_intent_found THEN v_intent.idempotency_key ELSE NULL END,
          'booking_attempt', CASE WHEN v_intent_found THEN v_intent.booking_attempt ELSE NULL END,
          'amount', v_amount,
          'num_seats', p_num_seats
        );
      END IF;

      IF v_previous_id <> v_request.payment_intent_id
         OR v_previous_status <> 'canceled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'CANCELED_PAYMENT_REPLACEMENT_REQUIRED');
      END IF;

      SELECT *
        INTO v_intent
      FROM public.payment_intents
      WHERE external_id = v_request.payment_intent_id
      FOR UPDATE;
      v_intent_found := FOUND;

      IF v_intent_found
         AND lower(COALESCE(v_intent.financial_status, '')) IN (
           'captured', 'succeeded', 'refunded', 'disputed'
         ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_REPLACEMENT_NOT_ALLOWED');
      END IF;

      IF v_intent_found THEN
        v_attempt := greatest(COALESCE(v_intent.booking_attempt, 1) + 1, 2);
        UPDATE public.payment_intents
        SET financial_status = 'canceled',
            status = 'failed',
            metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
              'replacement_requested_at', NOW(),
              'replacement_reason', 'stripe_payment_intent_canceled'
            ),
            updated_at = NOW()
        WHERE id = v_intent.id;
      ELSE
        SELECT COALESCE(MAX(booking_attempt), 1) + 1
          INTO v_attempt
        FROM public.payment_intents
        WHERE request_id = v_request.id;
      END IF;
    ELSE
      -- A pending request with no attached PaymentIntent may still have a
      -- durable reservation from a worker that crashed between the two Stripe
      -- calls. Reuse that row rather than replacing a concurrent request.
      SELECT *
        INTO v_orphan_reservation
      FROM public.payment_intents
      WHERE request_id = v_request.id
        AND external_id IS NULL
        AND booking_signature = v_signature
      ORDER BY booking_attempt DESC NULLS LAST, created_at DESC
      LIMIT 1
      FOR UPDATE;
      v_orphan_found := FOUND;

      IF v_orphan_found AND v_previous_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'reservation', 'new',
          'request_id', v_request.id,
          'payment_intent_record_id', v_orphan_reservation.id,
          'payment_intent_id', NULL,
          'operation_key', v_orphan_reservation.idempotency_key,
          'booking_attempt', v_orphan_reservation.booking_attempt,
          'amount', v_amount,
          'num_seats', p_num_seats,
          'needs_stripe_create', true
        );
      END IF;

      IF v_request.booking_signature IS NULL
         AND v_status NOT IN ('canceled', 'cancelled', 'expired') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
      END IF;

      IF v_previous_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'CANCELED_PAYMENT_REPLACEMENT_REQUIRED');
      END IF;
      v_attempt := COALESCE((
        SELECT MAX(booking_attempt) + 1
        FROM public.payment_intents
        WHERE request_id = v_request.id
      ), 1);
    END IF;
  ELSE
    IF v_previous_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_REQUEST_NOT_FOUND');
    END IF;
  END IF;

  v_operation_key := format(
    'booking:%s:%s:%s:v%s',
    p_ride_id,
    p_user_id,
    md5(v_signature),
    v_attempt
  );

  IF v_request_found THEN
    UPDATE public.ride_requests
    SET status = 'pending',
        payment_intent_id = NULL,
        amount = v_amount,
        requested_seats = p_num_seats,
        seats_needed = p_num_seats,
        departure_time = v_ride.departure_time,
        pickup_location = p_pickup_location,
        pickup_address = p_pickup_address,
        dropoff_location = p_dropoff_location,
        dropoff_address = p_dropoff_address,
        booking_signature = v_signature
    WHERE id = v_request.id
      AND (
        v_request.payment_intent_id IS NULL
        OR v_request.payment_intent_id = v_previous_id
      );
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
    END IF;
  ELSE
    INSERT INTO public.ride_requests (
      ride_id, requester_id, status, amount, requested_seats, seats_needed,
      departure_time, pickup_location, pickup_address, dropoff_location,
      dropoff_address, booking_signature, payment_intent_id
    ) VALUES (
      p_ride_id, p_user_id, 'pending', v_amount, p_num_seats, p_num_seats,
      v_ride.departure_time, p_pickup_location, p_pickup_address,
      p_dropoff_location, p_dropoff_address, v_signature, NULL
    )
    RETURNING * INTO v_request;
  END IF;

  INSERT INTO public.payment_intents (
    user_id, amount, currency, status, provider, external_id,
    financial_status, metadata, ride_id, request_id, booking_signature,
    idempotency_key, booking_attempt
  ) VALUES (
    p_user_id, v_amount, 'EUR', 'pending', 'stripe', NULL,
    'pending',
    jsonb_build_object(
      'type', 'ride_booking',
      'ride_id', p_ride_id,
      'user_id', p_user_id,
      'request_id', v_request.id,
      'expected_total', v_amount,
      'num_seats', p_num_seats,
      'booking_signature', v_signature,
      'booking_attempt', v_attempt,
      'idempotency_key', v_operation_key
    ),
    p_ride_id, v_request.id, v_signature, v_operation_key, v_attempt
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_intent;

  IF NOT FOUND THEN
    SELECT *
      INTO v_intent
    FROM public.payment_intents
    WHERE idempotency_key = v_operation_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_RESERVATION_NOT_PERSISTED');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation', 'new',
    'request_id', v_request.id,
    'payment_intent_record_id', v_intent.id,
    'payment_intent_id', v_intent.external_id,
    'operation_key', v_intent.idempotency_key,
    'booking_attempt', v_intent.booking_attempt,
    'amount', v_amount,
    'num_seats', p_num_seats,
    'needs_stripe_create', v_intent.external_id IS NULL
  );
END;
$$;

DROP FUNCTION IF EXISTS public.attach_booking_payment_intent(uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.attach_booking_payment_intent(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.attach_booking_payment_intent(
  p_payment_intent_record_id UUID,
  p_stripe_payment_intent_id TEXT,
  p_stripe_amount NUMERIC,
  p_stripe_status TEXT DEFAULT 'requires_payment_method'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_other_id UUID;
  v_captured BOOLEAN := FALSE;
  v_captured_amount NUMERIC;
  v_captured_currency TEXT;
  v_stripe_status TEXT := lower(COALESCE(NULLIF(trim(p_stripe_status), ''), 'requires_payment_method'));
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF p_payment_intent_record_id IS NULL
     OR NULLIF(trim(p_stripe_payment_intent_id), '') IS NULL
     OR p_stripe_amount IS NULL
     OR v_stripe_status NOT IN (
       'requires_payment_method', 'requires_confirmation', 'requires_action',
       'requires_capture', 'processing', 'canceled', 'cancelled', 'succeeded'
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYMENT_INTENT_ATTACHMENT');
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE id = p_payment_intent_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_RESERVATION_NOT_FOUND');
  END IF;
  IF v_intent.ride_id IS NULL OR v_intent.request_id IS NULL
     OR v_intent.booking_signature IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_A_RIDE_BOOKING_RESERVATION');
  END IF;
  IF round(p_stripe_amount, 2) IS DISTINCT FROM round(v_intent.amount, 2) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_AMOUNT_MISMATCH');
  END IF;
  IF v_intent.external_id IS NOT NULL
     AND v_intent.external_id <> trim(p_stripe_payment_intent_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_RESERVATION_ALREADY_ATTACHED');
  END IF;

  SELECT id
    INTO v_other_id
  FROM public.payment_intents
  WHERE external_id = trim(p_stripe_payment_intent_id)
    AND id <> v_intent.id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'STRIPE_PAYMENT_INTENT_ALREADY_LINKED');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.stripe_financial_transitions
    WHERE stripe_id = trim(p_stripe_payment_intent_id)
      AND status IN ('captured', 'succeeded')
  ) INTO v_captured;

  IF v_captured THEN
    -- The webhook can win the race against this attachment and record the
    -- capture while payment_intents.external_id is still NULL. Re-check the
    -- durable Stripe evidence against the reserved amount before marking the
    -- local reservation captured; existence alone is not enough.
    SELECT round(amount, 2), upper(COALESCE(currency, 'EUR'))
      INTO v_captured_amount, v_captured_currency
    FROM public.stripe_financial_transitions
    WHERE stripe_id = trim(p_stripe_payment_intent_id)
      AND status IN ('captured', 'succeeded')
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;

    IF v_captured_amount IS NULL
       OR v_captured_amount IS DISTINCT FROM round(v_intent.amount, 2)
       OR v_captured_currency IS DISTINCT FROM upper(COALESCE(v_intent.currency, 'EUR')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CAPTURED_AMOUNT_MISMATCH');
    END IF;
  END IF;

  UPDATE public.payment_intents
  SET external_id = trim(p_stripe_payment_intent_id),
      status = CASE WHEN v_captured THEN 'completed' WHEN v_stripe_status IN ('canceled', 'cancelled') THEN 'failed' ELSE 'pending' END,
      financial_status = CASE
        WHEN v_captured THEN 'captured'
        WHEN v_stripe_status IN ('canceled', 'cancelled') THEN 'canceled'
        ELSE v_stripe_status
      END,
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'stripe_payment_intent_id', trim(p_stripe_payment_intent_id),
        'stripe_amount', round(p_stripe_amount, 2),
        'attached_at', NOW()
      ),
      updated_at = NOW()
  WHERE id = v_intent.id;

  UPDATE public.ride_requests
  SET payment_intent_id = trim(p_stripe_payment_intent_id)
  WHERE id = v_intent.request_id
    AND (payment_intent_id IS NULL OR payment_intent_id = trim(p_stripe_payment_intent_id));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_REQUEST_CONFLICT');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_intent_record_id', v_intent.id,
    'payment_intent_id', trim(p_stripe_payment_intent_id),
    'captured', v_captured
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment(
  uuid, uuid, numeric, integer, jsonb, text, jsonb, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.attach_booking_payment_intent(uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_booking_payment_intent(uuid, text, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.attach_booking_payment_intent(uuid, text, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.attach_booking_payment_intent(uuid, text, numeric, text) TO service_role;

-- --------------------------------------------------------------------------
-- Ride and request creation: validate price on the server, not only in UI
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb,
  boolean, boolean, text[], text, jsonb, jsonb
);
DROP FUNCTION IF EXISTS public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
);
DROP FUNCTION IF EXISTS public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb
);

CREATE OR REPLACE FUNCTION public.create_ride(
  p_origin JSONB,
  p_destination JSONB,
  p_departure_time TIMESTAMPTZ,
  p_seats INTEGER,
  p_price NUMERIC,
  p_details TEXT DEFAULT '',
  p_distance NUMERIC DEFAULT NULL,
  p_overview_polyline TEXT DEFAULT '',
  p_waypoints JSONB DEFAULT '[]'::JSONB,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride_id UUID;
  v_profile RECORD;
  v_suggested_price NUMERIC;
  v_origin_lat NUMERIC;
  v_origin_lng NUMERIC;
  v_destination_lat NUMERIC;
  v_destination_lng NUMERIC;
  v_geodesic_distance NUMERIC;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_origin IS NULL OR p_destination IS NULL THEN
    RAISE EXCEPTION 'ROUTE_REQUIRED';
  END IF;

  v_origin_lat := public.sw_json_coordinate(p_origin, 'lat');
  v_origin_lng := public.sw_json_coordinate(p_origin, 'lng');
  v_destination_lat := public.sw_json_coordinate(p_destination, 'lat');
  v_destination_lng := public.sw_json_coordinate(p_destination, 'lng');

  IF v_origin_lat IS NULL OR v_origin_lng IS NULL
     OR v_destination_lat IS NULL OR v_destination_lng IS NULL
     OR v_origin_lat NOT BETWEEN -90 AND 90
     OR v_destination_lat NOT BETWEEN -90 AND 90
     OR v_origin_lng NOT BETWEEN -180 AND 180
     OR v_destination_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'INVALID_ROUTE_COORDINATES';
  END IF;

  v_geodesic_distance := public.sw_haversine_km(
    v_origin_lat,
    v_origin_lng,
    v_destination_lat,
    v_destination_lng
  );
  IF p_distance IS NULL OR p_distance <= 0 THEN
    RAISE EXCEPTION 'DISTANCE_REQUIRED';
  END IF;
  IF p_distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
     OR p_distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
    RAISE EXCEPTION 'DISTANCE_OUT_OF_ROUTE_BOUNDS';
  END IF;

  IF p_departure_time IS NULL
     OR p_departure_time < NOW() + INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'DEPARTURE_TOO_SOON';
  END IF;

  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8 THEN
    RAISE EXCEPTION 'INVALID_SEAT_COUNT';
  END IF;

  IF p_price IS NULL OR p_price < 0.50 OR p_price > 300 THEN
    RAISE EXCEPTION 'INVALID_RIDE_PRICE';
  END IF;

  v_suggested_price := public.sw_progressive_price(p_distance);
  IF p_price > v_suggested_price + 0.05 THEN
    RAISE EXCEPTION 'PRICE_ABOVE_SUGGESTED: El precio no puede superar % EUR para % km.',
      v_suggested_price,
      round(p_distance, 2);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id
      INTO v_ride_id
    FROM public.rides
    WHERE idempotency_key = p_idempotency_key;

    IF v_ride_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'rideId', v_ride_id,
        'note', 'duplicate_prevented'
      );
    END IF;
  END IF;

  SELECT full_name, display_name, photo_url
    INTO v_profile
  FROM public.profiles
  WHERE id = v_driver_id;

  INSERT INTO public.rides (
    driver_id,
    driver_display_name,
    driver_photo_url,
    origin,
    destination,
    origin_address,
    destination_address,
    departure_time,
    seats_available,
    total_seats,
    price,
    details,
    distance,
    overview_polyline,
    waypoints,
    status,
    participant_ids,
    idempotency_key
  ) VALUES (
    v_driver_id,
    COALESCE(v_profile.display_name, v_profile.full_name),
    v_profile.photo_url,
    p_origin,
    p_destination,
    p_origin ->> 'address',
    p_destination ->> 'address',
    p_departure_time,
    p_seats,
    p_seats,
    round(p_price, 2),
    left(COALESCE(p_details, ''), 1000),
    round(p_distance, 3),
    p_overview_polyline,
    COALESCE(p_waypoints, '[]'::JSONB),
    'scheduled',
    ARRAY[v_driver_id],
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_ride_id;

  IF v_ride_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id
      INTO v_ride_id
    FROM public.rides
    WHERE idempotency_key = p_idempotency_key;
    IF v_ride_id IS NULL THEN
      RAISE EXCEPTION 'RIDE_IDEMPOTENCY_RETRY_REQUIRED';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'rideId', v_ride_id,
      'note', 'duplicate_prevented'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rideId', v_ride_id,
    'price_per_seat', round(p_price, 2),
    'suggested_price', v_suggested_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_ride(
  jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb, uuid
) TO authenticated;

DROP FUNCTION IF EXISTS public.create_ride_request(
  jsonb, jsonb, timestamptz, integer, numeric, text, boolean, numeric, text
);
DROP FUNCTION IF EXISTS public.create_ride_request(
  jsonb, jsonb, timestamptz, integer, numeric, text, boolean
);

CREATE OR REPLACE FUNCTION public.create_ride_request(
  p_origin JSONB,
  p_destination JSONB,
  p_departure_time TIMESTAMPTZ,
  p_seats_needed INTEGER,
  p_suggested_price NUMERIC,
  p_details TEXT DEFAULT '',
  p_is_women_only BOOLEAN DEFAULT FALSE,
  p_distance NUMERIC DEFAULT NULL,
  p_overview_polyline TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_id UUID := auth.uid();
  v_gender TEXT;
  v_pending_count INTEGER;
  v_suggested_max NUMERIC;
  v_request_id UUID;
  v_geodesic_distance NUMERIC;
BEGIN
  IF v_requester_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_origin IS NULL OR p_destination IS NULL OR p_departure_time IS NULL THEN
    RAISE EXCEPTION 'REQUEST_ROUTE_REQUIRED';
  END IF;

  IF public.sw_json_coordinate(p_origin, 'lat') IS NULL
     OR public.sw_json_coordinate(p_origin, 'lng') IS NULL
     OR public.sw_json_coordinate(p_destination, 'lat') IS NULL
     OR public.sw_json_coordinate(p_destination, 'lng') IS NULL
     OR public.sw_json_coordinate(p_origin, 'lat') NOT BETWEEN -90 AND 90
     OR public.sw_json_coordinate(p_destination, 'lat') NOT BETWEEN -90 AND 90
     OR public.sw_json_coordinate(p_origin, 'lng') NOT BETWEEN -180 AND 180
     OR public.sw_json_coordinate(p_destination, 'lng') NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'INVALID_REQUEST_COORDINATES';
  END IF;

  v_geodesic_distance := public.sw_haversine_km(
    public.sw_json_coordinate(p_origin, 'lat'),
    public.sw_json_coordinate(p_origin, 'lng'),
    public.sw_json_coordinate(p_destination, 'lat'),
    public.sw_json_coordinate(p_destination, 'lng')
  );
  IF p_distance IS NULL OR p_distance <= 0 THEN
    RAISE EXCEPTION 'DISTANCE_REQUIRED';
  END IF;
  IF p_distance < greatest(COALESCE(v_geodesic_distance, 0) * 0.90, 0.10)
     OR p_distance > greatest(COALESCE(v_geodesic_distance, 0) * 3.00, COALESCE(v_geodesic_distance, 0) + 20.00) THEN
    RAISE EXCEPTION 'DISTANCE_OUT_OF_ROUTE_BOUNDS';
  END IF;

  IF p_departure_time < NOW() + INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'DEPARTURE_TOO_SOON';
  END IF;

  IF p_seats_needed IS NULL OR p_seats_needed < 1 OR p_seats_needed > 8 THEN
    RAISE EXCEPTION 'INVALID_SEAT_COUNT';
  END IF;

  IF p_suggested_price IS NULL OR p_suggested_price < 0.50 OR p_suggested_price > 300 THEN
    RAISE EXCEPTION 'INVALID_RIDE_PRICE';
  END IF;

  v_suggested_max := public.sw_progressive_price(p_distance);
  IF p_suggested_price > v_suggested_max + 0.05 THEN
    RAISE EXCEPTION 'PRICE_ABOVE_SUGGESTED: El precio no puede superar % EUR para % km.',
      v_suggested_max,
      round(p_distance, 2);
  END IF;

  SELECT COUNT(*)
    INTO v_pending_count
  FROM public.ride_requests
  WHERE requester_id = v_requester_id
    AND lower(COALESCE(status, '')) = 'pending';

  IF v_pending_count >= 5 THEN
    RAISE EXCEPTION 'PENDING_REQUEST_LIMIT_REACHED';
  END IF;

  SELECT gender
    INTO v_gender
  FROM public.profiles
  WHERE id = v_requester_id;

  IF p_is_women_only AND lower(COALESCE(v_gender, '')) <> 'female' THEN
    RAISE EXCEPTION 'WOMEN_ONLY_REQUEST_NOT_ALLOWED';
  END IF;

  INSERT INTO public.ride_requests (
    requester_id,
    origin,
    destination,
    departure_time,
    seats_needed,
    requested_seats,
    suggested_price,
    note,
    details,
    is_women_only,
    distance,
    overview_polyline,
    status
  ) VALUES (
    v_requester_id,
    p_origin,
    p_destination,
    p_departure_time,
    p_seats_needed,
    p_seats_needed,
    round(p_suggested_price, 2),
    left(COALESCE(p_details, ''), 500),
    left(COALESCE(p_details, ''), 500),
    COALESCE(p_is_women_only, FALSE),
    round(p_distance, 3),
    p_overview_polyline,
    'pending'
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'requestId', v_request_id,
    'price_per_seat', round(p_suggested_price, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ride_request(
  jsonb, jsonb, timestamptz, integer, numeric, text, boolean, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ride_request(
  jsonb, jsonb, timestamptz, integer, numeric, text, boolean, numeric, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_ride_request(
  jsonb, jsonb, timestamptz, integer, numeric, text, boolean, numeric, text
) TO authenticated;

-- --------------------------------------------------------------------------
-- Wallet booking and request matching. p_price remains in the public
-- signature for backwards compatibility, but is deliberately ignored.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric, integer, text, jsonb
);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric, integer
);
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric
);

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
  p_ride_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_location JSONB DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_num_seats INTEGER DEFAULT 1,
  p_dropoff_address TEXT DEFAULT NULL,
  p_dropoff_location JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_quote JSONB;
  v_existing JSONB;
  v_balance NUMERIC;
  v_total NUMERIC;
  v_price_per_seat NUMERIC;
  v_pin TEXT;
  v_passenger JSONB;
  v_tx_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  SELECT passenger
    INTO v_existing
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger
  WHERE lower(COALESCE(
    passenger ->> 'id',
    passenger ->> 'passenger_id',
    passenger ->> 'user_id',
    ''
  )) = lower(v_user_id::TEXT)
    AND lower(COALESCE(passenger ->> 'status', '')) IN (
      'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
      'confirmed_by_pin', 'completed'
    )
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_BOOKED');
  END IF;

  v_quote := public.sw_build_booking_quote(
    p_ride_id,
    p_pickup_location,
    p_dropoff_location,
    p_num_seats
  );

  IF COALESCE((v_quote ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN v_quote;
  END IF;

  v_total := round((v_quote ->> 'total')::NUMERIC, 2);
  v_price_per_seat := (v_quote ->> 'price_per_seat')::NUMERIC;

  SELECT balance
    INTO v_balance
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_balance, 0) < v_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALDO_INSUFICIENTE');
  END IF;

  v_pin := lpad(floor(random() * 9000 + 1000)::INTEGER::TEXT, 4, '0');
  v_passenger := jsonb_build_object(
    'id', v_user_id,
    'status', 'confirmed',
    'pin', v_pin,
    'booked_price', v_price_per_seat,
    'payment_amount', v_total,
    'seats_booked', p_num_seats,
    'num_seats', p_num_seats,
    'payment_method', 'wallet',
    'pickup_address', p_pickup_address,
    'pickup_location', COALESCE(p_pickup_location, v_ride.origin),
    'dropoff_address', p_dropoff_address,
    'dropoff_location', COALESCE(p_dropoff_location, v_ride.destination),
    'booked_at', NOW()
  );

  UPDATE public.wallets
  SET balance = round(COALESCE(balance, 0) - v_total, 2),
      held_balance = round(COALESCE(held_balance, 0) + v_total, 2),
      updated_at = NOW()
  WHERE user_id = v_user_id;

  UPDATE public.rides
  SET passengers = COALESCE(passengers, '[]'::JSONB) || v_passenger,
      participant_ids = CASE
        WHEN participant_ids IS NULL THEN ARRAY[v_user_id]
        WHEN v_user_id = ANY(participant_ids) THEN participant_ids
        ELSE array_append(participant_ids, v_user_id)
      END,
      updated_at = NOW()
  WHERE id = p_ride_id;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    v_user_id,
    -v_total,
    'hold',
    'Reserva de viaje: fondos retenidos (' || p_num_seats || ' plaza(s))',
    p_ride_id
  ) RETURNING id INTO v_tx_id;

  PERFORM public.record_ride_financial_event(
    p_ride_id,
    v_user_id,
    'booking_hold',
    'held',
    v_total,
    0,
    0,
    0,
    'Fondos retenidos para la reserva',
    jsonb_build_object('seats', p_num_seats, 'payment_method', 'wallet'),
    v_tx_id,
    NULL
  );

  IF p_request_id IS NOT NULL THEN
    UPDATE public.ride_requests
    SET status = 'fulfilled',
        matched_ride_id = p_ride_id
    WHERE id = p_request_id
      AND requester_id = v_user_id
      AND (ride_id = p_ride_id OR ride_id IS NULL);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pin', v_pin,
    'total_paid', v_total,
    'price_per_seat', v_price_per_seat,
    'num_seats', p_num_seats,
    'platform_fee_rate', 0.10
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric, integer, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric, integer, text, jsonb
) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_trip_and_pay(
  uuid, uuid, text, jsonb, numeric, integer, text, jsonb
) TO authenticated;

-- Matching a passenger request uses the request stored in the database for
-- route, departure and budget. A driver may offer a lower price (or the
-- documented rounding tolerance above the budget), but the server validates
-- the final value against both the stored request and the progressive tiers.
DROP FUNCTION IF EXISTS public.fulfill_ride_request(
  uuid, jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb
);

CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
  p_request_id UUID,
  p_origin JSONB,
  p_destination JSONB,
  p_departure_time TIMESTAMPTZ,
  p_seats INTEGER,
  p_price NUMERIC,
  p_details TEXT DEFAULT '',
  p_distance NUMERIC DEFAULT NULL,
  p_overview_polyline TEXT DEFAULT NULL,
  p_waypoints JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_request public.ride_requests%ROWTYPE;
  v_ride_result JSONB;
  v_ride_id UUID;
  v_passenger_id UUID;
  v_requested_seats INTEGER;
  v_price NUMERIC;
  v_distance NUMERIC;
  v_balance NUMERIC;
  v_total NUMERIC;
  v_pin TEXT;
  v_passenger JSONB;
  v_tx_id UUID;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_request
  FROM public.ride_requests
  WHERE id = p_request_id
    AND lower(COALESCE(status, '')) = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_AVAILABLE');
  END IF;

  IF v_request.requester_id = v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_FULFILL_OWN_REQUEST');
  END IF;

  v_passenger_id := v_request.requester_id;
  v_requested_seats := COALESCE(v_request.requested_seats, v_request.seats_needed, 1);
  v_price := round(COALESCE(p_price, v_request.suggested_price), 6);

  IF v_request.suggested_price IS NULL
     OR v_request.suggested_price < 0.50
     OR v_price > round(v_request.suggested_price, 6) + 0.05 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRICE_ABOVE_REQUEST_BUDGET');
  END IF;

  v_distance := greatest(
    COALESCE(v_request.distance, 0),
    COALESCE(public.sw_haversine_km(
      public.sw_json_coordinate(v_request.origin, 'lat'),
      public.sw_json_coordinate(v_request.origin, 'lng'),
      public.sw_json_coordinate(v_request.destination, 'lat'),
      public.sw_json_coordinate(v_request.destination, 'lng')
    ), 0),
    0.01
  );

  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8
     OR v_requested_seats < 1 OR v_requested_seats > p_seats THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SEAT_COUNT');
  END IF;

  IF v_price IS NULL OR v_price < 0.50 OR v_price > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RIDE_PRICE');
  END IF;

  IF v_price > public.sw_progressive_price(v_distance) + 0.05 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRICE_ABOVE_SUGGESTED');
  END IF;

  SELECT balance
    INTO v_balance
  FROM public.wallets
  WHERE user_id = v_passenger_id
  FOR UPDATE;

  v_total := round(v_price * v_requested_seats, 2);
  IF NOT FOUND OR COALESCE(v_balance, 0) < v_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALDO_INSUFICIENTE');
  END IF;

  v_ride_result := public.create_ride(
    v_request.origin,
    v_request.destination,
    v_request.departure_time,
    p_seats,
    v_price,
    COALESCE(v_request.note, v_request.details, ''),
    v_distance,
    COALESCE(v_request.overview_polyline, ''),
    '[]'::JSONB,
    p_request_id
  );

  IF COALESCE((v_ride_result ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN v_ride_result;
  END IF;

  v_ride_id := (v_ride_result ->> 'rideId')::UUID;
  v_pin := lpad(floor(random() * 9000 + 1000)::INTEGER::TEXT, 4, '0');
  v_passenger := jsonb_build_object(
    'id', v_passenger_id,
    'status', 'confirmed',
    'pin', v_pin,
    'booked_price', round(v_price, 6),
    'payment_amount', v_total,
    'seats_booked', v_requested_seats,
    'num_seats', v_requested_seats,
    'payment_method', 'wallet',
    'pickup_location', v_request.pickup_location,
    'pickup_address', v_request.pickup_address,
    'dropoff_location', v_request.dropoff_location,
    'dropoff_address', v_request.dropoff_address,
    'booked_at', NOW()
  );

  UPDATE public.wallets
  SET balance = round(COALESCE(balance, 0) - v_total, 2),
      held_balance = round(COALESCE(held_balance, 0) + v_total, 2),
      updated_at = NOW()
  WHERE user_id = v_passenger_id;

  UPDATE public.rides
  SET passengers = COALESCE(passengers, '[]'::JSONB) || v_passenger,
      participant_ids = array_append(COALESCE(participant_ids, ARRAY[v_driver_id]), v_passenger_id),
      updated_at = NOW()
  WHERE id = v_ride_id;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    v_passenger_id,
    -v_total,
    'hold',
    'Reserva aceptada desde solicitud (' || v_requested_seats || ' plaza(s))',
    v_ride_id
  ) RETURNING id INTO v_tx_id;

  PERFORM public.record_ride_financial_event(
    v_ride_id,
    v_passenger_id,
    'booking_hold',
    'held',
    v_total,
    0,
    0,
    0,
    'Fondos retenidos al aceptar la solicitud',
    jsonb_build_object('seats', v_requested_seats, 'payment_method', 'wallet'),
    v_tx_id,
    NULL
  );

  UPDATE public.ride_requests
  SET status = 'fulfilled',
      matched_ride_id = v_ride_id,
      driver_id = v_driver_id
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'rideId', v_ride_id,
    'remaining_seats', p_seats - v_requested_seats,
    'total_paid', v_total,
    'price_per_seat', round(v_price, 6)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_ride_request(
  uuid, jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_ride_request(
  uuid, jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_ride_request(
  uuid, jsonb, jsonb, timestamptz, integer, numeric, text, numeric, text, jsonb
) TO authenticated;

-- --------------------------------------------------------------------------
-- Stripe webhook fulfillment: persist seats and the quoted amount exactly.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fulfill_booking_after_payment(
  p_user_id UUID,
  p_ride_id UUID,
  p_amount NUMERIC,
  p_payment_intent_id TEXT,
  p_wallet_deduction NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_request public.ride_requests%ROWTYPE;
  v_payment_intent public.payment_intents%ROWTYPE;
  v_request_found BOOLEAN := FALSE;
  v_existing JSONB;
  v_request_amount NUMERIC;
  v_captured_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_seats INTEGER;
  v_price_per_seat NUMERIC;
  v_quote JSONB;
  v_quote_total NUMERIC;
  v_pin TEXT;
  v_passenger JSONB;
  v_tx_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF p_user_id IS NULL OR p_ride_id IS NULL OR p_payment_intent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_PAYMENT_DATA');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  SELECT *
    INTO v_request
  FROM public.ride_requests
  WHERE ride_id = p_ride_id
    AND requester_id = p_user_id
    AND lower(COALESCE(status, '')) IN (
      'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid',
      'fulfilled', 'confirmed', 'accepted', 'completed'
    )
    AND (
      payment_intent_id = p_payment_intent_id
      OR payment_intent_id IS NULL
    )
  ORDER BY CASE WHEN payment_intent_id = p_payment_intent_id THEN 0 ELSE 1 END
  LIMIT 1;

  v_request_found := FOUND;
  IF NOT v_request_found THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_REQUEST_NOT_FOUND');
  END IF;

  -- The webhook must first establish a captured amount in SQL. New booking
  -- intents are persisted in payment_intents; older in-flight intents are
  -- accepted only when the webhook has already recorded a captured/succeeded
  -- transition for the same Stripe id.
  SELECT *
    INTO v_payment_intent
  FROM public.payment_intents
  WHERE external_id = p_payment_intent_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment_intent.user_id IS DISTINCT FROM p_user_id
       OR (v_payment_intent.ride_id IS NOT NULL AND v_payment_intent.ride_id IS DISTINCT FROM p_ride_id)
       OR (v_payment_intent.request_id IS NOT NULL AND v_payment_intent.request_id IS DISTINCT FROM v_request.id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_INTENT_BOOKING_MISMATCH');
    END IF;
    IF lower(COALESCE(v_payment_intent.financial_status, '')) NOT IN ('captured', 'succeeded') THEN
      RETURN jsonb_build_object('success', false, 'error', 'STRIPE_PAYMENT_NOT_CAPTURED');
    END IF;
    v_captured_amount := round(v_payment_intent.amount, 2);
  ELSE
    SELECT amount
      INTO v_captured_amount
    FROM public.stripe_financial_transitions
    WHERE stripe_id = p_payment_intent_id
      AND status IN ('captured', 'succeeded')
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'STRIPE_PAYMENT_NOT_CAPTURED');
    END IF;
    v_captured_amount := round(v_captured_amount, 2);
  END IF;

  IF v_captured_amount IS NULL OR v_captured_amount <= 0
     OR round(COALESCE(p_amount, 0), 2) <> v_captured_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_AMOUNT_MISMATCH',
      'expected', v_captured_amount,
      'received', round(COALESCE(p_amount, 0), 2)
    );
  END IF;

  v_request_amount := round(v_request.amount, 2);
  v_seats := COALESCE(v_request.requested_seats, v_request.seats_needed, 1);

  IF v_request_amount IS NULL OR v_request_amount < 0.50 OR v_request_amount > 2400 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_AMOUNT_NOT_STORED');
  END IF;

  IF COALESCE(p_wallet_deduction, 0) <> 0 OR COALESCE(p_wallet_deduction, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_CARD_SPLIT_NOT_SUPPORTED');
  END IF;

  IF v_seats < 1 OR v_seats > 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SEAT_COUNT');
  END IF;

  SELECT passenger
    INTO v_existing
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger
  WHERE lower(COALESCE(
    passenger ->> 'id',
    passenger ->> 'user_id',
    ''
  )) = lower(p_user_id::TEXT)
    AND lower(COALESCE(passenger ->> 'status', '')) IN (
      'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
      'confirmed_by_pin', 'completed'
    )
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF lower(COALESCE(v_existing ->> 'payment_intent_id', '')) = lower(p_payment_intent_id)
       OR lower(COALESCE(v_request.payment_intent_id, '')) = lower(p_payment_intent_id) THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'ALREADY_BOOKED',
        'already_booked', true,
        'total_paid', v_request_amount,
        'num_seats', v_seats
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ALREADY_FULFILLED');
  END IF;

  -- Rebuild the quote on every card fulfillment, including legacy requests
  -- without custom pickup/dropoff fields. The quote helper falls back to the
  -- stored ride endpoints, so the stored amount is never accepted by itself.
  v_quote := public.sw_build_booking_quote(
    p_ride_id,
    v_request.pickup_location,
    v_request.dropoff_location,
    v_seats
  );
  IF COALESCE((v_quote ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_quote ->> 'error', 'PAYMENT_QUOTE_NOT_AVAILABLE')
    );
  END IF;
  v_quote_total := round((v_quote ->> 'total')::NUMERIC, 2);
  IF round(v_quote_total, 2) <> round(v_request_amount, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_QUOTE_STALE',
      'expected', v_quote_total,
      'stored', v_request_amount
    );
  END IF;

  v_paid_amount := round(COALESCE(p_amount, 0) + COALESCE(p_wallet_deduction, 0), 2);
  IF round(v_paid_amount, 2) <> round(v_request_amount, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_AMOUNT_MISMATCH',
      'expected', v_request_amount,
      'received', v_paid_amount
    );
  END IF;

  IF v_ride.status IS DISTINCT FROM 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_SCHEDULED');
  END IF;

  IF v_ride.departure_time IS NULL OR v_ride.departure_time <= NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_ALREADY_DEPARTED');
  END IF;

  IF COALESCE(v_ride.seats_available, 0) < v_seats THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_SEATS_AVAILABLE');
  END IF;

  v_price_per_seat := round(v_request_amount / v_seats, 6);
  v_pin := NULLIF(v_request.pin, '');
  IF v_pin IS NULL OR v_pin !~ '^[0-9]{4,8}$' THEN
    v_pin := lpad(floor(random() * 9000 + 1000)::INTEGER::TEXT, 4, '0');
  END IF;

  v_passenger := jsonb_build_object(
    'id', p_user_id,
    'status', 'confirmed',
    'pin', v_pin,
    'booked_price', v_price_per_seat,
    'payment_amount', v_request_amount,
    'seats_booked', v_seats,
    'num_seats', v_seats,
    'payment_method', 'stripe',
    'payment_intent_id', p_payment_intent_id,
    'booked_at', NOW(),
    'pickup_location', v_request.pickup_location,
    'pickup_address', v_request.pickup_address,
    'dropoff_location', v_request.dropoff_location,
    'dropoff_address', v_request.dropoff_address
  );

  UPDATE public.rides
  SET passengers = COALESCE(passengers, '[]'::JSONB) || v_passenger,
      participant_ids = CASE
        WHEN participant_ids IS NULL THEN ARRAY[p_user_id]
        WHEN p_user_id = ANY(participant_ids) THEN participant_ids
        ELSE array_append(participant_ids, p_user_id)
      END,
      updated_at = NOW()
  WHERE id = p_ride_id;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    p_user_id,
    -v_request_amount,
    'payment',
    'Pago Stripe confirmado: fondos reservados (' || v_seats || ' plaza(s))',
    p_ride_id
  ) RETURNING id INTO v_tx_id;

  PERFORM public.record_ride_financial_event(
    p_ride_id,
    p_user_id,
    'booking_paid',
    'paid',
    v_request_amount,
    0,
    0,
    0,
    'Pago Stripe confirmado',
    jsonb_build_object(
      'payment_intent_id', p_payment_intent_id,
      'seats', v_seats,
      'payment_method', 'stripe'
    ),
    v_tx_id,
    NULL
  );

  UPDATE public.ride_requests
  SET status = 'fulfilled'
  WHERE id = v_request.id;

  UPDATE public.payment_intents
  SET status = 'completed',
      financial_status = 'captured',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'ride_id', p_ride_id,
        'user_id', p_user_id,
        'payment_intent_id', p_payment_intent_id
      ),
      updated_at = NOW()
  WHERE external_id = p_payment_intent_id;

  RETURN jsonb_build_object(
    'success', true,
    'pin', v_pin,
    'total_paid', v_request_amount,
    'price_per_seat', v_price_per_seat,
    'num_seats', v_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_booking_after_payment(uuid, uuid, numeric, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_booking_after_payment(uuid, uuid, numeric, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fulfill_booking_after_payment(uuid, uuid, numeric, text, numeric) TO service_role;

-- The former client-callable confirm_stripe_booking accepted a payment intent
-- id without proving that Stripe had captured it. The webhook is now the only
-- entry point for card fulfillment, so remove the bypass entirely.
DROP FUNCTION IF EXISTS public.confirm_stripe_booking(uuid, text, jsonb, text);

-- --------------------------------------------------------------------------
-- Card payment recovery when fulfillment loses the seat race.
-- The webhook refunds Stripe first, then this idempotent RPC records the
-- external refund and closes the pending request. If the SQL transaction
-- fails, Stripe retries the same idempotency key and this RPC can be retried.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_unfulfillable_booking_refund(uuid, uuid, text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.record_unfulfillable_booking_refund(uuid, uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.record_unfulfillable_booking_refund(
  p_user_id UUID,
  p_ride_id UUID,
  p_payment_intent_id TEXT,
  p_refund_amount NUMERIC,
  p_reason TEXT DEFAULT 'Reserva no disponible después del cobro',
  p_stripe_event_id TEXT DEFAULT NULL,
  p_refund_operation_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_request public.ride_requests%ROWTYPE;
  v_expected_amount NUMERIC;
  v_tx_id UUID;
  v_ledger_id UUID;
  v_status TEXT;
  v_refund_operation public.stripe_refund_operations%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;
  IF p_user_id IS NULL OR p_ride_id IS NULL OR NULLIF(trim(p_payment_intent_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_PAYMENT_DATA');
  END IF;

  IF p_refund_amount IS NULL OR p_refund_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_REFUND_AMOUNT');
  END IF;
  IF NULLIF(trim(p_refund_operation_key), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_REQUIRED');
  END IF;

  -- Serialize recovery with normal fulfillment on the same ride.
  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  SELECT *
    INTO v_request
  FROM public.ride_requests
  WHERE ride_id = p_ride_id
    AND requester_id = p_user_id
    AND payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_REQUEST_NOT_FOUND');
  END IF;

  v_expected_amount := round(COALESCE(v_request.amount, 0), 2);
  IF v_expected_amount < 0.50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_AMOUNT_NOT_STORED');
  END IF;
  IF round(p_refund_amount, 2) <> round(v_expected_amount, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'REFUND_AMOUNT_MISMATCH',
      'expected', v_expected_amount,
      'received', round(p_refund_amount, 2)
    );
  END IF;

  SELECT *
    INTO v_refund_operation
  FROM public.stripe_refund_operations
  WHERE operation_key = trim(p_refund_operation_key)
  FOR UPDATE;

  IF NOT FOUND
     OR v_refund_operation.payment_intent_id IS DISTINCT FROM trim(p_payment_intent_id)
     OR v_refund_operation.ride_id IS DISTINCT FROM p_ride_id
     OR v_refund_operation.passenger_id IS DISTINCT FROM p_user_id
     OR round(v_refund_operation.refund_amount, 2) <> round(v_expected_amount, 2)
     OR v_refund_operation.status NOT IN ('refunded', 'settled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_OPERATION_NOT_SETTLED');
  END IF;

  SELECT id
    INTO v_ledger_id
  FROM public.ride_financial_ledger
  WHERE ride_id = p_ride_id
    AND event_type = 'booking_payment_refund'
    AND metadata ->> 'payment_intent_id' = p_payment_intent_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.stripe_refund_operations
    SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
    WHERE operation_key = trim(p_refund_operation_key);
    UPDATE public.payment_intents
    SET financial_status = 'refunded',
        status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
        updated_at = NOW()
    WHERE external_id = p_payment_intent_id;
    RETURN jsonb_build_object(
      'success', true,
      'already_recorded', true,
      'refund_amount', v_expected_amount,
      'request_id', v_request.id
    );
  END IF;

  v_status := lower(COALESCE(v_request.status, ''));
  IF v_status IN ('fulfilled', 'completed', 'accepted', 'confirmed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ALREADY_FULFILLED');
  END IF;
  -- A late Stripe success can arrive after the request was canceled or
  -- expired locally. That terminal state is precisely why the full external
  -- charge must be refunded, so it is not a reason to reject recovery.

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    p_user_id,
    v_expected_amount,
    'refund',
    left(COALESCE(p_reason, 'Reserva no disponible después del cobro'), 500),
    p_ride_id
  ) RETURNING id INTO v_tx_id;

  PERFORM public.record_ride_financial_event(
    p_ride_id,
    p_user_id,
    'booking_payment_refund',
    'refunded',
    v_expected_amount,
    0,
    0,
    v_expected_amount,
    left(COALESCE(p_reason, 'Reserva no disponible después del cobro'), 500),
    jsonb_build_object(
      'payment_intent_id', p_payment_intent_id,
      'stripe_event_id', p_stripe_event_id,
      'refund_operation_key', trim(p_refund_operation_key),
      'stripe_refund_id', v_refund_operation.stripe_refund_id,
      'recovery', true
    ),
    v_tx_id,
    NULL
  );

  UPDATE public.ride_requests
  SET status = 'cancelled'
  WHERE id = v_request.id;

  UPDATE public.payment_intents
  SET financial_status = 'refunded',
      status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'ride_id', p_ride_id,
        'user_id', p_user_id,
        'refund_operation_key', trim(p_refund_operation_key),
        'stripe_refund_id', v_refund_operation.stripe_refund_id
      ),
      updated_at = NOW()
  WHERE external_id = p_payment_intent_id;

  UPDATE public.stripe_refund_operations
  SET status = 'settled', settled_at = NOW(), updated_at = NOW()
  WHERE operation_key = trim(p_refund_operation_key)
    AND status IN ('refunded', 'settled');

  RETURN jsonb_build_object(
    'success', true,
    'refund_amount', v_expected_amount,
    'request_id', v_request.id,
    'status', 'cancelled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_unfulfillable_booking_refund(uuid, uuid, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_unfulfillable_booking_refund(uuid, uuid, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_unfulfillable_booking_refund(uuid, uuid, text, numeric, text, text, text) TO service_role;

-- --------------------------------------------------------------------------
-- Shared 90/10 settlement. A completed passenger is already settled by the
-- per-stop function and is deliberately skipped here to prevent double pay.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_passenger_id_text TEXT;
  v_passenger_id UUID;
  v_status TEXT;
  v_payment_method TEXT;
  v_payment_intent_id TEXT;
  v_captured_amount NUMERIC;
  v_price_text TEXT;
  v_seats_text TEXT;
  v_price NUMERIC;
  v_seats INTEGER;
  v_subtotal NUMERIC;
  v_net_payout NUMERIC;
  v_fee NUMERIC;
  v_total_payout NUMERIC := 0;
  v_platform_fee_total NUMERIC := 0;
  v_driver_wallet_updated INTEGER;
  v_passenger_wallet_updated INTEGER;
  v_treasury_wallet_updated INTEGER;
  v_tx_id UUID;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
    AND driver_id = v_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND_OR_UNAUTHORIZED');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', 'completed',
      'ride_id', p_ride_id,
      'payout', 0,
      'fee', 0
    );
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('active', 'in_progress') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RIDE_NOT_ACTIVE',
      'status', v_ride.status
    );
  END IF;

  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    v_status := lower(trim(COALESCE(v_passenger ->> 'status', 'confirmed')));

    IF v_status IN ('cancelled', 'canceled', 'rejected', 'no_show', 'completed') THEN
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
      CONTINUE;
    END IF;

    v_passenger_id_text := NULLIF(trim(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )), '');

    IF v_passenger_id_text IS NULL THEN
      RAISE EXCEPTION 'PASSENGER_ID_REQUIRED_FOR_SETTLEMENT';
    END IF;

    BEGIN
      v_passenger_id := v_passenger_id_text::UUID;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_ID_FOR_SETTLEMENT';
    END;

    v_price_text := trim(COALESCE(
      v_passenger ->> 'booked_price',
      v_passenger ->> 'price_per_seat',
      v_passenger ->> 'price',
      ''
    ));
    v_seats_text := trim(COALESCE(
      v_passenger ->> 'seats_booked',
      v_passenger ->> 'num_seats',
      v_passenger ->> 'seats',
      v_passenger ->> 'seat_count',
      '1'
    ));

    IF v_price_text !~ '^[0-9]+([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_SETTLEMENT';
    END IF;
    IF v_seats_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_SETTLEMENT';
    END IF;

    v_price := round(v_price_text::NUMERIC, 6);
    IF v_price < 0.50 OR v_price > 300 THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_SETTLEMENT';
    END IF;
    v_seats := v_seats_text::INTEGER;
    IF v_seats < 1 OR v_seats > 8 THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_SETTLEMENT';
    END IF;
    IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
       AND trim(v_passenger ->> 'payment_amount') !~ '^[0-9]+([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_SETTLEMENT';
    END IF;
    IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
       AND round((v_passenger ->> 'payment_amount')::NUMERIC, 2) <> round(v_price * v_seats, 2) THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH_FOR_SETTLEMENT';
    END IF;
    v_subtotal := round(v_price * v_seats, 2);
    IF v_subtotal < 0.50 OR v_subtotal > 2400 THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_SETTLEMENT';
    END IF;
    v_payment_method := lower(COALESCE(v_passenger ->> 'payment_method', 'wallet'));
    v_payment_intent_id := NULLIF(trim(v_passenger ->> 'payment_intent_id'), '');

    IF v_status IN ('verified', 'on_board', 'confirmed_by_pin')
       AND (v_payment_method IN ('stripe', 'card', 'credit_card') OR v_payment_intent_id IS NOT NULL) THEN
      v_captured_amount := public.sw_captured_payment_amount(v_payment_intent_id);
      IF v_captured_amount IS NULL OR round(v_captured_amount, 2) <> round(v_subtotal, 2) THEN
        RAISE EXCEPTION 'STRIPE_PAYMENT_NOT_CAPTURED_FOR_SETTLEMENT';
      END IF;
    END IF;

    IF v_status IN ('verified', 'on_board', 'confirmed_by_pin') THEN
      v_fee := round(v_subtotal * 0.10, 2);
      v_net_payout := round(v_subtotal - v_fee, 2);

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_net_payout, 2),
          updated_at = NOW()
      WHERE user_id = v_driver_id;
      GET DIAGNOSTICS v_driver_wallet_updated = ROW_COUNT;
      IF v_driver_wallet_updated <> 1 THEN
        RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
      END IF;

      IF v_payment_method NOT IN ('stripe', 'card', 'credit_card')
         AND NULLIF(v_passenger ->> 'payment_intent_id', '') IS NULL THEN
        UPDATE public.wallets
        SET held_balance = round(COALESCE(held_balance, 0) - v_subtotal, 2),
            updated_at = NOW()
        WHERE user_id = v_passenger_id
          AND COALESCE(held_balance, 0) >= v_subtotal;
        GET DIAGNOSTICS v_passenger_wallet_updated = ROW_COUNT;
        IF v_passenger_wallet_updated <> 1 THEN
          RAISE EXCEPTION 'PASSENGER_WALLET_MISSING_OR_HOLD_MISMATCH';
        END IF;
      END IF;

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_fee, 2),
          updated_at = NOW()
      WHERE user_id = '00000000-0000-0000-0000-000000000000';
      GET DIAGNOSTICS v_treasury_wallet_updated = ROW_COUNT;
      IF v_treasury_wallet_updated <> 1 THEN
        RAISE EXCEPTION 'TREASURY_WALLET_MISSING';
      END IF;

      INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
      ) VALUES (
        v_driver_id,
        v_net_payout,
        'earning',
        p_ride_id,
        'Liquidación conductor (90% de ' || v_subtotal || ' EUR)'
      ) RETURNING id INTO v_tx_id;

      INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_fee,
        'fee',
        p_ride_id,
        'Comisión plataforma (10% de ' || v_subtotal || ' EUR)'
      );

      PERFORM public.record_ride_financial_event(
        p_ride_id,
        v_passenger_id,
        'ride_settlement',
        'settled',
        v_subtotal,
        v_fee,
        v_net_payout,
        0,
        'Liquidación del trayecto',
        jsonb_build_object(
          'commission_rate', 0.10,
          'driver_rate', 0.90,
          'payment_method', v_payment_method,
          'seats', v_seats
        ),
        v_tx_id,
        NULL
      );

      v_total_payout := v_total_payout + v_net_payout;
      v_platform_fee_total := v_platform_fee_total + v_fee;
      v_new_passengers := v_new_passengers || jsonb_build_array(
        v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW())
      );
    ELSIF v_status IN ('confirmed', 'accepted', 'pending_boarding') THEN
      IF v_payment_method IN ('stripe', 'card', 'credit_card')
       OR NULLIF(v_passenger ->> 'payment_intent_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'UNRESOLVED_STRIPE_BOOKING';
      END IF;

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_subtotal, 2),
          held_balance = round(COALESCE(held_balance, 0) - v_subtotal, 2),
          updated_at = NOW()
      WHERE user_id = v_passenger_id
        AND COALESCE(held_balance, 0) >= v_subtotal;
      GET DIAGNOSTICS v_passenger_wallet_updated = ROW_COUNT;
      IF v_passenger_wallet_updated <> 1 THEN
        RAISE EXCEPTION 'PASSENGER_WALLET_MISSING_OR_HOLD_MISMATCH';
      END IF;

      INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
      ) VALUES (
        v_passenger_id,
        v_subtotal,
        'refund',
        p_ride_id,
        'Reembolso: pasajero no verificado al finalizar'
      );

      PERFORM public.record_ride_financial_event(
        p_ride_id,
        v_passenger_id,
        'refund',
        'refunded',
        0,
        0,
        0,
        v_subtotal,
        'Reembolso por pasajero no verificado',
        jsonb_build_object('payment_method', v_payment_method),
        NULL,
        NULL
      );

      v_new_passengers := v_new_passengers || jsonb_build_array(
        v_passenger || jsonb_build_object('status', 'cancelled', 'refund_amount', v_subtotal)
      );
    ELSE
      RAISE EXCEPTION 'UNSUPPORTED_PASSENGER_STATUS_FOR_SETTLEMENT';
    END IF;
  END LOOP;

  UPDATE public.rides
  SET passengers = v_new_passengers,
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_ride_id
    AND status IN ('active', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RIDE_CHANGED_DURING_SETTLEMENT';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'ride_id', p_ride_id,
    'payout', round(v_total_payout, 2),
    'fee', round(v_platform_fee_total, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_ride(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ride(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_ride(uuid) TO authenticated;

-- Per-stop settlement follows the same 90/10 arithmetic and marks the
-- passenger completed so complete_ride cannot pay that passenger twice.
CREATE OR REPLACE FUNCTION public.complete_passenger_dropoff(
  p_ride_id UUID,
  p_passenger_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_found BOOLEAN := FALSE;
  v_status TEXT;
  v_payment_method TEXT;
  v_payment_intent_id TEXT;
  v_captured_amount NUMERIC;
  v_price NUMERIC;
  v_seats INTEGER;
  v_subtotal NUMERIC;
  v_net_payout NUMERIC;
  v_fee NUMERIC;
  v_driver_wallet_updated INTEGER;
  v_passenger_wallet_updated INTEGER;
  v_treasury_wallet_updated INTEGER;
  v_tx_id UUID;
  v_already_settled BOOLEAN := FALSE;
BEGIN
  IF v_driver_id IS NULL OR p_passenger_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND OR v_ride.driver_id IS DISTINCT FROM v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_ACTIVE_OR_UNAUTHORIZED');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('active', 'in_progress') THEN
    IF lower(COALESCE(v_ride.status, '')) = 'completed'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger
         WHERE lower(COALESCE(
           passenger ->> 'id',
           passenger ->> 'passenger_id',
           passenger ->> 'user_id',
           ''
         )) = lower(p_passenger_id::TEXT)
           AND lower(COALESCE(passenger ->> 'status', '')) = 'completed'
       ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_settled', true,
        'ride_id', p_ride_id,
        'passenger_id', p_passenger_id,
        'payout', 0,
        'fee', 0
      );
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_ACTIVE_OR_UNAUTHORIZED');
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
    )) = lower(p_passenger_id::TEXT) THEN
      v_found := TRUE;
      v_status := lower(trim(COALESCE(v_passenger ->> 'status', 'confirmed')));

      IF v_status IN ('cancelled', 'canceled', 'rejected', 'no_show', 'completed') THEN
        IF v_status = 'completed' THEN
          v_already_settled := TRUE;
        END IF;
        v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
        CONTINUE;
      END IF;

      IF v_status NOT IN ('verified', 'on_board', 'confirmed_by_pin') THEN
        RAISE EXCEPTION 'UNSUPPORTED_PASSENGER_STATUS_FOR_DROPOFF';
      END IF;

      IF trim(COALESCE(v_passenger ->> 'booked_price', '')) !~ '^[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_DROPOFF';
      END IF;
      IF trim(COALESCE(
        v_passenger ->> 'seats_booked',
        v_passenger ->> 'num_seats',
        v_passenger ->> 'seats',
        '1'
      )) !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_DROPOFF';
      END IF;

      v_price := round((v_passenger ->> 'booked_price')::NUMERIC, 6);
      IF v_price < 0.50 OR v_price > 300 THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_DROPOFF';
      END IF;
      v_seats := COALESCE(
        NULLIF(v_passenger ->> 'seats_booked', '')::INTEGER,
        NULLIF(v_passenger ->> 'num_seats', '')::INTEGER,
        NULLIF(v_passenger ->> 'seats', '')::INTEGER,
        1
      );
      IF v_seats < 1 OR v_seats > 8 THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_DROPOFF';
      END IF;
      IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
         AND trim(v_passenger ->> 'payment_amount') !~ '^[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_DROPOFF';
      END IF;

      IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
         AND round((v_passenger ->> 'payment_amount')::NUMERIC, 2) <> round(v_price * v_seats, 2) THEN
        RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH_FOR_DROPOFF';
      END IF;
      v_subtotal := round(v_price * v_seats, 2);
      IF v_subtotal < 0.50 OR v_subtotal > 2400 THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_DROPOFF';
      END IF;
      v_payment_method := lower(COALESCE(v_passenger ->> 'payment_method', 'wallet'));
      v_payment_intent_id := NULLIF(trim(v_passenger ->> 'payment_intent_id'), '');

      IF v_payment_method IN ('stripe', 'card', 'credit_card') OR v_payment_intent_id IS NOT NULL THEN
        v_captured_amount := public.sw_captured_payment_amount(v_payment_intent_id);
        IF v_captured_amount IS NULL OR round(v_captured_amount, 2) <> round(v_subtotal, 2) THEN
          RAISE EXCEPTION 'STRIPE_PAYMENT_NOT_CAPTURED_FOR_DROPOFF';
        END IF;
      END IF;

      v_fee := round(v_subtotal * 0.10, 2);
      v_net_payout := round(v_subtotal - v_fee, 2);

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_net_payout, 2),
          updated_at = NOW()
      WHERE user_id = v_driver_id;
      GET DIAGNOSTICS v_driver_wallet_updated = ROW_COUNT;
      IF v_driver_wallet_updated <> 1 THEN
        RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
      END IF;

      IF v_payment_method NOT IN ('stripe', 'card', 'credit_card')
         AND NULLIF(v_passenger ->> 'payment_intent_id', '') IS NULL THEN
        UPDATE public.wallets
        SET held_balance = round(COALESCE(held_balance, 0) - v_subtotal, 2),
            updated_at = NOW()
        WHERE user_id = p_passenger_id
          AND COALESCE(held_balance, 0) >= v_subtotal;
        GET DIAGNOSTICS v_passenger_wallet_updated = ROW_COUNT;
        IF v_passenger_wallet_updated <> 1 THEN
          RAISE EXCEPTION 'PASSENGER_WALLET_MISSING_OR_HOLD_MISMATCH';
        END IF;
      END IF;

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_fee, 2),
          updated_at = NOW()
      WHERE user_id = '00000000-0000-0000-0000-000000000000';
      GET DIAGNOSTICS v_treasury_wallet_updated = ROW_COUNT;
      IF v_treasury_wallet_updated <> 1 THEN
        RAISE EXCEPTION 'TREASURY_WALLET_MISSING';
      END IF;

      INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
      ) VALUES (
        v_driver_id,
        v_net_payout,
        'earning',
        p_ride_id,
        'Liquidación de parada (90% de ' || v_subtotal || ' EUR)'
      ) RETURNING id INTO v_tx_id;

      INSERT INTO public.transactions (
        user_id, amount, type, related_ride_id, description
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_fee,
        'fee',
        p_ride_id,
        'Comisión de parada (10% de ' || v_subtotal || ' EUR)'
      );

      PERFORM public.record_ride_financial_event(
        p_ride_id,
        p_passenger_id,
        'ride_settlement',
        'settled',
        v_subtotal,
        v_fee,
        v_net_payout,
        0,
        'Liquidación de parada',
        jsonb_build_object('commission_rate', 0.10, 'driver_rate', 0.90, 'seats', v_seats),
        v_tx_id,
        NULL
      );

      v_new_passengers := v_new_passengers || jsonb_build_array(
        v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW())
      );
    ELSE
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('success', false, 'error', 'PASSENGER_NOT_FOUND');
  END IF;

  IF v_already_settled THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_settled', true,
      'ride_id', p_ride_id,
      'passenger_id', p_passenger_id,
      'payout', 0,
      'fee', 0
    );
  END IF;

  UPDATE public.rides
  SET passengers = v_new_passengers,
      status = CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_new_passengers) AS passenger
          WHERE lower(COALESCE(passenger ->> 'status', '')) IN (
            'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin'
          )
        ) THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_new_passengers) AS passenger
          WHERE lower(COALESCE(passenger ->> 'status', '')) IN (
            'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin'
          )
        ) THEN NOW()
        ELSE completed_at
      END,
      updated_at = NOW()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'passenger_id', p_passenger_id,
    'payout', v_net_payout,
    'fee', v_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_passenger_dropoff(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_passenger_dropoff(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_passenger_dropoff(uuid, uuid) TO authenticated;

-- --------------------------------------------------------------------------
-- Seat integrity trigger: seats_booked is a first-class seat field.
-- --------------------------------------------------------------------------

-- Keep the historical repair helper aligned with the trigger below. The
-- earlier seat migration omitted on_board and seats_booked, which meant a
-- repair could calculate a different available-seat count than a normal write.
CREATE OR REPLACE FUNCTION public.ride_active_seat_count(p_passengers JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_passenger JSONB;
  v_status TEXT;
  v_seats_text TEXT;
  v_seats INTEGER;
  v_occupied INTEGER := 0;
BEGIN
  IF p_passengers IS NULL THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_passengers) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PASSENGERS_PAYLOAD';
  END IF;

  FOR v_passenger IN
    SELECT value FROM jsonb_array_elements(p_passengers)
  LOOP
    v_status := lower(trim(COALESCE(v_passenger ->> 'status', 'confirmed')));
    IF v_status IN (
      'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
      'confirmed_by_pin', 'completed'
    ) THEN
      v_seats_text := trim(COALESCE(
        v_passenger ->> 'seats_booked',
        v_passenger ->> 'num_seats',
        v_passenger ->> 'seats',
        v_passenger ->> 'seat_count',
        '1'
      ));
      IF v_seats_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS';
      END IF;
      v_seats := v_seats_text::INTEGER;
      IF v_seats < 1 OR v_seats > 8 THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS';
      END IF;
      v_occupied := v_occupied + v_seats;
    END IF;
  END LOOP;

  RETURN v_occupied;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ride_booking_seat_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_passengers JSONB := COALESCE(NEW.passengers, '[]'::JSONB);
  v_passenger JSONB;
  v_passenger_id TEXT;
  v_status TEXT;
  v_seats_text TEXT;
  v_seats INTEGER;
  v_occupied INTEGER := 0;
  v_total INTEGER := COALESCE(NEW.total_seats, 0);
  v_seen JSONB := '{}'::JSONB;
  v_active BOOLEAN;
BEGIN
  IF jsonb_typeof(v_passengers) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PASSENGERS_PAYLOAD';
  END IF;

  IF v_total < 0 THEN
    RAISE EXCEPTION 'INVALID_TOTAL_SEATS';
  END IF;

  FOR v_passenger IN
    SELECT value FROM jsonb_array_elements(v_passengers)
  LOOP
    v_passenger_id := lower(trim(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )));
    v_status := lower(trim(COALESCE(v_passenger ->> 'status', 'confirmed')));
    v_active := v_status IN (
      'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
      'confirmed_by_pin', 'completed'
    );

    IF v_active AND v_passenger_id = '' THEN
      RAISE EXCEPTION 'PASSENGER_ID_REQUIRED';
    END IF;

    IF v_active AND NEW.driver_id IS NOT NULL
       AND v_passenger_id = lower(NEW.driver_id::TEXT) THEN
      RAISE EXCEPTION 'DRIVER_CANNOT_BOOK_OWN_RIDE';
    END IF;

    IF v_active THEN
      IF v_seen ? v_passenger_id THEN
        RAISE EXCEPTION 'DUPLICATE_ACTIVE_PASSENGER';
      END IF;
      v_seen := v_seen || jsonb_build_object(v_passenger_id, TRUE);

      v_seats_text := trim(COALESCE(
        v_passenger ->> 'seats_booked',
        v_passenger ->> 'num_seats',
        v_passenger ->> 'seats',
        v_passenger ->> 'seat_count',
        '1'
      ));
      IF v_seats_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS';
      END IF;
      v_seats := v_seats_text::INTEGER;
      IF v_seats < 1 OR v_seats > 8 THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS';
      END IF;
      v_occupied := v_occupied + v_seats;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      v_total := greatest(
        COALESCE(OLD.total_seats, 0),
        COALESCE(OLD.seats_available, 0) + v_occupied,
        COALESCE(NEW.seats_available, 0) + v_occupied
      );
    ELSE
      v_total := greatest(COALESCE(NEW.seats_available, 0) + v_occupied, 1);
    END IF;
    NEW.total_seats := v_total;
  END IF;

  IF v_occupied > v_total THEN
    RAISE EXCEPTION 'RIDE_OVERBOOKED';
  END IF;

  NEW.seats_available := greatest(v_total - v_occupied, 0);
  RETURN NEW;
END;
$$;

-- The trigger created by the seat-integrity migration already points to this
-- function. Recreating it makes fresh and upgraded projects identical.
DROP TRIGGER IF EXISTS trg_enforce_ride_booking_seat_integrity ON public.rides;
CREATE TRIGGER trg_enforce_ride_booking_seat_integrity
BEFORE INSERT OR UPDATE OF passengers, seats_available, total_seats, driver_id
ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ride_booking_seat_integrity();

-- --------------------------------------------------------------------------
-- Passenger cancellation (wallet and card paths share one state transition)
-- --------------------------------------------------------------------------

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

-- --------------------------------------------------------------------------
-- Driver cancellation. Card passengers must provide an external refund map.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(
  p_ride_id UUID,
  p_reason TEXT DEFAULT 'Cancelación operativa',
  p_external_refunds JSONB DEFAULT '{}'::JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role(), '') = 'service_role';
  v_ride public.rides%ROWTYPE;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_passenger_id_text TEXT;
  v_passenger_id UUID;
  v_status TEXT;
  v_payment_method TEXT;
  v_price NUMERIC;
  v_seats INTEGER;
  v_total_paid NUMERIC;
  v_external_refund NUMERIC;
  v_refund_operation_key TEXT;
  v_refund_operation public.stripe_refund_operations%ROWTYPE;
  v_active_passengers INTEGER := 0;
  v_active_passenger_index INTEGER := 0;
  v_compensation_per_passenger NUMERIC := 0;
  v_compensation_for_passenger NUMERIC := 0;
  v_compensation_allocated NUMERIC := 0;
  v_driver_compensation_total NUMERIC := 0;
  v_platform_penalty NUMERIC := 0;
  v_penalty NUMERIC := 0;
  v_hours NUMERIC;
  v_new_trust NUMERIC;
  v_new_rating NUMERIC;
  v_driver_wallet_updated INTEGER;
  v_treasury_wallet_updated INTEGER;
BEGIN
  IF NOT v_is_service_role THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  v_driver_id := CASE
    WHEN v_is_service_role THEN COALESCE(p_actor_id, auth.uid())
    ELSE auth.uid()
  END;

  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;
  IF v_ride.driver_id <> v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DRIVER_NOT_AUTHORIZED');
  END IF;
  IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress') THEN
    IF lower(COALESCE(v_ride.status, '')) = 'cancelled' THEN
      RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'status', 'cancelled');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_CANNOT_BE_CANCELLED');
  END IF;

  SELECT COUNT(*)
    INTO v_active_passengers
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger
  WHERE lower(COALESCE(passenger ->> 'status', '')) IN (
    'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin'
  );

  v_hours := EXTRACT(EPOCH FROM (v_ride.departure_time - NOW())) / 3600;
  IF v_hours < 2 THEN
    v_penalty := 5.00;
  ELSIF v_hours < 24 THEN
    v_penalty := 2.00;
  ELSE
    v_penalty := 0.00;
  END IF;

  IF v_active_passengers > 0 THEN
    -- Allocate exactly half of the driver penalty to passengers. The last
    -- passenger receives the cent remainder so a three-way split of 2.50 EUR
    -- is 0.83 + 0.83 + 0.84 rather than 2.49 EUR.
    v_driver_compensation_total := round(v_penalty * 0.50, 2);
    v_compensation_per_passenger := round(v_driver_compensation_total / v_active_passengers, 2);
    v_platform_penalty := round(v_penalty - v_driver_compensation_total, 2);
  ELSE
    v_driver_compensation_total := 0;
    v_platform_penalty := v_penalty;
  END IF;

  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    v_status := lower(trim(COALESCE(v_passenger ->> 'status', 'confirmed')));

    IF v_status IN ('cancelled', 'canceled', 'rejected', 'no_show', 'completed') THEN
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
      CONTINUE;
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

    BEGIN
      v_passenger_id := v_passenger_id_text::UUID;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_PASSENGER_ID_FOR_CANCELLATION';
    END;

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
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH_FOR_DRIVER_CANCELLATION';
    END IF;
    v_total_paid := round(v_price * v_seats, 2);
    IF v_total_paid < 0.50 OR v_total_paid > 2400 THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_CANCELLATION';
    END IF;
    v_payment_method := lower(COALESCE(v_passenger ->> 'payment_method', 'wallet'));

    IF v_penalty > 0 THEN
      v_active_passenger_index := v_active_passenger_index + 1;
      v_compensation_for_passenger := CASE
        WHEN v_active_passenger_index = v_active_passengers
        THEN round(v_driver_compensation_total - v_compensation_allocated, 2)
        ELSE v_compensation_per_passenger
      END;
      v_compensation_allocated := round(v_compensation_allocated + v_compensation_for_passenger, 2);
    ELSE
      v_compensation_for_passenger := 0;
    END IF;

    IF v_payment_method IN ('stripe', 'card', 'credit_card')
       OR NULLIF(v_passenger ->> 'payment_intent_id', '') IS NOT NULL THEN
      IF NULLIF(trim(v_passenger ->> 'payment_intent_id'), '') IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_INTENT_REQUIRED_FOR_DRIVER_CANCELLATION';
      END IF;
      IF jsonb_typeof(p_external_refunds -> (v_passenger_id::TEXT)) <> 'object' THEN
        RAISE EXCEPTION 'REFUND_OPERATION_REQUIRED_FOR_DRIVER_CANCELLATION';
      END IF;
      v_refund_operation_key := NULLIF(
        trim(p_external_refunds -> (v_passenger_id::TEXT) ->> 'operation_key'),
        ''
      );
      IF v_refund_operation_key IS NULL THEN
        RAISE EXCEPTION 'REFUND_OPERATION_REQUIRED_FOR_DRIVER_CANCELLATION';
      END IF;

      SELECT *
        INTO v_refund_operation
      FROM public.stripe_refund_operations
      WHERE operation_key = v_refund_operation_key
      FOR UPDATE;

      IF NOT FOUND
         OR v_refund_operation.payment_intent_id IS DISTINCT FROM trim(v_passenger ->> 'payment_intent_id')
         OR v_refund_operation.ride_id IS DISTINCT FROM p_ride_id
         OR v_refund_operation.passenger_id IS DISTINCT FROM v_passenger_id
         OR round(v_refund_operation.refund_amount, 2) <> round(v_total_paid, 2)
         OR v_refund_operation.status NOT IN ('refunded', 'settled') THEN
        RAISE EXCEPTION 'REFUND_OPERATION_INVALID_FOR_DRIVER_CANCELLATION';
      END IF;
      v_external_refund := round(v_refund_operation.refund_amount, 2);

      INSERT INTO public.transactions (
        user_id, amount, type, description, related_ride_id
      ) VALUES (
        v_passenger_id,
        v_total_paid,
        'refund',
        'Reembolso Stripe: cancelación del conductor',
        p_ride_id
      );
    ELSE
      INSERT INTO public.wallets (user_id, balance, held_balance)
      VALUES (v_passenger_id, 0, 0)
      ON CONFLICT (user_id) DO NOTHING;

      UPDATE public.wallets
      SET held_balance = round(COALESCE(held_balance, 0) - v_total_paid, 2),
          balance = round(COALESCE(balance, 0) + v_total_paid, 2),
          updated_at = NOW()
      WHERE user_id = v_passenger_id
        AND COALESCE(held_balance, 0) >= v_total_paid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PASSENGER_WALLET_MISSING_OR_HOLD_MISMATCH';
      END IF;

      INSERT INTO public.transactions (
        user_id, amount, type, description, related_ride_id
      ) VALUES (
        v_passenger_id,
        v_total_paid,
        'refund',
        'Reembolso total: cancelación del conductor',
        p_ride_id
      );
    END IF;

    IF v_total_paid > 0 THEN
      PERFORM public.record_ride_financial_event(
        p_ride_id,
        v_passenger_id,
        'driver_cancellation_refund',
        'refunded',
        v_total_paid,
        0,
        0,
        v_total_paid,
        'Reembolso total por cancelación del conductor',
        jsonb_build_object(
          'payment_method', v_payment_method,
          'seats', v_seats,
          'refund_operation_key', CASE
            WHEN v_payment_method IN ('stripe', 'card', 'credit_card')
              OR NULLIF(v_passenger ->> 'payment_intent_id', '') IS NOT NULL
            THEN v_refund_operation_key
            ELSE NULL
          END,
          'stripe_refund_id', CASE
            WHEN v_payment_method IN ('stripe', 'card', 'credit_card')
              OR NULLIF(v_passenger ->> 'payment_intent_id', '') IS NOT NULL
            THEN v_refund_operation.stripe_refund_id
            ELSE NULL
          END
        ),
        NULL,
        NULL
      );
    END IF;

    IF v_refund_operation_key IS NOT NULL THEN
      UPDATE public.stripe_refund_operations
      SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
      WHERE operation_key = v_refund_operation_key
        AND status IN ('refunded', 'settled');

      UPDATE public.payment_intents
      SET financial_status = 'refunded',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'ride_id', p_ride_id,
            'user_id', v_passenger_id,
            'refund_amount', v_total_paid,
            'refund_operation_key', v_refund_operation_key,
            'stripe_refund_id', v_refund_operation.stripe_refund_id
          ),
          updated_at = NOW()
      WHERE external_id = trim(v_passenger ->> 'payment_intent_id');
    END IF;
    v_refund_operation_key := NULL;

    IF v_compensation_for_passenger > 0 THEN
      INSERT INTO public.wallets (user_id, balance, held_balance)
      VALUES (v_passenger_id, 0, 0)
      ON CONFLICT (user_id) DO NOTHING;

      UPDATE public.wallets
      SET balance = round(COALESCE(balance, 0) + v_compensation_for_passenger, 2),
          updated_at = NOW()
      WHERE user_id = v_passenger_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PASSENGER_WALLET_MISSING';
      END IF;

      INSERT INTO public.transactions (
        user_id, amount, type, description, related_ride_id
      ) VALUES (
        v_passenger_id,
        v_compensation_for_passenger,
        'compensation',
        'Compensación por cancelación del conductor',
        p_ride_id
      );
    END IF;

    PERFORM public.create_notification(
      v_passenger_id,
      'ride_cancelled',
      'Viaje cancelado',
      'El conductor ha cancelado el viaje. Se ha devuelto tu dinero.',
      jsonb_build_object('ride_id', p_ride_id, 'refund', v_total_paid)
    );

    v_new_passengers := v_new_passengers || jsonb_build_array(
      v_passenger || jsonb_build_object(
        'status', 'cancelled',
        'cancelled_at', NOW(),
        'refund_amount', v_total_paid,
        'driver_compensation', v_compensation_for_passenger
      )
    );
  END LOOP;

  IF v_penalty > 0 THEN
    PERFORM public.record_ride_financial_event(
      p_ride_id,
      v_driver_id,
      'driver_cancellation_penalty',
      'settled',
      v_penalty,
      v_platform_penalty,
      v_driver_compensation_total,
      0,
      'Penalización económica por cancelación del conductor',
      jsonb_build_object(
        'driver_share', v_driver_compensation_total,
        'platform_share', v_platform_penalty,
        'hours_until_departure', v_hours
      ),
      NULL,
      NULL
    );
  END IF;

  INSERT INTO public.wallets (user_id, balance, held_balance)
  VALUES (v_driver_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.wallets (user_id, balance, held_balance)
  VALUES ('00000000-0000-0000-0000-000000000000', 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF v_penalty > 0 THEN
    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) - v_penalty, 2),
        updated_at = NOW()
    WHERE user_id = v_driver_id;
    GET DIAGNOSTICS v_driver_wallet_updated = ROW_COUNT;
    IF v_driver_wallet_updated <> 1 THEN
      RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
    END IF;

    INSERT INTO public.transactions (
      user_id, amount, type, description, related_ride_id
    ) VALUES (
      v_driver_id,
      -v_penalty,
      'penalty',
      'Penalización por cancelación del conductor',
      p_ride_id
    );
  END IF;

  IF v_platform_penalty > 0 THEN
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
      'Parte plataforma de penalización del conductor',
      p_ride_id
    );
  END IF;

  IF v_penalty > 0 THEN
    UPDATE public.profiles
    SET trust_score = greatest(0, COALESCE(trust_score, 0) - CASE WHEN v_hours < 2 THEN 20 ELSE 10 END),
        rating = greatest(1.0, COALESCE(rating, 5.0) - CASE WHEN v_hours < 2 THEN 0.5 ELSE 0.2 END),
        updated_at = NOW()
    WHERE id = v_driver_id
    RETURNING trust_score, rating INTO v_new_trust, v_new_rating;

    IF v_new_trust IS NOT NULL THEN
      PERFORM public.log_reputation_change(
        v_driver_id,
        'trust_score',
        -CASE WHEN v_hours < 2 THEN 20 ELSE 10 END,
        v_new_trust,
        'Cancelación del conductor',
        p_ride_id
      );
    END IF;
    IF v_new_rating IS NOT NULL THEN
      PERFORM public.log_reputation_change(
        v_driver_id,
        'rating',
        -CASE WHEN v_hours < 2 THEN 0.5 ELSE 0.2 END,
        v_new_rating,
        'Penalización por cancelación del conductor',
        p_ride_id
      );
    END IF;
  END IF;

  UPDATE public.rides
  SET passengers = v_new_passengers,
      participant_ids = ARRAY[v_driver_id],
      status = 'cancelled',
      cancellation_reason = left(COALESCE(p_reason, 'Cancelación operativa'), 500),
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE id = p_ride_id;

  -- Close every pending request for this ride so a late card success cannot
  -- recreate a booking after the driver's cancellation.
  UPDATE public.ride_requests
  SET status = 'cancelled'
  WHERE ride_id = p_ride_id
    AND requester_id <> v_driver_id
    AND lower(COALESCE(status, '')) IN (
      'pending', 'requested', 'awaiting_payment', 'processing', 'unpaid'
    );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'cancelled',
    'ride_id', p_ride_id,
    'penalty', v_penalty,
    'passenger_compensation_total', v_driver_compensation_total,
    'platform_penalty', v_platform_penalty,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ride_unified(uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride_unified(uuid, text, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride_unified(uuid, text, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride_unified(uuid, text, jsonb, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.cancel_ride(uuid);
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.cancel_ride_unified(
    p_ride_id,
    'Cancelado por el conductor',
    '{}'::JSONB
  );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_ride_by_driver(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_ride_by_driver(
  p_ride_id UUID,
  p_reason TEXT DEFAULT 'Cancelación operativa'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.cancel_ride_unified(p_ride_id, p_reason, '{}'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ride(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_ride_by_driver(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride_by_driver(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride_by_driver(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride_by_driver(uuid, text) TO service_role;

-- --------------------------------------------------------------------------
-- Passenger no-show. This replaces the historical 20%/single-seat handler.
-- It uses the same 90/10 gross settlement as a completed ride, is safe for
-- Stripe bookings, and marks the passenger before a retry can pay twice.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.handle_passenger_no_show(uuid, uuid);

CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(
  p_ride_id UUID,
  p_passenger_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_found BOOLEAN := FALSE;
  v_already_processed BOOLEAN := FALSE;
  v_already_verified BOOLEAN := FALSE;
  v_status TEXT;
  v_payment_method TEXT;
  v_payment_intent_id TEXT;
  v_captured_amount NUMERIC;
  v_passenger_id_text TEXT;
  v_price_text TEXT;
  v_seats_text TEXT;
  v_price NUMERIC;
  v_seats INTEGER;
  v_total_paid NUMERIC;
  v_driver_amount NUMERIC;
  v_platform_fee NUMERIC;
  v_driver_wallet_updated INTEGER;
  v_platform_wallet_updated INTEGER;
  v_passenger_wallet_updated INTEGER;
  v_passenger_tx_id UUID;
  v_driver_tx_id UUID;
  v_platform_tx_id UUID;
  v_new_trust NUMERIC;
BEGIN
  IF v_driver_id IS NULL OR p_passenger_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
    AND driver_id = v_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND_OR_UNAUTHORIZED');
  END IF;

  -- Inspect the target while the ride is locked. A repeated request after the
  -- state transition is a successful no-op, including after ride completion.
  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    v_passenger_id_text := lower(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    ));

    IF v_passenger_id_text = lower(p_passenger_id::TEXT)
       AND lower(COALESCE(v_passenger ->> 'status', '')) = 'no_show' THEN
      v_already_processed := TRUE;
      EXIT;
    END IF;

    IF v_passenger_id_text = lower(p_passenger_id::TEXT)
       AND lower(COALESCE(v_passenger ->> 'status', 'confirmed')) IN (
         'confirmed', 'accepted', 'pending_boarding'
       ) THEN
      v_found := TRUE;
      EXIT;
    END IF;

    IF v_passenger_id_text = lower(p_passenger_id::TEXT)
       AND lower(COALESCE(v_passenger ->> 'status', '')) IN (
         'verified', 'on_board', 'confirmed_by_pin', 'completed'
       ) THEN
      v_already_verified := TRUE;
      EXIT;
    END IF;
  END LOOP;

  IF v_already_processed THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true,
      'status', 'no_show',
      'ride_id', p_ride_id,
      'passenger_id', p_passenger_id,
      'payout', 0,
      'fee', 0
    );
  END IF;

  IF v_already_verified THEN
    RETURN jsonb_build_object('success', false, 'error', 'PASSENGER_ALREADY_VERIFIED');
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_build_object('success', false, 'error', 'PASSENGER_NOT_CONFIRMED');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('active', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_ACTIVE');
  END IF;

  IF v_ride.departure_time IS NULL OR v_ride.departure_time > NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_DEPARTED');
  END IF;

  v_passenger_id_text := NULLIF(trim(COALESCE(
    v_passenger ->> 'id',
    v_passenger ->> 'passenger_id',
    v_passenger ->> 'user_id',
    ''
  )), '');
  IF v_passenger_id_text IS NULL THEN
    RAISE EXCEPTION 'PASSENGER_ID_REQUIRED_FOR_NO_SHOW';
  END IF;

  v_price_text := trim(COALESCE(
    v_passenger ->> 'booked_price',
    v_passenger ->> 'price_per_seat',
    v_passenger ->> 'price',
    ''
  ));
  IF v_price_text !~ '^[0-9]+([.][0-9]+)?$' THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_NO_SHOW';
  END IF;
  v_price := round(v_price_text::NUMERIC, 6);
  IF v_price < 0.50 OR v_price > 300 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_NO_SHOW';
  END IF;

  v_seats_text := trim(COALESCE(
    v_passenger ->> 'seats_booked',
    v_passenger ->> 'num_seats',
    v_passenger ->> 'seats',
    v_passenger ->> 'seat_count',
    '1'
  ));
  IF v_seats_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_NO_SHOW';
  END IF;
  v_seats := v_seats_text::INTEGER;
  IF v_seats < 1 OR v_seats > 8 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_NO_SHOW';
  END IF;

  IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
     AND trim(v_passenger ->> 'payment_amount') !~ '^[0-9]+([.][0-9]+)?$' THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_NO_SHOW';
  END IF;
  IF NULLIF(trim(v_passenger ->> 'payment_amount'), '') IS NOT NULL
     AND round((v_passenger ->> 'payment_amount')::NUMERIC, 2) <> round(v_price * v_seats, 2) THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH_FOR_NO_SHOW';
  END IF;
  v_total_paid := round(v_price * v_seats, 2);
  IF v_total_paid < 0.50 OR v_total_paid > 2400 THEN
    RAISE EXCEPTION 'INVALID_PASSENGER_AMOUNT_FOR_NO_SHOW';
  END IF;

  v_payment_method := lower(COALESCE(v_passenger ->> 'payment_method', 'wallet'));
  v_payment_intent_id := NULLIF(trim(v_passenger ->> 'payment_intent_id'), '');
  IF v_payment_method IN ('stripe', 'card', 'credit_card') OR v_payment_intent_id IS NOT NULL THEN
    v_captured_amount := public.sw_captured_payment_amount(v_payment_intent_id);
    IF v_captured_amount IS NULL OR round(v_captured_amount, 2) <> round(v_total_paid, 2) THEN
      RAISE EXCEPTION 'STRIPE_PAYMENT_NOT_CAPTURED_FOR_NO_SHOW';
    END IF;
  END IF;

  v_platform_fee := round(v_total_paid * 0.10, 2);
  v_driver_amount := round(v_total_paid - v_platform_fee, 2);

  -- Wallet bookings hold the gross amount; Stripe bookings are settled from
  -- the external charge and must never be credited to the in-app wallet twice.
  IF v_payment_method NOT IN ('stripe', 'card', 'credit_card')
     AND NULLIF(v_passenger ->> 'payment_intent_id', '') IS NULL THEN
    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (p_passenger_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets
    SET held_balance = round(COALESCE(held_balance, 0) - v_total_paid, 2),
        updated_at = NOW()
    WHERE user_id = p_passenger_id
      AND COALESCE(held_balance, 0) >= v_total_paid;
    GET DIAGNOSTICS v_passenger_wallet_updated = ROW_COUNT;
    IF v_passenger_wallet_updated <> 1 THEN
      RAISE EXCEPTION 'PASSENGER_WALLET_MISSING_OR_HOLD_MISMATCH';
    END IF;
  END IF;

  INSERT INTO public.wallets (user_id, balance, held_balance)
  VALUES (v_driver_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets
  SET balance = round(COALESCE(balance, 0) + v_driver_amount, 2),
      updated_at = NOW()
  WHERE user_id = v_driver_id;
  GET DIAGNOSTICS v_driver_wallet_updated = ROW_COUNT;
  IF v_driver_wallet_updated <> 1 THEN
    RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
  END IF;

  INSERT INTO public.wallets (user_id, balance, held_balance)
  VALUES ('00000000-0000-0000-0000-000000000000', 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets
  SET balance = round(COALESCE(balance, 0) + v_platform_fee, 2),
      updated_at = NOW()
  WHERE user_id = '00000000-0000-0000-0000-000000000000';
  GET DIAGNOSTICS v_platform_wallet_updated = ROW_COUNT;
  IF v_platform_wallet_updated <> 1 THEN
    RAISE EXCEPTION 'TREASURY_WALLET_MISSING';
  END IF;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    p_passenger_id,
    -v_total_paid,
    'penalty',
    'Cargo por no-show (' || v_seats || ' plaza(s))',
    p_ride_id
  ) RETURNING id INTO v_passenger_tx_id;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    v_driver_id,
    v_driver_amount,
    'earning',
    'Liquidación por no-show (90% de ' || v_total_paid || ' EUR)',
    p_ride_id
  ) RETURNING id INTO v_driver_tx_id;

  INSERT INTO public.transactions (
    user_id, amount, type, description, related_ride_id
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_platform_fee,
    'fee',
    'Comisión por no-show (10% de ' || v_total_paid || ' EUR)',
    p_ride_id
  ) RETURNING id INTO v_platform_tx_id;

  PERFORM public.record_ride_financial_event(
    p_ride_id,
    p_passenger_id,
    'no_show_penalty',
    'settled',
    v_total_paid,
    v_platform_fee,
    v_driver_amount,
    0,
    'Liquidación por pasajero no presentado',
    jsonb_build_object(
      'payment_method', v_payment_method,
      'seats', v_seats,
      'commission_rate', 0.10,
      'driver_rate', 0.90,
      'passenger_transaction_id', v_passenger_tx_id,
      'driver_transaction_id', v_driver_tx_id,
      'platform_transaction_id', v_platform_tx_id
    ),
    v_passenger_tx_id,
    NULL
  );

  FOR v_passenger IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB))
  LOOP
    IF lower(COALESCE(
      v_passenger ->> 'id',
      v_passenger ->> 'passenger_id',
      v_passenger ->> 'user_id',
      ''
    )) = lower(p_passenger_id::TEXT) THEN
      v_new_passengers := v_new_passengers || jsonb_build_array(
        v_passenger || jsonb_build_object(
          'status', 'no_show',
          'reported_at', NOW(),
          'penalty_amount', v_total_paid,
          'payment_amount', v_total_paid,
          'driver_payout', v_driver_amount,
          'platform_fee', v_platform_fee,
          'seats_booked', v_seats
        )
      );
    ELSE
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
    END IF;
  END LOOP;

  UPDATE public.rides
  SET passengers = v_new_passengers,
      participant_ids = array_remove(participant_ids, p_passenger_id),
      updated_at = NOW()
  WHERE id = p_ride_id;

  UPDATE public.profiles
  SET trust_score = greatest(0, COALESCE(trust_score, 0) - 15),
      updated_at = NOW()
  WHERE id = p_passenger_id
  RETURNING trust_score INTO v_new_trust;

  IF v_new_trust IS NOT NULL THEN
    PERFORM public.log_reputation_change(
      p_passenger_id,
      'trust_score',
      -15,
      v_new_trust,
      'Pasajero no presentado',
      p_ride_id
    );
  END IF;

  PERFORM public.create_notification(
    p_passenger_id,
    'no_show_penalty',
    'No-show registrado',
    'Se ha aplicado un cargo por no presentarte al viaje.',
    jsonb_build_object('ride_id', p_ride_id, 'penalty', v_total_paid, 'seats', v_seats)
  );
  PERFORM public.create_notification(
    v_driver_id,
    'no_show_recorded',
    'No-show registrado',
    'Se ha liquidado el 90% del importe de la reserva.',
    jsonb_build_object('ride_id', p_ride_id, 'payout', v_driver_amount, 'seats', v_seats)
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'no_show',
    'ride_id', p_ride_id,
    'passenger_id', p_passenger_id,
    'penalty', v_total_paid,
    'payout', v_driver_amount,
    'fee', v_platform_fee,
    'seats', v_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.handle_passenger_no_show(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_passenger_no_show(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_passenger_no_show(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_passenger_no_show(uuid, uuid) TO service_role;


-- --------------------------------------------------------------------------
-- Secure ride details: one presentation contract for price, seats and private
-- booking fields. The passenger price is gross and already includes the 10%
-- platform commission; there is no second commission charge at checkout.
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_ride_details_secure(uuid);

CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_driver public.profiles%ROWTYPE;
  v_is_driver BOOLEAN := FALSE;
  v_is_participant BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
    INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  SELECT *
    INTO v_driver
  FROM public.profiles
  WHERE id = v_ride.driver_id;

  v_is_driver := v_ride.driver_id = v_user_id;
  v_is_participant := v_is_driver
    OR v_user_id = ANY(COALESCE(v_ride.participant_ids, ARRAY[]::UUID[]))
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS passenger(value)
      WHERE lower(COALESCE(
        passenger.value ->> 'id',
        passenger.value ->> 'passenger_id',
        passenger.value ->> 'user_id',
        ''
      )) = lower(v_user_id::TEXT)
        AND lower(COALESCE(passenger.value ->> 'status', '')) IN (
          'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
          'confirmed_by_pin', 'completed'
        )
    );

  RETURN json_build_object(
    'success', true,
    'data', json_build_object(
      'id', v_ride.id,
      'driver_id', v_ride.driver_id,
      'status', v_ride.status,
      'origin', v_ride.origin,
      'destination', v_ride.destination,
      'origin_address', COALESCE(v_ride.origin_address, v_ride.origin ->> 'address'),
      'destination_address', COALESCE(v_ride.destination_address, v_ride.destination ->> 'address'),
      'departure_time', v_ride.departure_time,
      'price', round(v_ride.price, 2),
      'price_per_seat', round(v_ride.price, 2),
      'currency', 'EUR',
      'commission_included', TRUE,
      'platform_fee_rate', 0.10,
      'pricing', json_build_object(
        'price_per_seat', round(v_ride.price, 2),
        'platform_fee_per_seat', round(v_ride.price * 0.10, 2),
        'driver_payout_per_seat', round(v_ride.price - round(v_ride.price * 0.10, 2), 2),
        'commission_included', TRUE,
        'platform_fee_rate', 0.10,
        'passenger_charge_basis', 'gross_price',
        'currency', 'EUR'
      ),
      'seats_available', v_ride.seats_available,
      'available_seats', v_ride.seats_available,
      'total_seats', COALESCE(v_ride.total_seats, v_ride.seats_available),
      'seats_total', COALESCE(v_ride.total_seats, v_ride.seats_available),
      'distance', v_ride.distance,
      'waypoints', v_ride.waypoints,
      'overview_polyline', v_ride.overview_polyline,
      'vehicle_model', v_ride.vehicle_model,
      'vehicle_plate', CASE WHEN v_is_participant THEN v_ride.vehicle_plate ELSE NULL END,
      'driver', json_build_object(
        'id', v_ride.driver_id,
        'display_name', COALESCE(v_ride.driver_display_name, v_driver.display_name, v_driver.full_name, 'Conductor'),
        'display_name_legacy', COALESCE(v_ride.driver_display_name, v_driver.display_name, v_driver.full_name, 'Conductor'),
        'avatar_url', COALESCE(v_ride.driver_photo_url, v_driver.photo_url),
        'photo_url', COALESCE(v_ride.driver_photo_url, v_driver.photo_url),
        'rating', v_driver.rating,
        'verified', v_driver.is_verified,
        'vehicle_info', v_driver.vehicle_info
      ),
      'passengers', COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', passenger_data.passenger_id,
            'displayName', COALESCE(
              (SELECT COALESCE(profile.display_name, profile.full_name)
               FROM public.profiles AS profile
               WHERE profile.id::TEXT = passenger_data.passenger_id
               LIMIT 1),
              'Pasajero'
            ),
            'display_name', COALESCE(
              (SELECT COALESCE(profile.display_name, profile.full_name)
               FROM public.profiles AS profile
               WHERE profile.id::TEXT = passenger_data.passenger_id
               LIMIT 1),
              'Pasajero'
            ),
            'avatarUrl', (
              SELECT profile.photo_url
              FROM public.profiles AS profile
              WHERE profile.id::TEXT = passenger_data.passenger_id
              LIMIT 1
            ),
            'avatar_url', (
              SELECT profile.photo_url
              FROM public.profiles AS profile
              WHERE profile.id::TEXT = passenger_data.passenger_id
              LIMIT 1
            ),
            'status', passenger_data.value ->> 'status',
            'pickup_address', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN COALESCE(passenger_data.value ->> 'pickup_address', v_ride.origin ->> 'address')
              ELSE NULL
            END,
            'pickup_location', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN passenger_data.value -> 'pickup_location'
              ELSE NULL
            END,
            'dropoff_address', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN COALESCE(passenger_data.value ->> 'dropoff_address', v_ride.destination ->> 'address')
              ELSE NULL
            END,
            'dropoff_location', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN passenger_data.value -> 'dropoff_location'
              ELSE NULL
            END,
            'pin', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN passenger_data.value ->> 'pin'
              ELSE '****'
            END,
            'num_seats', COALESCE(
              NULLIF(passenger_data.value ->> 'seats_booked', '')::INTEGER,
              NULLIF(passenger_data.value ->> 'num_seats', '')::INTEGER,
              NULLIF(passenger_data.value ->> 'seats', '')::INTEGER,
              1
            ),
            'seats_booked', COALESCE(
              NULLIF(passenger_data.value ->> 'seats_booked', '')::INTEGER,
              NULLIF(passenger_data.value ->> 'num_seats', '')::INTEGER,
              NULLIF(passenger_data.value ->> 'seats', '')::INTEGER,
              1
            ),
            'booked_price', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN NULLIF(passenger_data.value ->> 'booked_price', '')::NUMERIC
              ELSE NULL
            END,
            'payment_amount', CASE
              WHEN v_is_driver OR lower(passenger_data.passenger_id) = lower(v_user_id::TEXT)
              THEN NULLIF(passenger_data.value ->> 'payment_amount', '')::NUMERIC
              ELSE NULL
            END
          )
          ORDER BY passenger_data.passenger_id
        )
        FROM (
          SELECT
            value,
            lower(COALESCE(
              value ->> 'id',
              value ->> 'passenger_id',
              value ->> 'user_id',
              ''
            )) AS passenger_id
          FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) AS elem(value)
          WHERE lower(COALESCE(value ->> 'status', '')) IN (
            'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board',
            'confirmed_by_pin', 'completed'
          )
        ) AS passenger_data
      ), '[]'::JSON),
      'financial_policy', json_build_object(
        'passenger_cancellation', json_build_object(
          'more_than_24_hours_refund_percent', 100,
          'between_2_and_24_hours_refund_percent', 50,
          'less_than_2_hours_refund_percent', 0
        ),
        'driver_cancellation_refund_percent', 100,
        'commission_included_in_gross_price', TRUE
      ),
      'is_driver', v_is_driver,
      'is_participant', v_is_participant
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_details_secure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ride_details_secure(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_ride_details_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ride_details_secure(uuid) TO service_role;

-- --------------------------------------------------------------------------
-- Admin financial read model
-- --------------------------------------------------------------------------
-- Historical admin statistics summed rides.price (a per-seat value) and called
-- the result profit. That was neither multi-seat aware nor net of real wallet
-- movements. The read model below uses the treasury wallet for the current
-- available balance and the ledger for realized gross/fee/payout totals.
CREATE OR REPLACE FUNCTION public.get_platform_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
  v_treasury_balance NUMERIC := 0;
  v_treasury_held NUMERIC := 0;
  v_settled_gross NUMERIC := 0;
  v_realized_platform_fees NUMERIC := 0;
  v_driver_payouts NUMERIC := 0;
  v_recorded_refunds NUMERIC := 0;
  v_total_completed_rides INTEGER := 0;
  v_total_users INTEGER := 0;
  v_pending_verifications INTEGER := 0;
  v_total_km_shared NUMERIC := 0;
  v_total_co2_saved NUMERIC := 0;
  v_recent_transactions JSONB := '[]'::JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles p
       WHERE p.id = auth.uid()
         AND (COALESCE(p.is_admin, FALSE) OR p.role IN ('admin', 'super_admin'))
     ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT COALESCE(w.balance, 0), COALESCE(w.held_balance, 0)
    INTO v_treasury_balance, v_treasury_held
  FROM public.wallets w
  WHERE w.user_id = v_treasury_id;

  SELECT COUNT(*)
    INTO v_total_completed_rides
  FROM public.rides
  WHERE lower(COALESCE(status, '')) = 'completed';

  SELECT COUNT(*)
    INTO v_total_users
  FROM public.profiles;

  SELECT COUNT(*)
    INTO v_pending_verifications
  FROM public.profiles
  WHERE lower(COALESCE(verification ->> 'status', '')) = 'pending';

  SELECT
    COALESCE(SUM(CASE
      WHEN event_type IN ('ride_settlement', 'no_show_penalty')
      THEN gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN event_type IN (
        'ride_settlement',
        'no_show_penalty',
        'passenger_cancellation_penalty',
        'driver_cancellation_penalty'
      )
      THEN platform_fee ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN event_type IN ('ride_settlement', 'no_show_penalty')
      THEN driver_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN event_type IN (
        'booking_payment_refund',
        'passenger_refund',
        'driver_cancellation_refund',
        'refund'
      )
      THEN refund_amount ELSE 0 END), 0)
  INTO v_settled_gross, v_realized_platform_fees, v_driver_payouts, v_recorded_refunds
  FROM public.ride_financial_ledger;

  SELECT
    COALESCE(SUM(COALESCE(distance, 0)), 0),
    COALESCE(SUM(COALESCE(distance, 0) * 0.108), 0)
  INTO v_total_km_shared, v_total_co2_saved
  FROM public.rides
  WHERE lower(COALESCE(status, '')) = 'completed';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'date', t.created_at,
    'description', t.description,
    'rideId', t.related_ride_id,
    'amount', round(t.amount, 2),
    'type', t.type
  ) ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_recent_transactions
  FROM (
    SELECT id, created_at, description, related_ride_id, amount, type
    FROM public.transactions
    WHERE user_id = v_treasury_id
      AND amount > 0
      AND type IN ('fee', 'penalty')
    ORDER BY created_at DESC
    LIMIT 15
  ) t;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_revenue', round(v_settled_gross, 2),
    'gross_total_volume', round(v_settled_gross, 2),
    'platform_profit', round(v_treasury_balance, 2),
    'treasury_balance', round(v_treasury_balance, 2),
    'treasury_held_balance', round(v_treasury_held, 2),
    'realized_platform_fees', round(v_realized_platform_fees, 2),
    'driver_payouts', round(v_driver_payouts, 2),
    'recorded_refunds', round(v_recorded_refunds, 2),
    'total_uncollected_fees', 0,
    'completed_rides', v_total_completed_rides,
    'total_completed_rides', v_total_completed_rides,
    'active_users', v_total_users,
    'total_users', v_total_users,
    'pending_verifications', v_pending_verifications,
    'total_km_shared', round(v_total_km_shared, 2),
    'co2_saved_kg', round(v_total_co2_saved, 2),
    'platform_fee_rate', 0.10,
    'commission_included_in_gross', TRUE,
    'recentFeeTransactions', v_recent_transactions,
    'last_updated', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_admin_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_admin_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_admin_stats() TO service_role;

-- Keep the legacy JSON-shaped reader on the same canonical read model. Its
-- secure wrapper is still used by older clients, but it no longer reads the
-- historical treasury/projection implementation.
CREATE OR REPLACE FUNCTION public.get_platform_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.get_platform_admin_stats()::JSON;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.get_platform_stats_secure()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.get_platform_stats();
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_stats_secure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_stats_secure() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_stats_secure() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_stats_secure() TO service_role;

-- Disable every generic money-moving RPC left by older migrations. Their
-- signatures varied over time, so revoke all overloads instead of guessing a
-- single argument list. This also explicitly removes inherited SECURITY
-- DEFINER grants from the old deposit, escrow and platform-payout helpers;
-- wallet top-ups, booking refunds and ride settlement use the canonical
-- Edge/RPC transitions above.
DO $$
DECLARE
  v_function_signature TEXT;
BEGIN
  FOR v_function_signature IN
    SELECT format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    )
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'add_funds',
        'process_payment',
        'refund_payment',
        'process_batch_payments',
        'confirm_stripe_booking',
        'confirm_passenger_arrival',
        'create_deposit_intent',
        'confirm_deposit_secure',
        'move_to_escrow',
        'release_from_escrow',
        'process_escrow_releases',
        'request_platform_payout',
        'request_platform_payout_secure',
        'request_platform_payout_with_rate_limit'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_function_signature
    );
  END LOOP;
END;
$$;

-- Keep the RPC schema cache up to date after changing signatures.
NOTIFY pgrst, 'reload schema';
