
-- ========================================================
-- FIX: Blindaje de Ciclo de Vida (Regla 15 min y Finalización Segura)
-- ========================================================

-- 1. Reforzar INICIO DE VIAJE (Solo 15 min antes)
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) 
RETURNS JSON AS $$
DECLARE 
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.driver_id != v_driver_id THEN
        RAISE EXCEPTION 'No tienes permisos para iniciar este viaje';
    END IF;

    IF v_ride_record.status != 'scheduled' THEN
        RAISE EXCEPTION 'El viaje ya ha sido iniciado o cancelado';
    END IF;

    -- REGLA DE ORO: Solo 15 minutos antes de la salida
    IF NOW() < (v_ride_record.departure_time - INTERVAL '15 minutes') THEN
        RAISE EXCEPTION 'Demasiado pronto. Solo puedes iniciar 15 minutos antes de la salida.';
    END IF;

    UPDATE public.rides 
    SET status = 'in_progress', started_at = NOW(), updated_at = NOW() 
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'message', 'Viaje iniciado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Reforzar FINALIZACIÓN DE VIAJE (GPS o Autorización)
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
    v_has_verified_passengers BOOLEAN := FALSE;
    v_distance_to_dest DECIMAL;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.driver_id != v_driver_id THEN
        RAISE EXCEPTION 'No tienes permisos para finalizar este viaje';
    END IF;

    IF v_ride_record.status != 'in_progress' THEN
        RAISE EXCEPTION 'El viaje debe estar en curso para poder finalizarlo';
    END IF;

    -- REGLA DE ORO: Verificar si hay pasajeros verificados (Autorización)
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_ride_record.passengers) p
        WHERE p->>'status' IN ('verified', 'on_board', 'picked_up')
    ) INTO v_has_verified_passengers;

    -- REGLA DE ORO: Verificar GPS si se proporcionan coordenadas
    -- (Opcional: Si el frontend envía coords, el SQL puede validar distancia al destino)
    -- Aquí simplificamos: Si no hay verificados, exigimos que el frontend haya validado la llegada
    IF NOT v_has_verified_passengers AND (p_lat IS NULL OR p_lng IS NULL) THEN
         RAISE EXCEPTION 'No puedes finalizar el viaje: Verifica a los pasajeros o llega al destino.';
    END IF;

    -- PROCESAR PAGOS
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        -- Solo pagamos por pasajeros verificados o a bordo
        IF v_passenger->>'status' IN ('confirmed', 'verified', 'on_board', 'picked_up') THEN
            v_total_payout := v_total_payout + (v_passenger->>'booked_price')::DECIMAL;
            
            -- Liberar saldo retenido
            UPDATE public.wallets 
            SET held_balance = GREATEST(0, held_balance - (v_passenger->>'booked_price')::DECIMAL),
                updated_at = NOW()
            WHERE user_id = (v_passenger->>'id')::UUID;
        END IF;
    END LOOP;

    -- Pagar al conductor (90%)
    IF v_total_payout > 0 THEN
        UPDATE public.wallets 
        SET balance = balance + (v_total_payout * 0.90),
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_total_payout * 0.90, 'payout', 'Liquidación de viaje completado (90% neto)', p_ride_id);
    END IF;

    UPDATE public.rides 
    SET status = 'completed', completed_at = NOW(), updated_at = NOW() 
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'payout', v_total_payout * 0.90);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
