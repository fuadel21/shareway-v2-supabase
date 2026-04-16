
-- ========================================================
-- FIX: Función INTELIGENTE para cancelar reserva con reembolso por tramos horarios
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
    v_refund_percent DECIMAL;
    v_hours_until_departure DECIMAL;
    v_status_msg TEXT;
BEGIN
    -- 1. Bloquear y obtener datos del viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado';
    END IF;

    -- 2. Buscar al pasajero activo
    SELECT p INTO v_passenger_entry 
    FROM jsonb_array_elements(v_ride_record.passengers) AS p 
    WHERE (p->>'id')::UUID = v_passenger_id AND p->>'status' != 'cancelled';

    IF v_passenger_entry IS NULL THEN
        RAISE EXCEPTION 'No tienes una reserva activa en este viaje';
    END IF;

    v_booked_price := (v_passenger_entry->>'booked_price')::DECIMAL;
    
    -- 3. CALCULAR LÓGICA DE TIEMPO
    v_hours_until_departure := EXTRACT(EPOCH FROM (v_ride_record.departure_time - NOW())) / 3600;

    IF v_hours_until_departure < 0 THEN
        -- Viaje caducado o en curso: Reembolso total (Protección plataforma)
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total por viaje caducado';
    ELSIF v_hours_until_departure > 24 THEN
        -- Más de 24h: Reembolso total
        v_refund_percent := 1.0;
        v_status_msg := 'Reembolso total (+24h antelación)';
    ELSIF v_hours_until_departure >= 2 THEN
        -- Entre 2h y 24h: Reembolso 50%
        v_refund_percent := 0.5;
        v_status_msg := 'Reembolso del 50% (2h a 24h antelación)';
    ELSE
        -- Menos de 2h: Sin reembolso
        v_refund_percent := 0.0;
        v_status_msg := 'Sin reembolso (menos de 2h para la salida)';
    END IF;

    v_refund_amount := v_booked_price * v_refund_percent;
    v_penalty_amount := v_booked_price - v_refund_amount;

    -- 4. Procesar Wallet
    UPDATE public.wallets
    SET 
        held_balance = held_balance - v_booked_price,
        balance = balance + v_refund_amount,
        updated_at = NOW()
    WHERE user_id = v_passenger_id;

    -- 5. Registrar Transacciones (Solo si hay montos)
    IF v_refund_amount > 0 THEN
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_passenger_id, v_refund_amount, 'refund', v_status_msg, p_ride_id);
    END IF;

    IF v_penalty_amount > 0 THEN
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_passenger_id, -v_penalty_amount, 'penalty', 'Cargo por cancelación tardía', p_ride_id);
    END IF;

    -- 6. Actualizar el Viaje
    UPDATE public.rides
    SET 
        seats_available = seats_available + 1,
        participant_ids = array_remove(participant_ids, v_passenger_id),
        passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN (p->>'id')::UUID = v_passenger_id THEN 
                        p || jsonb_build_object('status', 'cancelled', 'cancelled_at', NOW(), 'refund_processed', v_refund_amount)
                    ELSE p 
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        ),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true,
        'message', v_status_msg,
        'refunded', v_refund_amount,
        'penalty', v_penalty_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
