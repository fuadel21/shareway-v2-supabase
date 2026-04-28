-- ==============================================================================
-- SHAREWAY ELITE: PROTOCOLO DE MANTENIMIENTO FINANCIERO AUTOMÁTICO
-- Propósito: Liberar saldos bloqueados en garantía por viajes obsoletos o no finalizados.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.run_financial_maintenance()
RETURNS JSONB AS $$
DECLARE
    v_expired_scheduled_count INTEGER := 0;
    v_expired_active_count INTEGER := 0;
    v_total_refunded DECIMAL := 0;
BEGIN
    -- 1. LIMPIEZA DE VIAJES PROGRAMADOS QUE NUNCA EMPEZARON (Pasados 6 horas de la salida)
    WITH expired_scheduled AS (
        SELECT id, passengers
        FROM public.rides
        WHERE status = 'scheduled'
          AND departure_time < (NOW() - INTERVAL '6 hours')
        FOR UPDATE
    ),
    refund_scheduled AS (
        UPDATE public.wallets w
        SET balance = w.balance + (p.val->>'booked_price')::DECIMAL,
            held_balance = GREATEST(0, w.held_balance - (p.val->>'booked_price')::DECIMAL),
            updated_at = NOW()
        FROM expired_scheduled e, jsonb_array_elements(e.passengers) AS p(val)
        WHERE w.user_id = (p.val->>'id')::UUID
          AND p.val->>'status' = 'confirmed'
        RETURNING (p.val->>'booked_price')::DECIMAL
    )
    SELECT COUNT(*), COALESCE(SUM(refund_scheduled.booked_price), 0)
    INTO v_expired_scheduled_count, v_total_refunded
    FROM (SELECT (p.val->>'booked_price')::DECIMAL as booked_price FROM expired_scheduled e, jsonb_array_elements(e.passengers) AS p(val)) refund_scheduled;

    UPDATE public.rides SET status = 'expired', updated_at = NOW()
    WHERE id IN (SELECT id FROM expired_scheduled);


    -- 2. LIMPIEZA DE VIAJES "ACTIVOS" PERO OLVIDADOS (Más de 24 horas en estado activo)
    -- En este caso, por seguridad, devolvemos el dinero al pasajero ya que el conductor no cerró el ciclo.
    WITH expired_active AS (
        SELECT id, passengers
        FROM public.rides
        WHERE status IN ('active', 'in_progress')
          AND departure_time < (NOW() - INTERVAL '24 hours')
        FOR UPDATE
    ),
    refund_active AS (
        UPDATE public.wallets w
        SET balance = w.balance + (p.val->>'booked_price')::DECIMAL,
            held_balance = GREATEST(0, w.held_balance - (p.val->>'booked_price')::DECIMAL),
            updated_at = NOW()
        FROM expired_active e, jsonb_array_elements(e.passengers) AS p(val)
        WHERE w.user_id = (p.val->>'id')::UUID
          AND p.val->>'status' IN ('confirmed', 'verified')
        RETURNING (p.val->>'booked_price')::DECIMAL
    )
    SELECT COUNT(*) INTO v_expired_active_count FROM expired_active;

    UPDATE public.rides SET status = 'stale_closed', updated_at = NOW()
    WHERE id IN (SELECT id FROM expired_active);


    RETURN jsonb_build_object(
        'success', true,
        'scheduled_expired_cleaned', v_expired_scheduled_count,
        'active_stale_cleaned', v_expired_active_count,
        'total_amount_released', v_total_refunded
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reemplazar el cleanup antiguo para que use la nueva lógica potente
CREATE OR REPLACE FUNCTION public.cleanup_expired_rides()
RETURNS JSONB AS $$
BEGIN
    RETURN public.run_financial_maintenance();
END;
$$ LANGUAGE plpgsql;
