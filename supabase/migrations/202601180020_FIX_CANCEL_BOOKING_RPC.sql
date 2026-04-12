-- ========================================================
-- FIX: Función para cancelar reserva de pasajero con reembolso
-- ========================================================

CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_passenger_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_booked_price DECIMAL;
    v_refund_amount DECIMAL;
    v_penalty_amount DECIMAL;
    v_penalty_percent DECIMAL := 0.20; -- 20% de penalización según UI
BEGIN
    -- 1. Bloquear y obtener datos del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado';
    END IF;

    -- 2. Buscar al pasajero en el array de pasajeros
    SELECT p INTO v_passenger_entry 
    FROM jsonb_array_elements(v_ride_record.passengers) AS p 
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' != 'cancelled';

    IF v_passenger_entry IS NULL THEN
        RAISE EXCEPTION 'No tienes una reserva activa en este viaje';
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    v_penalty_amount := v_booked_price * v_penalty_percent;
    v_refund_amount := v_booked_price - v_penalty_amount;

    -- 3. Procesar Reembolso en la Wallet
    UPDATE public.wallets
    SET 
        held_balance = held_balance - v_booked_price,
        balance = balance + v_refund_amount,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- 4. Registrar Transacciones
    -- Registro del reembolso
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, v_refund_amount, 'refund', 'Reembolso por cancelación de reserva (Parcial)', p_ride_id);

    -- Registro de la penalización (informativo)
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_passenger_id, -v_penalty_amount, 'penalty', 'Gasto de gestión por cancelación (20%)', p_ride_id);

    -- 5. Actualizar el Viaje (Eliminar pasajero y liberar asiento)
    UPDATE public.rides
    SET 
        seats_available = seats_available + 1,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN (p->>'id')::UUID = v_passenger_id THEN p || '{"status": "cancelled", "cancelled_at": "' || NOW() || '"}'::jsonb
                    ELSE p 
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        ),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Reserva cancelada y reembolso procesado',
        'refunded', v_refund_amount,
        'penalty', v_penalty_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario para auditoría
COMMENT ON FUNCTION public.cancel_booking_and_refund IS 'Cancela la reserva de un pasajero, libera el asiento y procesa el reembolso parcial (80%)';
