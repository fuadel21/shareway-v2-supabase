-- ============================================================================
-- SHAREWAY · FIX_COMPLETE_RIDE_DOUBLE_PAY.sql
-- ============================================================================
-- Bug: si el conductor usaba complete_passenger_dropoff (entrega por parada)
-- y luego complete_ride, el conductor cobraba DOS veces: complete_ride vuelve
-- a liquidar a los pasajeros con status 'completed' (ya pagados por dropoff).
--
-- Fix: complete_ride solo liquida a pasajeros 'verified' (embarcados sin
-- entrega individual). Los 'completed' (ya liquidados por dropoff) se
-- guardan en el total informativo pero NO se vuelven a pagar.
-- Es IDEMPOTENTE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride_status TEXT;
  v_passenger JSONB;
  v_passenger_id TEXT;
  v_passenger_id_uuid UUID;
  v_status TEXT;
  v_price NUMERIC;
  v_seats INTEGER;
  v_subtotal NUMERIC;
  v_net_payout NUMERIC;
  v_fee NUMERIC;
  v_total_payout NUMERIC := 0;
  v_platform_fee_total NUMERIC := 0;
  v_already_settled_count INTEGER := 0;
  v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
  v_wallet_updated INTEGER;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT lower(COALESCE(status, ''))
    INTO v_ride_status
  FROM public.rides
  WHERE id = p_ride_id
    AND driver_id = v_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado o viaje no encontrado');
  END IF;

  IF v_ride_status NOT IN ('active', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solo se puede completar un viaje iniciado (Estado actual: ' || v_ride_status || ')');
  END IF;

  FOR v_passenger IN
    SELECT value
    FROM public.rides AS ride,
         jsonb_array_elements(COALESCE(ride.passengers, '[]'::jsonb))
    WHERE ride.id = p_ride_id
  LOOP
    v_passenger_id := NULLIF(TRIM(COALESCE(
      v_passenger->>'id',
      v_passenger->>'passenger_id',
      v_passenger->>'user_id', '')), '');

    v_status := lower(TRIM(COALESCE(v_passenger->>'status', 'confirmed')));

    IF v_status IN ('cancelled', 'canceled', 'rejected', 'no_show') THEN
      CONTINUE;
    END IF;

    IF v_passenger_id IS NULL THEN
      RAISE EXCEPTION 'PASSENGER_ID_REQUIRED_FOR_SETTLEMENT';
    END IF;

    BEGIN
      v_passenger_id_uuid := v_passenger_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_PASSENGER_ID_FOR_SETTLEMENT';
    END;

    -- Ya liquidado por dropoff individual: NO volver a pagar
    IF v_status = 'completed' THEN
      v_already_settled_count := v_already_settled_count + 1;
      CONTINUE;
    END IF;

    DECLARE
      v_price_text TEXT := TRIM(COALESCE(
        v_passenger->>'booked_price',
        v_passenger->>'price_per_seat',
        v_passenger->>'price', '0'));
      v_seats_text TEXT := TRIM(COALESCE(
        v_passenger->>'seats_booked',
        v_passenger->>'num_seats',
        v_passenger->>'seats',
        v_passenger->>'seat_count', '1'));
    BEGIN
      IF v_price_text ~ '^[0-9]+([.][0-9]+)?$' THEN
        v_price := round(v_price_text::NUMERIC, 2);
      ELSE
        RAISE EXCEPTION 'INVALID_PASSENGER_PRICE_FOR_SETTLEMENT';
      END IF;

      IF v_seats_text ~ '^[0-9]+$' THEN
        v_seats := GREATEST(v_seats_text::INTEGER, 1);
      ELSE
        RAISE EXCEPTION 'INVALID_PASSENGER_SEATS_FOR_SETTLEMENT';
      END IF;

      v_subtotal := round(v_price * v_seats, 2);
      IF v_subtotal < 0 THEN
        RAISE EXCEPTION 'NEGATIVE_PASSENGER_SETTLEMENT';
      END IF;

      IF v_status = 'verified' THEN
        -- Solo el pasajero VERIFICADO con PIN genera pago al conductor.
        v_net_payout := round(v_subtotal * 0.90, 2);
        v_fee := v_subtotal - v_net_payout;

        UPDATE public.wallets
        SET balance = COALESCE(balance, 0) + v_net_payout, updated_at = NOW()
        WHERE user_id = v_driver_id;
        GET DIAGNOSTICS v_wallet_updated = ROW_COUNT;
        IF v_wallet_updated <> 1 THEN
          RAISE EXCEPTION 'DRIVER_WALLET_MISSING';
        END IF;

        UPDATE public.wallets
        SET held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_subtotal), updated_at = NOW()
        WHERE user_id = v_passenger_id_uuid;
        GET DIAGNOSTICS v_wallet_updated = ROW_COUNT;
        IF v_wallet_updated <> 1 THEN
          RAISE EXCEPTION 'PASSENGER_WALLET_MISSING';
        END IF;

        INSERT INTO public.profiles (id, display_name) VALUES (v_treasury_id, 'Tesoreria ShareWay')
          ON CONFLICT (id) DO NOTHING;
        INSERT INTO public.wallets (user_id, balance, held_balance) VALUES (v_treasury_id, 0, 0)
          ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.wallets
        SET balance = COALESCE(balance, 0) + v_fee, updated_at = NOW()
        WHERE user_id = v_treasury_id;

        BEGIN
          INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
          VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso finalización viaje');
          INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
          VALUES (v_treasury_id, v_fee, 'fee', p_ride_id, 'Comisión servicio trayecto');
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[complete_ride] tx omitida: %', SQLERRM;
        END;

        v_total_payout := v_total_payout + v_net_payout;
        v_platform_fee_total := v_platform_fee_total + v_fee;

        -- Notificar al pasajero la liquidación
        BEGIN
          PERFORM public.create_notification(
            v_passenger_id_uuid, 'payment_complete', 'Pago realizado',
            'Llegada a destino confirmada. El conductor ha recibido su importe.',
            jsonb_build_object('ride_id', p_ride_id)
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[complete_ride] notif omitida: %', SQLERRM;
        END;
      ELSIF v_status IN ('confirmed', 'accepted', 'pending_boarding') THEN
        -- Pasajero que NO verifico su PIN al abordar: reembolso integro,
        -- el conductor no cobra por el (politica de verificacion).
        UPDATE public.wallets
        SET balance = round(COALESCE(balance, 0) + v_subtotal, 2),
            held_balance = round(GREATEST(COALESCE(held_balance, 0) - v_subtotal, 0), 2),
            updated_at = NOW()
        WHERE user_id = v_passenger_id_uuid;

        BEGIN
          INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
          VALUES (v_passenger_id_uuid, v_subtotal, 'refund', 'Reembolso: pasajero sin verificar al finalizar', p_ride_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[complete_ride] tx reembolso omitida: %', SQLERRM;
        END;

        BEGIN
          PERFORM public.create_notification(
            v_passenger_id_uuid, 'booking_refund', 'Reserva reembolsada',
            'No se verificó tu PIN durante el viaje. Se ha devuelto tu importe completo.',
            jsonb_build_object('ride_id', p_ride_id)
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[complete_ride] notif omitida: %', SQLERRM;
        END;
      ELSE
        RAISE EXCEPTION 'UNSUPPORTED_PASSENGER_STATUS_FOR_SETTLEMENT: %', v_status;
      END IF;
    END;
  END LOOP;

  UPDATE public.rides
  SET status = 'completed',
      updated_at = NOW(),
      completed_at = NOW()
  WHERE id = p_ride_id
    AND status IN ('active', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje cambió de estado durante la finalización';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'ride_id', p_ride_id,
    'completed_at', NOW(),
    'payout', v_total_payout,
    'fee', v_platform_fee_total,
    'already_settled_passengers', v_already_settled_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
