-- 1. ELIMINACIÓN DE VERSIONES EN CONFLICTO (Nuclear Drop)
DROP FUNCTION IF EXISTS public.complete_ride(p_ride_id UUID);
DROP FUNCTION IF EXISTS public.complete_ride(p_ride_id UUID, p_lat DECIMAL, p_lng DECIMAL);

-- 2. CREACIÓN DE LA FUNCIÓN DEFINITIVA CON AUDITORÍA PARA PASAJEROS
CREATE OR REPLACE FUNCTION public.complete_ride(
    p_ride_id UUID,
    p_lat DECIMAL DEFAULT NULL,
    p_lng DECIMAL DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_total_payout DECIMAL := 0;
    v_payout_neto DECIMAL;
    v_passenger_id UUID;
    v_passenger_price DECIMAL;
BEGIN
    -- Bloqueo de seguridad y obtención de datos del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN json_build_object('success', false, 'error', 'No autorizado: No eres el conductor');
    END IF;

    IF v_ride_record.status = 'completed' THEN
        RETURN json_build_object('success', false, 'error', 'El viaje ya ha sido completado previamente');
    END IF;

    -- Procesar Pasajeros y Liberación de Escrow
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_passenger_price := (v_passenger->>'booked_price')::DECIMAL;

        -- Solo procesamos si el pasajero no canceló
        IF v_passenger->>'status' NOT IN ('cancelled', 'rejected') THEN
            v_total_payout := v_total_payout + v_passenger_price;

            -- 1. Liberar Escrow del pasajero (Wallet -> held_balance)
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_passenger_price),
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- 2. REGISTRO DE TRANSACCIÓN PARA EL PASAJERO (Para que aparezca en su historial)
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, -v_passenger_price, 'ride_payment', 'Pago completado viaje ' || p_ride_id, p_ride_id);

            -- 3. Notificación automática al Pasajero
            INSERT INTO public.notifications (user_id, title, content, type, related_id)
            VALUES (v_passenger_id, 'Viaje Finalizado', 'Has llegado a tu destino. El pago se ha procesado correctamente.', 'success', p_ride_id);
        END IF;
    END LOOP;

    -- Pago Neto al Conductor (90%)
    v_payout_neto := v_total_payout * 0.90;

    IF v_payout_neto > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_payout_neto,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Registro de Transacción para el Conductor
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_payout_neto, 'payout', 'Ingreso neto viaje ' || p_ride_id, p_ride_id);

        -- Notificación de Pago al Conductor
        INSERT INTO public.notifications (user_id, title, content, type, related_id)
        VALUES (v_driver_id, '¡Pago Recibido!', 'Se han abonado ' || v_payout_neto || '€ en tu billetera.', 'payment', p_ride_id);
    END IF;

    -- Marcar viaje como completado oficialmente
    UPDATE public.rides
    SET status = 'completed',
        completed_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'payout', v_payout_neto,
        'message', 'Viaje completado y auditoría generada para todos los usuarios'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
