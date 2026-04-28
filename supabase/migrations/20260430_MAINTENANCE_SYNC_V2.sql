-- ==============================================================================
-- 20260430_MAINTENANCE_SYNC_V2.sql
-- Propósito: Sincronizar expiración con UI (2h) y registrar reembolsos automáticos.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.run_financial_maintenance()
RETURNS JSONB AS $$
DECLARE
    v_expired_scheduled_count INTEGER := 0;
    v_total_refunded DECIMAL := 0;
    v_item RECORD;
BEGIN
    -- 1. PROCESAR VIAJES PROGRAMADOS EXPIRADOS (2 Horas después de la salida)
    -- Iteramos para poder insertar en el historial de transacciones de cada usuario
    FOR v_item IN
        SELECT r.id, r.origin->>'name' as origin_name, p.val->>'id' as passenger_id, (p.val->>'booked_price')::DECIMAL as price
        FROM public.rides r, jsonb_array_elements(r.passengers) AS p(val)
        WHERE r.status = 'scheduled'
          AND r.departure_time < (NOW() - INTERVAL '2 hours')
          AND p.val->>'status' = 'confirmed'
    LOOP
        -- Devolver dinero al pasajero
        UPDATE public.wallets
        SET balance = balance + v_item.price,
            held_balance = GREATEST(0, held_balance - v_item.price),
            updated_at = NOW()
        WHERE user_id = v_item.passenger_id::UUID;

        -- Registrar Transacción para el usuario
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (
            v_item.passenger_id::UUID,
            v_item.price,
            'refund',
            'Reembolso automático: El conductor no inició el viaje (' || v_item.origin_name || ')',
            v_item.id
        );

        -- Notificar al usuario
        INSERT INTO public.notifications (user_id, type, title, body)
        VALUES (
            v_item.passenger_id::UUID,
            'ride_expired',
            'Viaje Expirado',
            'El viaje hacia ' || v_item.origin_name || ' no fue iniciado. Tu dinero ha sido devuelto.'
        );

        v_total_refunded := v_total_refunded + v_item.price;
    END LOOP;

    -- Marcar los viajes como expirados
    WITH to_expire AS (
        SELECT id FROM public.rides
        WHERE status = 'scheduled' AND departure_time < (NOW() - INTERVAL '2 hours')
    )
    UPDATE public.rides SET status = 'expired', updated_at = NOW()
    WHERE id IN (SELECT id FROM to_expire);

    -- Contar cuántos se expiraron en total
    SELECT COUNT(*) INTO v_expired_scheduled_count
    FROM public.rides WHERE status = 'expired' AND updated_at >= (NOW() - INTERVAL '1 minute');

    RETURN jsonb_build_object(
        'success', true,
        'scheduled_expired_cleaned', v_expired_scheduled_count,
        'total_amount_refunded', v_total_refunded,
        'maintenance_time', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
