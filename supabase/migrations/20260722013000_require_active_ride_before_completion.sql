-- Prevent settlement and completion before the driver has started the ride.
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_total_payout NUMERIC := 0;
    v_platform_fee_total NUMERIC := 0;
    v_ride_status TEXT;
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    IF v_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
    END IF;

    SELECT status INTO v_ride_status
    FROM public.rides
    WHERE id = p_ride_id
      AND driver_id = v_driver_id
    FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autorizado o viaje no encontrado');
    END IF;

    IF v_ride_status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Solo se puede completar un viaje iniciado (Estado actual: ' || v_ride_status || ')'
        );
    END IF;

    FOR v_passenger IN
        SELECT (p->>'id')::UUID AS id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) AS price,
               COALESCE((p->>'seats_booked')::INTEGER, (p->>'num_seats')::INTEGER, 1) AS seats,
               p->>'status' AS status
        FROM public.rides r,
             jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) p
        WHERE r.id = p_ride_id
    LOOP
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
            v_net_payout NUMERIC;
            v_fee NUMERIC;
        BEGIN
            IF v_passenger.status = 'verified' THEN
                v_net_payout := v_subtotal * 0.90;
                v_fee := v_subtotal * 0.10;

                UPDATE public.wallets
                SET balance = COALESCE(balance, 0.00) + v_net_payout,
                    updated_at = NOW()
                WHERE user_id = v_driver_id;

                UPDATE public.wallets
                SET held_balance = GREATEST(0, COALESCE(held_balance, 0.00) - v_subtotal),
                    updated_at = NOW()
                WHERE user_id = v_passenger.id;

                UPDATE public.wallets
                SET balance = COALESCE(balance, 0.00) + v_fee,
                    updated_at = NOW()
                WHERE user_id = v_treasury_id;

                INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso finalización viaje');

                INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                VALUES (v_treasury_id, v_fee, 'fee', p_ride_id, 'Comisión servicio trayecto');

                v_total_payout := v_total_payout + v_net_payout;
                v_platform_fee_total := v_platform_fee_total + v_fee;
            ELSIF v_passenger.status = 'confirmed' THEN
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0) + v_subtotal,
                    held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_subtotal),
                    updated_at = NOW()
                WHERE user_id = v_passenger.id;
            END IF;
        END;
    END LOOP;

    UPDATE public.rides
    SET status = 'completed',
        updated_at = NOW(),
        completed_at = NOW()
    WHERE id = p_ride_id
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El viaje cambió de estado durante la finalización';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'completed',
        'ride_id', p_ride_id,
        'completed_at', NOW(),
        'payout', v_total_payout,
        'fee', v_platform_fee_total
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;
