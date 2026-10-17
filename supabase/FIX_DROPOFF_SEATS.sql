-- ============================================================================
-- SHAREWAY · FIX_DROPOFF_SEATS.sql
-- ============================================================================
-- Bug: complete_passenger_dropoff liquidaba booked_price (precio POR PLAZA)
-- sin multiplicar por las plazas reservadas → en reservas de 2+ plazas el
-- conductor cobraba de menos y quedaba saldo retenido fantasma.
-- Contrato: booked_price = precio por plaza; total = booked_price × seats.
-- Ademas devuelve jsonb (antes texto) y respeta el resto de la logica.
-- Es IDEMPOTENTE.
-- ============================================================================

-- Cambia el tipo de retorno (json -> jsonb): requiere DROP previo
DROP FUNCTION IF EXISTS public.complete_passenger_dropoff(UUID, UUID);

CREATE OR REPLACE FUNCTION public.complete_passenger_dropoff(p_ride_id UUID, p_passenger_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ride RECORD;
  v_passenger JSONB;
  v_new_passengers JSONB := '[]'::JSONB;
  v_found BOOLEAN := FALSE;
  v_already BOOLEAN := FALSE;
  v_price_per_seat NUMERIC;
  v_seats INTEGER;
  v_total NUMERIC;
  v_payout NUMERIC;
  v_fee NUMERIC;
  v_driver_id UUID;
  v_platform_fee_percent NUMERIC := 0.10;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF v_ride.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_ACTIVE',
      'message', 'Solo se pueden finalizar paradas en viajes activos (estado: ' || COALESCE(v_ride.status,'?') || ')');
  END IF;

  v_driver_id := v_ride.driver_id;

  FOR v_passenger IN SELECT * FROM jsonb_array_elements(COALESCE(v_ride.passengers,'[]'::JSONB))
  LOOP
    IF (v_passenger->>'id')::UUID = p_passenger_id THEN
      v_found := TRUE;
      IF lower(COALESCE(v_passenger->>'status','')) = 'completed' THEN
        v_already := TRUE;
        v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
      ELSE
        -- Contrato por-plaza: total = precio_plaza × plazas reservadas
        v_price_per_seat := COALESCE(NULLIF(v_passenger->>'booked_price','')::NUMERIC, COALESCE(v_ride.price,0));
        v_seats := COALESCE(
          NULLIF(v_passenger->>'seats_booked','')::INTEGER,
          NULLIF(v_passenger->>'num_seats','')::INTEGER,
          NULLIF(v_passenger->>'seats','')::INTEGER, 1);
        v_seats := GREATEST(v_seats, 1);
        v_total := round(v_price_per_seat * v_seats, 2);
        v_payout := round(v_total * (1 - v_platform_fee_percent), 2);
        v_fee := round(v_total - v_payout, 2);

        -- Liberar retencion total del pasajero
        UPDATE public.wallets
        SET held_balance = GREATEST(0, COALESCE(held_balance,0) - v_total),
            updated_at = NOW()
        WHERE user_id = p_passenger_id;

        -- Pagar al conductor
        UPDATE public.wallets
        SET balance = round(COALESCE(balance,0) + v_payout, 2),
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Comision a tesoreria
        INSERT INTO public.profiles (id, display_name) VALUES ('00000000-0000-0000-0000-000000000000','Tesoreria ShareWay')
          ON CONFLICT (id) DO NOTHING;
        INSERT INTO public.wallets (user_id, balance, held_balance) VALUES ('00000000-0000-0000-0000-000000000000',0,0)
          ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.wallets
        SET balance = round(COALESCE(balance,0) + v_fee, 2), updated_at = NOW()
        WHERE user_id = '00000000-0000-0000-0000-000000000000';

        -- Historial
        BEGIN
          INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
          VALUES (p_passenger_id, -v_total, 'payment_complete', 'Pago realizado: Llegada a destino', p_ride_id);
          INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
          VALUES (v_driver_id, v_payout, 'payout', 'Ingreso: Pasajero entregado', p_ride_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[dropoff] tx omitida: %', SQLERRM;
        END;

        v_new_passengers := v_new_passengers || jsonb_build_array(
          v_passenger || jsonb_build_object('status','completed','completed_at',NOW())
        );
      END IF;
    ELSE
      v_new_passengers := v_new_passengers || jsonb_build_array(v_passenger);
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('success', false, 'error', 'PASSENGER_NOT_FOUND');
  END IF;

  IF v_already THEN
    RETURN jsonb_build_object('success', true, 'already_settled', true);
  END IF;

  UPDATE public.rides
  SET passengers = v_new_passengers, updated_at = NOW()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_total,
    'driver_payout', v_payout,
    'platform_fee', v_fee
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_passenger_dropoff(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_passenger_dropoff(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_passenger_dropoff(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
