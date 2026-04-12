-- ========================================================
-- FIX: Pago Instantáneo al Finalizar Viaje
-- Salta el periodo de retención y paga al conductor al momento
-- ========================================================

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10; -- 10% Comisión
    v_total_driver_payout DECIMAL := 0;
    v_driver_id UUID;
BEGIN
    -- 1. Bloqueo y obtención de datos del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado';
    END IF;

    -- Validar que el viaje esté iniciado
    IF v_ride_record.status NOT IN ('active', 'in_progress') THEN
        RAISE EXCEPTION 'Solo puedes completar un viaje que esté iniciado (actual: %)', v_ride_record.status;
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- 2. Procesar cada pasajero para transferir fondos
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        -- Solo pagamos por pasajeros que subieron al coche (verificados)
        IF v_passenger->>'status' IN ('verified', 'on_board', 'confirmed_by_pin') THEN
            v_passenger_id := (v_passenger->>'id')::UUID;
            v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
            v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);

            -- A. Descontar del held_balance del PASAJERO
            UPDATE public.wallets
            SET held_balance = held_balance - v_booked_price,
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- B. Sumar al balance disponible del CONDUCTOR
            UPDATE public.wallets
            SET balance = balance + v_payout_amount,
                updated_at = NOW()
            WHERE user_id = v_driver_id;

            -- C. Registrar transacciones
            -- Para el pasajero (Gasto finalizado)
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, -v_booked_price, 'payment_complete', 'Viaje completado correctamente', p_ride_id);

            -- Para el conductor (Ingreso por viaje)
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_driver_id, v_payout_amount, 'payout', 'Ingreso por viaje finalizado (Neto)', p_ride_id);

            v_total_driver_payout := v_total_driver_payout + v_payout_amount;
        END IF;
    END LOOP;

    -- 3. Actualizar estado del viaje y pasajeros a 'completed'
    UPDATE public.rides
    SET 
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW(),
        passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN p->>'status' IN ('verified', 'on_board', 'confirmed_by_pin') 
                    THEN p || '{"status": "completed"}'::jsonb
                    ELSE p 
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        )
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Viaje completado. Saldo transferido al conductor.',
        'payout_total', v_total_driver_payout
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
