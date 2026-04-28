-- ==============================================================================
-- 20260501_INDIVIDUAL_DROPOFF_LOGIC.sql
-- Propósito: Permitir liberar fondos individualmente por cada pasajero entregado.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.complete_passenger_dropoff(
    p_ride_id UUID,
    p_passenger_id UUID
) RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_new_passengers JSONB := '[]'::JSONB;
    v_found BOOLEAN := FALSE;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10;
    v_driver_id UUID;
BEGIN
    -- Bloquear fila del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride_record.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Viaje no encontrado'); END IF;

    v_driver_id := v_ride_record.driver_id;

    -- Recorrer pasajeros para encontrar al específico y actualizar su estado
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF (v_passenger->>'id')::UUID = p_passenger_id THEN
            -- Solo procesar si no estaba ya completado
            IF v_passenger->>'status' != 'completed' THEN
                v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
                v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);

                -- 1. Quitar de garantía del pasajero
                UPDATE public.wallets
                SET held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_booked_price),
                    updated_at = NOW()
                WHERE user_id = p_passenger_id;

                -- 2. Ingresar en saldo del conductor
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0) + v_payout_amount,
                    updated_at = NOW()
                WHERE user_id = v_driver_id;

                -- 3. Registrar transacciones
                INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id)
                VALUES (p_passenger_id, p_passenger_id, -v_booked_price, 'payment_complete', 'Pago realizado: Llegada a destino', p_ride_id);

                INSERT INTO public.transactions (user_id, wallet_id, amount, type, description, related_ride_id)
                VALUES (v_driver_id, v_driver_id, v_payout_amount, 'payout', 'Ingreso: Pasajero entregado', p_ride_id);

                -- Marcar como completado en el JSON
                v_passenger := v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW());
                v_found := TRUE;
            END IF;
        END IF;
        v_new_passengers := v_new_passengers || v_passenger;
    END LOOP;

    IF v_found THEN
        UPDATE public.rides SET passengers = v_new_passengers WHERE id = p_ride_id;

        -- Si todos los pasajeros están 'completed', marcar el viaje entero como 'completed'
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_new_passengers) AS p
            WHERE p->>'status' != 'completed'
        ) THEN
            UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;
        END IF;

        RETURN json_build_object('success', true, 'message', 'Pasajero entregado y pago liberado');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Pasajero no encontrado o ya procesado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
