-- ========================================================
-- MIGRACIÓN: STATE MACHINE REFACTOR V5 (Fase 3) - REEMBOLSO DE EXPIRADOS
-- Objetivo: Auto-Cleanup inteligente y protección de fondos de pasajeros
-- ========================================================

CREATE OR REPLACE FUNCTION public.run_manual_maintenance_tasks() 
RETURNS JSON AS $$
DECLARE
    v_ride RECORD;
    v_p RECORD;
    v_cancelled_count INTEGER := 0;
    v_total_payout DECIMAL := 0;
BEGIN
    -- ESCENARIO 1: Viajes que NUNCA empezaron (Scheduled y pasaron >6h)
    FOR v_ride IN 
        SELECT id, passengers FROM public.rides 
        WHERE status = 'scheduled' 
        AND departure_time < (NOW() - INTERVAL '6 hours')
    LOOP
        FOR v_p IN SELECT (p->>'id')::UUID as pid, (p->>'booked_price')::DECIMAL as price
                   FROM jsonb_array_elements(v_ride.passengers) p
                   WHERE p->>'status' IN ('confirmed', 'pending') LOOP
            
            -- Reembolso íntegro
            UPDATE public.wallets 
            SET balance = balance + v_p.price, held_balance = held_balance - v_p.price 
            WHERE user_id = v_p.pid;

            INSERT INTO public.transactions (user_id, amount, balance_after, type, description, related_ride_id)
            SELECT user_id, v_p.price, balance, 'refund', 'Reembolso: Viaje caducado (no iniciado)', v_ride.id
            FROM public.wallets WHERE user_id = v_p.pid;
        END LOOP;

        UPDATE public.rides SET status = 'expired' WHERE id = v_ride.id;
        v_cancelled_count := v_cancelled_count + 1;
    END LOOP;

    -- ESCENARIO 2: Viajes que empezaron pero NUNCA se cerraron (Active y pasaron >12h)
    FOR v_ride IN 
        SELECT id, passengers, driver_id FROM public.rides 
        WHERE status = 'active' 
        AND departure_time < (NOW() - INTERVAL '12 hours')
    LOOP
        v_total_payout := 0;

        FOR v_p IN SELECT (p->>'id')::UUID as pid, (p->>'booked_price')::DECIMAL as price, (p->>'status') as stat
                   FROM jsonb_array_elements(v_ride.passengers) p LOOP
            
            -- CASO A: Pasajero verificado (subió al coche)
            IF v_p.stat = 'verified' THEN
                -- Liberamos el held_balance y lo sumamos al total del conductor
                UPDATE public.wallets SET held_balance = held_balance - v_p.price WHERE user_id = v_p.pid;
                v_total_payout := v_total_payout + v_p.price;
            
            -- CASO B: Pasajero NO verificado (nunca subió o el PIN falló)
            ELSIF v_p.stat = 'confirmed' THEN
                -- REEMBOLSO DE SEGURIDAD: Como no hubo PIN, devolvemos el dinero al pasajero
                UPDATE public.wallets SET balance = balance + v_p.price, held_balance = held_balance - v_p.price WHERE user_id = v_p.pid;
                
                INSERT INTO public.transactions (user_id, amount, balance_after, type, description, related_ride_id)
                SELECT user_id, v_p.price, balance, 'refund', 'Reembolso: Viaje abandonado (sin verificación de PIN)', v_ride.id
                FROM public.wallets WHERE user_id = v_p.pid;
            END IF;
        END LOOP;

        -- Pagar al conductor solo por los pasajeros verificados
        IF v_total_payout > 0 THEN
            UPDATE public.wallets SET balance = balance + v_total_payout WHERE user_id = v_ride.driver_id;
            
            INSERT INTO public.transactions (user_id, amount, balance_after, type, description, related_ride_id)
            SELECT user_id, v_total_payout, balance, 'payout', 'Pago parcial: Viaje finalizado por sistema (Solo verificados)', v_ride.id
            FROM public.wallets WHERE user_id = v_ride.driver_id;
        END IF;

        UPDATE public.rides SET status = 'completed' WHERE id = v_ride.id;
        v_cancelled_count := v_cancelled_count + 1;
    END LOOP;

    RETURN json_build_object('success', true, 'processed_rides', v_cancelled_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
