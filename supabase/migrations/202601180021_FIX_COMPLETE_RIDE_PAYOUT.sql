
-- ========================================================
-- FIX: Finalización de viaje con reparto de pagos y comisiones (10%)
-- Versión Blindada (Rescue SQL v2)
-- ========================================================

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_gross_amount DECIMAL := 0;
    v_platform_fee_percent DECIMAL := 0.10; -- 10% de comisión
    v_platform_fee_amount DECIMAL := 0;
    v_net_driver_payout DECIMAL := 0;
    v_p_id_text TEXT;
    v_p_id UUID;
    v_booked_price DECIMAL;
BEGIN
    -- 1. Bloquear viaje y validar que el llamante sea el conductor
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN json_build_object('success', false, 'message', 'No eres el conductor de este viaje');
    END IF;

    IF v_ride_record.status = 'completed' THEN
        RETURN json_build_object('success', true, 'message', 'El viaje ya estaba completado');
    END IF;

    -- 2. Procesar cada pasajero para calcular el pago total
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        v_p_id_text := v_passenger->>'id';
        v_booked_price := COALESCE((v_passenger->>'booked_price')::DECIMAL, 0);

        -- Validación de UUID por Regex para evitar errores de casting
        IF v_p_id_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
            v_p_id := v_p_id_text::UUID;

            -- Solo sumamos pasajeros que NO hayan cancelado
            IF v_passenger->>'status' NOT IN ('cancelled', 'refunded') THEN
                v_gross_amount := v_gross_amount + v_booked_price;

                -- Descontar del 'held_balance' (dinero en custodia)
                UPDATE public.wallets
                SET held_balance = GREATEST(0, held_balance - v_booked_price),
                    updated_at = NOW()
                WHERE user_id = v_p_id;
            END IF;
        END IF;
    END LOOP;

    -- 3. Calcular Comisiones
    v_platform_fee_amount := v_gross_amount * v_platform_fee_percent;
    v_net_driver_payout := v_gross_amount - v_platform_fee_amount;

    -- 4. Pagar al Conductor
    IF v_net_driver_payout > 0 THEN
        UPDATE public.wallets 
        SET balance = balance + v_net_driver_payout,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Registro de ingreso para el conductor (Neto)
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_net_driver_payout, 'payout', 'Ingreso por viaje completado (Neto)', p_ride_id);
    END IF;

    -- 5. Finalizar Viaje
    UPDATE public.rides 
    SET status = 'completed', 
        completed_at = NOW(), 
        updated_at = NOW() 
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true, 
        'gross_collected', v_gross_amount,
        'platform_fee', v_platform_fee_amount,
        'driver_net_payout', v_net_driver_payout
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.complete_ride IS 'Finaliza el viaje blindado, calcula la comisión del 10% y paga el 90% al conductor.';
