-- ========================================================
-- 💰 SHAREWAY ELITE - REPARACIÓN DE SOBRECARGA (V15.7)
-- ========================================================

-- 1. ELIMINACIÓN DE VERSIONES EN CONFLICTO (Nuclear Drop)
-- Eliminamos todas las posibles firmas para limpiar la ambigüedad
DROP FUNCTION IF EXISTS public.complete_ride(p_ride_id text);
DROP FUNCTION IF EXISTS public.complete_ride(p_ride_id uuid, p_lat decimal, p_lng decimal);
DROP FUNCTION IF EXISTS public.complete_ride(uuid, decimal, decimal);
DROP FUNCTION IF EXISTS public.complete_ride(uuid);

-- 2. CREACIÓN DE LA FUNCIÓN DEFINITIVA
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

            -- Liberar Escrow del pasajero (Wallet -> held_balance)
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_passenger_price),
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- Notificación automática al Pasajero
            INSERT INTO public.notifications (user_id, title, content, type, related_id)
            VALUES (v_passenger_id, 'Viaje Finalizado', 'Has llegado a tu destino. ¡Esperamos volver a verte!', 'success', p_ride_id);
        END IF;
    END LOOP;

    -- Pago Neto al Conductor (90%)
    v_payout_neto := v_total_payout * 0.90;

    IF v_payout_neto > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_payout_neto,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        -- Registro de Transacción
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
        'message', 'Viaje completado y pagos procesados con éxito'
    );

EXCEPTION WHEN OTHERS THEN
    -- Captura de error para depuración
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
