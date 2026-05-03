-- ==========================================
-- 20260510_FIX_COMPLETE_RIDE_TREASURY.sql
-- Asegura que las comisiones de plataforma lleguen a la Tesorería.
-- ==========================================

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
    -- 1. Bloqueo y verificación
    SELECT status INTO v_ride_status FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Viaje no encontrado o no eres el conductor');
    END IF;

    IF v_ride_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este viaje ya fue liquidado anteriormente');
    END IF;

    -- 2. Procesamiento de pasajeros
    FOR v_passenger IN
        SELECT (p->>'id')::UUID as id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) as price,
               COALESCE((p->>'seats_booked')::INTEGER, (p->>'num_seats')::INTEGER, 1) as seats,
               (p->>'status') as status
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE r.id = p_ride_id
    LOOP
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
        BEGIN
            IF v_passenger.status = 'verified' THEN
                DECLARE
                    v_net_payout NUMERIC := v_subtotal * 0.90; -- 90% Conductor
                    v_fee NUMERIC := v_subtotal * 0.10;        -- 10% Plataforma
                BEGIN
                    -- A. Pago al conductor
                    UPDATE public.wallets
                    SET balance = balance + v_net_payout
                    WHERE user_id = v_driver_id;

                    -- B. Pago a Tesorería (Plataforma)
                    UPDATE public.wallets
                    SET balance = balance + v_fee
                    WHERE user_id = v_treasury_id;

                    -- C. Descuento del saldo retenido del pasajero
                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, held_balance - v_subtotal)
                    WHERE user_id = v_passenger.id;

                    -- Historial
                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso por viaje finalizado');

                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_treasury_id, v_fee, 'fee', p_ride_id, 'Comisión plataforma: Viaje ' || p_ride_id);

                    v_total_payout := v_total_payout + v_net_payout;
                    v_platform_fee_total := v_platform_fee_total + v_fee;
                END;
            ELSE
                -- DEVOLUCIÓN: Si no subió, devolvemos el total
                UPDATE public.wallets
                SET balance = balance + v_subtotal,
                    held_balance = GREATEST(0, held_balance - v_subtotal)
                WHERE user_id = v_passenger.id;

                INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                VALUES (v_passenger.id, v_subtotal, 'refund', p_ride_id, 'Devolución: Pasajero no verificado en el viaje');
            END IF;
        END;
    END LOOP;

    -- 3. Cierre
    UPDATE public.rides
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'payout', v_total_payout,
        'fee', v_platform_fee_total,
        'message', 'Viaje finalizado y saldos liquidados a Tesorería correctamente'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
