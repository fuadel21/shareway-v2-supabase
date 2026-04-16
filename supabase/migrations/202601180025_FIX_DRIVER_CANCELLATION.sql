
-- ========================================================
-- FIX: Función de Cancelación de Viaje por parte del Conductor
-- ========================================================

CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
BEGIN
    -- 1. Obtener y bloquear el viaje
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado';
    END IF;

    IF v_ride_record.driver_id != v_driver_id THEN
        RAISE EXCEPTION 'Solo el conductor puede cancelar este viaje';
    END IF;

    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'El viaje ya ha finalizado o ya está cancelado';
    END IF;

    -- 2. Devolver dinero a TODOS los pasajeros confirmados
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_booked_price := (v_passenger->>'booked_price')::DECIMAL;

        IF v_passenger->>'status' NOT IN ('cancelled', 'refunded') THEN
            -- Devolvemos el 100% (Held -> Balance)
            UPDATE public.wallets 
            SET held_balance = GREATEST(0, held_balance - v_booked_price),
                balance = balance + v_booked_price,
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- Registrar transacción de devolución
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso total: Viaje cancelado por el conductor', p_ride_id);
        END IF;
    END LOOP;

    -- 3. Marcar el viaje como cancelado
    UPDATE public.rides 
    SET status = 'cancelled', 
        updated_at = NOW() 
    WHERE id = p_ride_id;

    RETURN json_build_object(
        'success', true, 
        'message', 'Viaje cancelado y reembolsos procesados a todos los pasajeros'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.cancel_ride IS 'Permite al conductor cancelar el viaje, devolviendo automáticamente el 100% del dinero a todos los pasajeros.';
