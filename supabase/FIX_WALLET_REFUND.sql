-- ============================================================================
-- SHAREWAY · FIX_WALLET_REFUND.sql
-- ============================================================================
-- Reversión AUTOMÁTICA de reembolsos de recargas de cartera.
--
-- Problema que corrige:
--   Al reembolsar en Stripe una recarga ya acreditada, el webhook solo
--   actualizaba el registro del pago: la cartera conservaba el saldo
--   (dinero fantasma para la plataforma).
--
-- Solución:
--   Nueva RPC service_role `reverse_wallet_deposit_refund` que, ante el
--   evento charge.refunded de un depósito de cartera:
--     · debita el importe reembolsado de la cartera (sin pasar de 0)
--     · registra la transacción 'refund'
--     · marca el intent como refunded (idempotente ante reintentos)
--     · notifica al usuario
--   Si el pago NO es un depósito de cartera (p.ej. reserva de viaje),
--   devuelve handled=false para que el webhook siga su ruta anterior.
--
-- Requiere FIX_STRIPE_WEBHOOK_CORE.sql (create_notification robusto).
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

DO $do$
BEGIN
  EXECUTE COALESCE((
    SELECT string_agg(format('DROP FUNCTION IF EXISTS public.%I(%s);', p.proname,
           pg_get_function_identity_arguments(p.oid)), E'\n')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'reverse_wallet_deposit_refund'
  ), 'SELECT 1');
END
$do$;

CREATE OR REPLACE FUNCTION public.reverse_wallet_deposit_refund(
  p_external_id TEXT,
  p_refund_amount NUMERIC,
  p_stripe_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_debit NUMERIC;
  v_balance NUMERIC;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  IF NULLIF(trim(p_external_id), '') IS NULL
     OR p_refund_amount IS NULL OR p_refund_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_REFUND');
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE external_id = p_external_id
  FOR UPDATE;

  -- Solo se gestionan aqui los depositos de cartera. El resto de pagos
  -- (reservas de viaje, con type='ride_booking' o ride_id) devuelven
  -- handled=false para que el webhook use su ruta anterior.
  IF v_intent.id IS NULL
     OR COALESCE(v_intent.metadata ->> 'type', 'wallet_deposit') <> 'wallet_deposit'
     OR v_intent.ride_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'handled', false);
  END IF;

  -- Idempotencia: solo la propia reversión escribe 'refunded_amount' en
  -- metadata (financial_status tambien lo escribe transition_financial_status,
  -- que NO debita cartera, asi que no puede usarse como marca de reversión).
  IF COALESCE(v_intent.metadata ->> 'refunded_amount', '') <> ''
     OR v_intent.provider_refund_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'handled', true);
  END IF;

  -- Si el deposito nunca se acredito (reembolso antes de la acreditacion),
  -- solo se marca; la cartera no se toca.
  IF v_intent.status <> 'completed' THEN
    UPDATE public.payment_intents
    SET status = 'refunded',
        financial_status = 'refunded',
        metadata = COALESCE(metadata, '{}'::JSONB)
          || jsonb_build_object('stripe_event_id', p_stripe_event_id),
        updated_at = NOW()
    WHERE id = v_intent.id;

    RETURN jsonb_build_object('success', true, 'credited_never', true, 'handled', true);
  END IF;

  -- Nunca devolver mas de lo depositado
  v_debit := LEAST(round(p_refund_amount, 2), round(v_intent.amount, 2));

  -- Si el usuario ya gasto parte del saldo, debitar solo lo disponible
  SELECT balance INTO v_balance
  FROM public.wallets
  WHERE user_id = v_intent.user_id
  FOR UPDATE;

  v_debit := LEAST(v_debit, COALESCE(v_balance, 0));

  IF v_debit > 0 THEN
    UPDATE public.wallets
    SET balance = round(balance - v_debit, 2),
        updated_at = NOW()
    WHERE user_id = v_intent.user_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description)
      VALUES (
        v_intent.user_id,
        -v_debit,
        'refund',
        'Reembolso de recarga a la tarjeta' || CASE
          WHEN p_stripe_event_id IS NULL THEN ''
          ELSE ' (' || left(p_stripe_event_id, 80) || ')'
        END
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[reverse_wallet_deposit_refund] tx omitida: %', SQLERRM;
    END;
  END IF;

  UPDATE public.payment_intents
  SET status = 'refunded',
      financial_status = 'refunded',
      provider_refund_id = COALESCE(provider_refund_id, p_stripe_event_id),
      metadata = COALESCE(metadata, '{}'::JSONB)
        || jsonb_build_object(
             'refunded_amount', v_debit,
             'refund_requested', round(p_refund_amount, 2),
             'stripe_event_id', p_stripe_event_id
           ),
      updated_at = NOW()
  WHERE id = v_intent.id;

  BEGIN
    PERFORM public.create_notification(
      v_intent.user_id,
      'payment_refunded',
      'Reembolso realizado',
      'Se ha devuelto ' || round(v_debit, 2) || ' EUR de tu recarga a tu tarjeta.',
      jsonb_build_object('payment_intent_id', p_external_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[reverse_wallet_deposit_refund] notif omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'handled', true,
    'debited', round(v_debit, 2)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.reverse_wallet_deposit_refund(TEXT, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_wallet_deposit_refund(TEXT, NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reverse_wallet_deposit_refund(TEXT, NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_wallet_deposit_refund(TEXT, NUMERIC, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
