-- ============================================================================
-- SHAREWAY · FIX_STRIPE_WEBHOOK_CORE.sql
-- ============================================================================
-- Instala la capa SQL que necesita el webhook de Stripe y que nunca se aplico
-- a produccion (migracion 20260901 parcial). Sin esto, las recargas con
-- tarjeta se cobran pero NUNCA se acreditan en la cartera.
--
-- Contenido (extraido de 20260901120000 + correcciones):
--   · Tablas: stripe_webhook_events, stripe_financial_transitions,
--             stripe_refund_operations
--   · RPCs del webhook: claim/complete_stripe_webhook_event,
--     transition_financial_status (version con candado service_role),
--     prepare/complete_stripe_refund_operation, settle_wallet_deposit,
--     mark_wallet_deposit_failed, fulfill_booking_after_payment,
--     record_unfulfillable_booking_refund, sw_captured_payment_amount,
--     handle_stripe_dispute (nueva, no existia en ninguna migracion)
--   · create_notification (si ya existe, se reemplaza por la misma version)
--   · Columnas que faltan en payment_intents + CHECK de status ampliado
--   · CORRECCION: el pago pi_3UQTzy... ya reembolsado queda marcado para que
--     los reintentos de Stripe no acrediten 5 EUR fantasma.
--
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Columnas y restricciones de payment_intents
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS financial_status TEXT DEFAULT 'pending';
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS booking_signature TEXT;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS booking_attempt INTEGER DEFAULT 1;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS provider_refund_id TEXT;

-- El CHECK viejo solo permitia pending/completed/expired/failed: bloqueaba
-- 'refunded' y 'canceled' que el webhook necesita escribir.
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;

-- ----------------------------------------------------------------------------
-- 1) Limpiar variantes antiguas inseguras
-- ----------------------------------------------------------------------------
DO $do$
BEGIN
  EXECUTE COALESCE((
    SELECT string_agg(format('DROP FUNCTION IF EXISTS public.%I(%s);', p.proname,
           pg_get_function_identity_arguments(p.oid)), E'\n')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('transition_financial_status', 'fulfill_booking_after_payment',
                        'claim_stripe_webhook_event', 'complete_stripe_webhook_event',
                        'settle_wallet_deposit', 'mark_wallet_deposit_failed',
                        'prepare_stripe_refund_operation', 'complete_stripe_refund_operation',
                        'record_unfulfillable_booking_refund', 'handle_stripe_dispute')
  ), 'SELECT 1');
END
$do$;

-- ----------------------------------------------------------------------------
-- 2) Tablas de soporte del webhook
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 3) transition_financial_status (con candado service_role)
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 4) prepare/complete_stripe_refund_operation
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 5) claim/complete_stripe_webhook_event
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 6) settle_wallet_deposit + mark_wallet_deposit_failed
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 7) sw_captured_payment_amount
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 8) fulfill_booking_after_payment + record_unfulfillable_booking_refund
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9) create_notification (dependencia de settle_wallet_deposit)
-- ----------------------------------------------------------------------------

-- Version ROBUSTA: detecta las columnas reales de la tabla notifications
-- (body/message, data/metadata) y NUNCA lanza error: las notificaciones son
-- best-effort y no pueden romper el flujo de dinero.
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_data JSONB DEFAULT '{}'::JSONB,
  p_priority TEXT DEFAULT 'normal',
  p_category TEXT DEFAULT 'general',
  p_scheduled_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_has_body BOOLEAN;
  v_has_message BOOLEAN;
  v_has_data BOOLEAN;
  v_has_metadata BOOLEAN;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='body'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='message'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='data'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='metadata')
    INTO v_has_body, v_has_message, v_has_data, v_has_metadata;

  IF NOT (v_has_body OR v_has_message) THEN RETURN NULL; END IF;

  EXECUTE format(
    'INSERT INTO public.notifications (user_id, type, title, %s, %s, priority, category) '
      || 'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    COALESCE(CASE WHEN v_has_body THEN 'body' END, 'message'),
    COALESCE(CASE WHEN v_has_data THEN 'data' END, CASE WHEN v_has_metadata THEN 'metadata' END, '''{}''::jsonb')
  ) INTO v_id
  USING p_user_id, COALESCE(p_type, 'info'), p_title, p_body,
        CASE WHEN v_has_data OR v_has_metadata THEN COALESCE(p_data, '{}'::JSONB) END,
        COALESCE(p_priority, 'normal'), COALESCE(p_category, 'general');

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[create_notification] omitida: %', SQLERRM;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- (Sin sobrecarga legacy: dos firmas con 5 args crean ambiguedad fatal en settle)

-- ----------------------------------------------------------------------------
-- 10) handle_stripe_dispute (no existia en ninguna migracion)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_stripe_dispute(
  p_payment_intent_id TEXT,
  p_dispute_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  SELECT * INTO v_intent
  FROM public.payment_intents
  WHERE external_id = p_payment_intent_id;

  IF v_intent.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DISPUTE_INTENT_NOT_FOUND');
  END IF;

  UPDATE public.payment_intents
  SET financial_status = 'disputed',
      status = CASE WHEN status = 'completed' THEN status ELSE 'failed' END,
      metadata = COALESCE(metadata, '{}'::JSONB)
        || jsonb_build_object('disputed_at', NOW(), 'dispute_amount', p_dispute_amount),
      updated_at = NOW()
  WHERE id = v_intent.id;

  BEGIN
    PERFORM public.create_notification(
      v_intent.user_id,
      'payment_dispute',
      'Disputa de pago abierta',
      'Se ha abierto una disputa sobre un pago. Nuestro equipo lo revisara.',
      jsonb_build_object('payment_intent_id', p_payment_intent_id, 'dispute_amount', p_dispute_amount)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_stripe_dispute] notificacion omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'payment_intent_id', p_payment_intent_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.handle_stripe_dispute(TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_stripe_dispute(TEXT, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.handle_stripe_dispute(TEXT, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_stripe_dispute(TEXT, NUMERIC) TO service_role;

-- ----------------------------------------------------------------------------
-- 11) CORRECCION del pago reembolsado (pi_3UQTzy...)
--     El pago real de 5 EUR fue reembolsado por el admin ANTES de que esta
--     capa existiera: la cartera nunca se acredito, asi que solo hay que
--     marcar el intent como refunded para que los reintentos de Stripe del
--     evento payment_intent.succeeded (hasta ~72h) no acrediten saldo fantasma.
--     settle_wallet_deposit exige status='pending' y saltara con
--     DEPOSIT_NOT_PENDING.
-- ----------------------------------------------------------------------------
UPDATE public.payment_intents
SET status = 'refunded',
    financial_status = 'refunded',
    metadata = COALESCE(metadata, '{}'::JSONB)
      || jsonb_build_object('refunded_early', true, 'refund_note', 'Reembolsado por el admin antes de aplicar FIX_STRIPE_WEBHOOK_CORE'),
    updated_at = NOW()
WHERE external_id = 'pi_3UQTzyB3YBELMkdd0fAAOrwT'
  AND status <> 'completed';

NOTIFY pgrst, 'reload schema';
