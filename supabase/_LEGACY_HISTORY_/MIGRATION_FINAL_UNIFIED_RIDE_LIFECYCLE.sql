-- ========================================================
-- MIGRACIÓN: UNIFICACIÓN DEFINITIVA DEL CICLO DE VIDA v1.0
-- Objetivo: Unificar estados, asegurar pagos y blindar integridad financiera.
-- ========================================================

-- 1. RESTRICCIÓN DE INTEGRIDAD DE WALLET (Saldos Negativos Prohibidos)
CREATE OR REPLACE FUNCTION public.validate_wallet_integrity()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.balance + NEW.held_balance) < 0 THEN
        RAISE EXCEPTION 'INTEGRITY_ERROR: Saldo insuficiente total.';
    END IF;
    IF NEW.balance < 0 THEN
        RAISE EXCEPTION 'INTEGRITY_ERROR: El balance disponible no puede ser negativo.';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_wallet_integrity ON public.wallets;
CREATE TRIGGER tr_wallet_integrity 
BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.validate_wallet_integrity();

-- 2. UNIFICACIÓN DE ESTADOS EN START_RIDE
-- Estado oficial: scheduled -> active
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
BEGIN
    UPDATE public.rides
    SET status = 'active'
    WHERE id = p_ride_id 
      AND driver_id = v_driver_id 
      AND status = 'scheduled';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se puede iniciar el viaje: debe estar programado y ser tú el conductor.';
    END IF;

    -- Notificar a todos los participantes
    PERFORM public.create_notification(
        p.id,
        '¡Viaje en marcha!',
        'El conductor ha iniciado el trayecto. ¡Buen viaje!',
        'ride_start',
        jsonb_build_object('ride_id', p_ride_id)
    )
    FROM (SELECT unnest(participant_ids) as id FROM public.rides WHERE id = p_ride_id) p
    WHERE p.id != v_driver_id;

    RETURN json_build_object('success', true, 'status', 'active');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. BLINDAJE DE CANCEL_RIDE (Prohibido si ya inició)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_passengers JSONB;
BEGIN
    -- Bloqueo: Solo se puede cancelar si no ha empezado (scheduled)
    SELECT passengers INTO v_passengers
    FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'scheduled'
    FOR UPDATE;

    IF v_passengers IS NULL THEN
        RAISE EXCEPTION 'No puedes cancelar un viaje que ya está activo o completado. Contacta con soporte.';
    END IF;

    -- Reembolsar a todos (confirmados y pendientes)
    FOR v_passenger IN 
        SELECT (p->>'id')::UUID as pid, (p->>'booked_price')::DECIMAL as price
        FROM jsonb_array_elements(v_passengers) p
        WHERE p->>'status' IN ('confirmed', 'pending') 
    LOOP
        UPDATE public.wallets
        SET balance = balance + v_passenger.price,
            held_balance = held_balance - v_passenger.price
        WHERE user_id = v_passenger.pid;

        INSERT INTO public.transactions (wallet_id, user_id, type, amount, description, related_ride_id)
        VALUES (v_passenger.pid, v_passenger.pid, 'refund', v_passenger.price, 'Viaje cancelado por el conductor', p_ride_id);
    END LOOP;

    UPDATE public.rides
    SET status = 'cancelled',
        cancelled_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'message', 'Viaje cancelado y pasajeros reembolsados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. REFINAMIENTO DE COMPLETE_RIDE (Pago solo por mérito)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride RECORD;
    v_passenger RECORD;
    v_total_payout DECIMAL := 0;
BEGIN
    SELECT * INTO v_ride FROM public.rides 
    WHERE id = p_ride_id AND driver_id = v_driver_id AND status = 'active'
    FOR UPDATE;

    IF v_ride.id IS NULL THEN
        RAISE EXCEPTION 'Viaje no encontrado o no está en curso.';
    END IF;

    -- Procesar pagos
    FOR v_passenger IN 
        SELECT (p->>'id')::UUID as pid, (p->>'booked_price')::DECIMAL as price, (p->>'status') as stat
        FROM jsonb_array_elements(v_ride.passengers) p
    LOOP
        -- SOLO PAGAMOS POR: Verificados (subieron) o No-Show (el conductor cumplió su parte)
        IF v_passenger.stat IN ('verified', 'no_show') THEN
            UPDATE public.wallets
            SET held_balance = held_balance - v_passenger.price
            WHERE user_id = v_passenger.pid;

            v_total_payout := v_total_payout + (v_passenger.price * 0.85); -- 15% Comisión
        
        -- Si estaba confirmado pero nunca se verificó, devolvemos el dinero al pasajero (Penalización al conductor por no usar el PIN)
        ELSIF v_passenger.stat = 'confirmed' THEN
            UPDATE public.wallets
            SET balance = balance + v_passenger.price,
                held_balance = held_balance - v_passenger.price
            WHERE user_id = v_passenger.pid;
        END IF;
    END LOOP;

    -- Pago final al conductor
    IF v_total_payout > 0 THEN
        UPDATE public.wallets SET balance = balance + v_total_payout WHERE user_id = v_driver_id;
        INSERT INTO public.transactions (wallet_id, user_id, type, amount, description, related_ride_id)
        VALUES (v_driver_id, v_driver_id, 'ride_earning', v_total_payout, 'Ganancia viaje completado', p_ride_id);
    END IF;

    UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
