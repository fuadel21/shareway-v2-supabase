-- ============================================================================
-- SHAREWAY · FIX_CANCEL_RIDE_UNIFIED.sql
-- ============================================================================
-- Cancelacion de viaje por el CONDUCTOR, version completa:
--   1) cancel_ride (v2): seguro para reservas pagadas con TARJETA (no abona
--      cartera a quien pago por Stripe) y con reserva multi-plaza correcta.
--   2) cancel_ride_unified: entrada service-role que usa la Edge Function
--      cancel-ride-and-refund (antes NO existia → toda cancelacion de viaje
--      fallaba con non-2xx). Recibe el mapa de reembolsos externos ya hechos
--      por Stripe para no duplicar abonos.
-- Normas: reembolso total a pasajeros; multa conductor 0/2/5 EUR por tramo
-- horario con pasajeros; 50% compensacion a pasajeros / 50% plataforma.
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- ============================================================================
-- SHAREWAY · FIX_DRIVER_CANCEL.sql
-- ============================================================================
-- cancel_ride (el CONDUCTOR cancela su viaje) alineada con las normas
-- declaradas en la app:
--   · Reembolso TOTAL a todos los pasajeros activos (retenido -> disponible)
--   · Penalización al conductor: 0 EUR (>24h) · 2 EUR (2-24h) · 5 EUR (<2h)
--     (solo con pasajeros activos)
--   · Destino de la penalización: 50% compensación repartida entre los
--     pasajeros afectados · 50% plataforma (como dice el texto de la app)
-- Corrige ademas:
--   · Multi-plaza: usa seats_booked/num_seats/seats (antes solo seats_booked
--     → reembolsaba de menos en reservas de varias plazas)
--   · booked_price con fallback al precio del viaje
--   · Solo cancelable si el viaje esta scheduled/active/in_progress
--   · Cartera de tesoreria garantizada (ON CONFLICT)
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

DROP FUNCTION IF EXISTS public.cancel_ride(UUID);

CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_pax JSONB;
  v_pax_id UUID;
  v_seats INTEGER;
  v_price NUMERIC;
  v_amount NUMERIC;
  v_hours_until_departure NUMERIC;
  v_penalty NUMERIC := 0;
  v_compensation NUMERIC := 0;
  v_platform_share NUMERIC := 0;
  v_active_pax_count INTEGER := 0;
  v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
  v_refunded_total NUMERIC := 0;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF v_ride.driver_id IS DISTINCT FROM v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_THE_DRIVER');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_CANNOT_BE_CANCELLED',
      'message', 'Este viaje ya no se puede cancelar (estado: ' || COALESCE(v_ride.status, '?') || ')');
  END IF;

  v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride.departure_time - NOW())) / 3600;

  -- Contar pasajeros activos y calcular la penalizacion segun la norma
  SELECT count(*) INTO v_active_pax_count
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
  WHERE lower(COALESCE(p->>'status', '')) IN
        ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin');

  IF v_active_pax_count > 0 THEN
    IF v_hours_until_departure < 2 THEN
      v_penalty := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
      v_penalty := 2.00;
    END IF;
  END IF;

  -- 1) Reembolso TOTAL a cada pasajero activo
  FOR v_pax IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
    WHERE lower(COALESCE(p->>'status', '')) IN
          ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin')
  LOOP
    v_pax_id := NULLIF(COALESCE(v_pax->>'id', v_pax->>'passenger_id', v_pax->>'user_id', ''), '')::UUID;
    IF v_pax_id IS NULL THEN CONTINUE; END IF;

    -- Pagos con tarjeta: su dinero vuelve por Stripe, la cartera no se toca
    IF lower(COALESCE(v_pax->>'payment_method', 'wallet')) IN ('stripe', 'card', 'credit_card')
       OR NULLIF(trim(v_pax->>'payment_intent_id'), '') IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_seats := COALESCE(
      NULLIF(v_pax->>'seats_booked', '')::INTEGER,
      NULLIF(v_pax->>'num_seats', '')::INTEGER,
      NULLIF(v_pax->>'seats', '')::INTEGER,
      1
    );
    v_price := COALESCE(
      NULLIF(v_pax->>'booked_price', '')::NUMERIC,
      v_ride.price
    );
    v_amount := round(COALESCE(v_price, 0) * GREATEST(COALESCE(v_seats, 1), 1), 2);

    UPDATE public.wallets
    SET held_balance = round(GREATEST(COALESCE(held_balance, 0) - v_amount, 0), 2),
        balance = round(COALESCE(balance, 0) + v_amount, 2),
        updated_at = NOW()
    WHERE user_id = v_pax_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (v_pax_id, v_amount, 'refund', 'Reembolso total: conductor canceló el viaje', p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride] tx pasajero omitida: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.create_notification(
        v_pax_id, 'ride_cancelled', 'Viaje cancelado por el conductor',
        'El conductor canceló el viaje. Has sido reembolsado por completo.',
        jsonb_build_object('ride_id', p_ride_id, 'refunded', v_amount)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride] notif pasajero omitida: %', SQLERRM;
    END;

    v_refunded_total := round(v_refunded_total + v_amount, 2);
  END LOOP;

  -- 2) Penalizacion al conductor: 50% compensa a los pasajeros, 50% plataforma
  IF v_penalty > 0 THEN
    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) - v_penalty, 2),
        updated_at = NOW()
    WHERE user_id = v_driver_id;

    IF v_active_pax_count > 0 THEN
      v_compensation := round(v_penalty * 0.50, 2);
      v_platform_share := round(v_penalty - v_compensation, 2);

      -- Compensacion repartida entre los pasajeros afectados
      FOR v_pax IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
        WHERE lower(COALESCE(p->>'status', '')) IN
              ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin')
      LOOP
        v_pax_id := NULLIF(COALESCE(v_pax->>'id', v_pax->>'passenger_id', v_pax->>'user_id', ''), '')::UUID;
        IF v_pax_id IS NULL THEN CONTINUE; END IF;
        UPDATE public.wallets
        SET balance = round(COALESCE(balance, 0) + round(v_compensation / v_active_pax_count, 2), 2),
            updated_at = NOW()
        WHERE user_id = v_pax_id;
      END LOOP;
    ELSE
      v_platform_share := v_penalty;
    END IF;

    -- Plataforma (tesoreria)
    INSERT INTO public.profiles (id, display_name)
    VALUES (v_treasury_id, 'Tesoreria ShareWay')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (v_treasury_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) + v_platform_share, 2),
        updated_at = NOW()
    WHERE user_id = v_treasury_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (v_driver_id, -v_penalty, 'penalty',
        'Penalización: cancelación ' || CASE WHEN v_hours_until_departure < 2 THEN 'última hora (<2h)' ELSE 'tardía (2-24h)' END || ' con pasajeros',
        p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride] tx penalizacion omitida: %', SQLERRM;
    END;
  END IF;

  -- 3) Estado final del viaje y de las solicitudes vinculadas
  UPDATE public.rides
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE id = p_ride_id;

  UPDATE public.ride_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE ride_id = p_ride_id
    AND lower(COALESCE(status, '')) IN ('pending', 'confirmed', 'awaiting_payment');

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE WHEN v_penalty > 0 THEN 'Viaje cancelado con penalización' ELSE 'Viaje cancelado sin cargos' END,
    'penalty_applied', v_penalty,
    'passenger_compensation', v_compensation,
    'platform_share', v_platform_share,
    'refunded_total', v_refunded_total,
    'affected_passengers', v_active_pax_count
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- cancel_ride_unified (la llama la Edge Function con rol service_role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_ride_unified(
  p_ride_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_external_refunds JSONB DEFAULT '{}'::JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver_id UUID;
  v_ride public.rides%ROWTYPE;
  v_pax JSONB;
  v_pax_id UUID;
  v_pax_text TEXT;
  v_seats INTEGER;
  v_price NUMERIC;
  v_amount NUMERIC;
  v_hours_until_departure NUMERIC;
  v_penalty NUMERIC := 0;
  v_compensation NUMERIC := 0;
  v_platform_share NUMERIC := 0;
  v_active_pax_count INTEGER := 0;
  v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
  v_refunded_total NUMERIC := 0;
  v_stripe_skipped INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ROLE_REQUIRED');
  END IF;

  v_driver_id := p_actor_id;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF v_ride.driver_id IS DISTINCT FROM v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_THE_DRIVER');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) NOT IN ('scheduled', 'active', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_CANNOT_BE_CANCELLED');
  END IF;

  v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride.departure_time - NOW())) / 3600;

  SELECT count(*) INTO v_active_pax_count
  FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
  WHERE lower(COALESCE(p->>'status', '')) IN
        ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin');

  IF v_active_pax_count > 0 THEN
    IF v_hours_until_departure < 2 THEN
      v_penalty := 5.00;
    ELSIF v_hours_until_departure < 24 THEN
      v_penalty := 2.00;
    END IF;
  END IF;

  -- Reembolsos de cartera: solo pasajeros con pago de CarterA
  FOR v_pax IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
    WHERE lower(COALESCE(p->>'status', '')) IN
          ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin')
  LOOP
    v_pax_text := NULLIF(COALESCE(v_pax->>'id', v_pax->>'passenger_id', v_pax->>'user_id', ''), '');
    v_pax_id := v_pax_text::UUID;
    IF v_pax_id IS NULL THEN CONTINUE; END IF;

    -- 1) Pasajero reembolsado por Stripe: el dinero ya volvio a su tarjeta
    IF COALESCE(p_external_refunds, '{}'::JSONB) ? v_pax_text THEN
      v_stripe_skipped := v_stripe_skipped + 1;
      CONTINUE;
    END IF;

    -- 2) Pago con tarjeta sin registro externo (caso extremo): no abonar cartera
    IF lower(COALESCE(v_pax->>'payment_method', 'wallet')) IN ('stripe', 'card', 'credit_card')
       OR NULLIF(trim(v_pax->>'payment_intent_id'), '') IS NOT NULL THEN
      v_stripe_skipped := v_stripe_skipped + 1;
      CONTINUE;
    END IF;

    -- 3) Pago con cartera: liberar la retencion integra
    v_seats := COALESCE(
      NULLIF(v_pax->>'seats_booked', '')::INTEGER,
      NULLIF(v_pax->>'num_seats', '')::INTEGER,
      NULLIF(v_pax->>'seats', '')::INTEGER,
      1
    );
    v_price := COALESCE(NULLIF(v_pax->>'booked_price', '')::NUMERIC, v_ride.price);
    v_amount := round(COALESCE(v_price, 0) * GREATEST(COALESCE(v_seats, 1), 1), 2);

    UPDATE public.wallets
    SET held_balance = round(GREATEST(COALESCE(held_balance, 0) - v_amount, 0), 2),
        balance = round(COALESCE(balance, 0) + v_amount, 2),
        updated_at = NOW()
    WHERE user_id = v_pax_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (v_pax_id, v_amount, 'refund', 'Reembolso total: conductor canceló el viaje', p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride_unified] tx omitida: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.create_notification(
        v_pax_id, 'ride_cancelled', 'Viaje cancelado por el conductor',
        'El conductor canceló el viaje. Has sido reembolsado por completo.',
        jsonb_build_object('ride_id', p_ride_id, 'refunded', v_amount)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride_unified] notif omitida: %', SQLERRM;
    END;

    v_refunded_total := round(v_refunded_total + v_amount, 2);
  END LOOP;

  -- Penalizacion al conductor: 50% compensa a pasajeros / 50% plataforma
  IF v_penalty > 0 THEN
    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) - v_penalty, 2), updated_at = NOW()
    WHERE user_id = v_driver_id;

    IF v_active_pax_count > 0 THEN
      v_compensation := round(v_penalty * 0.50, 2);
      v_platform_share := round(v_penalty - v_compensation, 2);

      FOR v_pax IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
        WHERE lower(COALESCE(p->>'status', '')) IN
              ('confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin')
      LOOP
        v_pax_id := NULLIF(COALESCE(v_pax->>'id', v_pax->>'passenger_id', v_pax->>'user_id', ''), '')::UUID;
        IF v_pax_id IS NULL THEN CONTINUE; END IF;
        UPDATE public.wallets
        SET balance = round(COALESCE(balance, 0) + round(v_compensation / v_active_pax_count, 2), 2),
            updated_at = NOW()
        WHERE user_id = v_pax_id;
      END LOOP;
    ELSE
      v_platform_share := v_penalty;
    END IF;

    INSERT INTO public.profiles (id, display_name) VALUES (v_treasury_id, 'Tesoreria ShareWay')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.wallets (user_id, balance, held_balance) VALUES (v_treasury_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets
    SET balance = round(COALESCE(balance, 0) + v_platform_share, 2), updated_at = NOW()
    WHERE user_id = v_treasury_id;

    BEGIN
      INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
      VALUES (v_driver_id, -v_penalty, 'penalty',
        'Penalización: cancelación con pasajeros (' || CASE WHEN v_hours_until_departure < 2 THEN '<2h' ELSE '2-24h' END || ')',
        p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[cancel_ride_unified] tx penalty omitida: %', SQLERRM;
    END;
  END IF;

  UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;

  UPDATE public.ride_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE ride_id = p_ride_id
    AND lower(COALESCE(status, '')) IN ('pending', 'confirmed', 'awaiting_payment');

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE WHEN v_penalty > 0 THEN 'Viaje cancelado con penalización' ELSE 'Viaje cancelado sin cargos' END,
    'penalty_applied', v_penalty,
    'passenger_compensation', v_compensation,
    'platform_share', v_platform_share,
    'refunded_total', v_refunded_total,
    'stripe_refunded_skipped', v_stripe_skipped,
    'affected_passengers', v_active_pax_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_ride_unified(UUID, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride_unified(UUID, TEXT, JSONB, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride_unified(UUID, TEXT, JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride_unified(UUID, TEXT, JSONB, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_ride(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
