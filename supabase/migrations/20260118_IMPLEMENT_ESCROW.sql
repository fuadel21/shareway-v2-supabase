-- ========================================================
-- FIX CRÍTICO: Sistema de Escrow para Fondos
-- Retener fondos durante 7 días por posibles disputas
-- ========================================================

-- 1. Modificar tabla de wallets para incluir escrow
DO $$
BEGIN
    -- Añadir columna de escrow si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'wallets' 
        AND column_name = 'escrow_balance'
    ) THEN
        ALTER TABLE public.wallets 
        ADD COLUMN escrow_balance NUMERIC(10, 2) DEFAULT 0.00;
    END IF;
    
    -- Añadir columna de fecha de liberación
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'wallets' 
        AND column_name = 'escrow_release_date'
    ) THEN
        ALTER TABLE public.wallets 
        ADD COLUMN escrow_release_date TIMESTAMPTZ;
    END IF;
END $$;

-- 2. Función para mover fondos a escrow
CREATE OR REPLACE FUNCTION public.move_to_escrow(
    p_user_id UUID,
    p_amount DECIMAL,
    p_release_days INTEGER DEFAULT 7
) RETURNS JSON AS $$
DECLARE
    v_current_balance DECIMAL;
    v_release_date TIMESTAMPTZ;
BEGIN
    -- Verificar balance disponible
    SELECT balance INTO v_current_balance
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF v_current_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente para mover a escrow';
    END IF;
    
    -- Calcular fecha de liberación
    v_release_date := NOW() + (p_release_days || ' days')::INTERVAL;
    
    -- Mover fondos de held_balance a escrow_balance
    UPDATE public.wallets
    SET 
        held_balance = held_balance - p_amount,
        escrow_balance = escrow_balance + p_amount,
        escrow_release_date = GREATEST(
            COALESCE(escrow_release_date, NOW()),
            v_release_date
        ),
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Registrar transacción
    INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
    SELECT 
        id, 
        user_id, 
        'escrow_move', 
        -p_amount, 
        held_balance - p_amount, 
        'Fondos movidos a escrow', 
        NULL
    FROM public.wallets
    WHERE user_id = p_user_id;
    
    RETURN json_build_object(
        'success', true,
        'amount', p_amount,
        'release_date', v_release_date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Función para liberar fondos de escrow
CREATE OR REPLACE FUNCTION public.release_from_escrow(
    p_user_id UUID,
    p_amount DECIMAL,
    p_reason TEXT DEFAULT 'Liberación estándar'
) RETURNS JSON AS $$
DECLARE
    v_escrow_balance DECIMAL;
BEGIN
    -- Verificar balance en escrow
    SELECT escrow_balance INTO v_escrow_balance
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF v_escrow_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente en escrow';
    END IF;
    
    -- Liberar fondos de escrow a balance
    UPDATE public.wallets
    SET 
        escrow_balance = escrow_balance - p_amount,
        balance = balance + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Registrar transacción
    INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
    SELECT 
        id, 
        user_id, 
        'escrow_release', 
        p_amount, 
        balance + p_amount, 
        p_reason, 
        NULL
    FROM public.wallets
    WHERE user_id = p_user_id;
    
    RETURN json_build_object(
        'success', true,
        'amount', p_amount,
        'reason', p_reason
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modificar complete_ride para usar escrow
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_total_payout DECIMAL := 0;
    v_platform_fee DECIMAL := 0.10; -- 10% de comisión
    v_payout_amount DECIMAL;
    v_p JSONB;
    v_p_id UUID;
    v_passenger_id UUID;
    v_ride_price DECIMAL;
BEGIN
    -- Obtener información del ride
    SELECT * INTO v_ride_record
    FROM public.rides
    WHERE id = p_ride_id
        AND driver_id = v_driver_id
        AND status = 'in_progress'
    FOR UPDATE;
    
    IF v_ride_record.id IS NULL THEN
        RAISE EXCEPTION 'Solo puedes completar un viaje que esté en progreso';
    END IF;
    
    -- Procesar cada pasajero
    FOR v_p IN
    SELECT *
    FROM jsonb_array_elements(v_ride_record.passengers) 
    WHERE p->>'status' IN ('confirmed', 'verified', 'on_board')
    LOOP
        v_p_id := (v_p->>'id')::UUID;
        v_ride_price := (v_p->>'booked_price')::DECIMAL;
        v_payout_amount := v_ride_price * (1 - v_platform_fee);
        
        -- Mover fondos de escrow de pasajero a balance del conductor
        PERFORM public.release_from_escrow(
            v_p_id,
            v_ride_price,
            'Pago por viaje completado'
        );
        
        -- Pagar al conductor (comisión ya descontada)
        UPDATE public.wallets
        SET balance = balance + v_payout_amount,
            updated_at = NOW()
        WHERE user_id = v_driver_id;
        
        -- Registrar transacción de payout
        INSERT INTO public.transactions (
            wallet_id,
            user_id,
            type,
            amount,
            balance_after,
            description,
            related_ride_id
        )
        SELECT 
            id, 
            user_id, 
            'payout', 
            v_payout_amount, 
            balance + v_payout_amount, 
            'Pago por trayecto completado', 
            p_ride_id
        FROM public.wallets
        WHERE user_id = v_driver_id;
        
        -- Actualizar estado del pasajero a completed
        v_p := v_p || jsonb_build_object('status', 'completed', 'completed_at', NOW());
        v_total_payout := v_total_payout + v_payout_amount;
    END LOOP;
    
    -- Actualizar passengers array con estados completados
    UPDATE public.rides
    SET 
        passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN p->>'status' IN ('confirmed', 'verified', 'on_board') THEN
                        p || jsonb_build_object('status', 'completed', 'completed_at', NOW())
                    ELSE p
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) AS p
        ),
        status = 'completed',
        completed_at = NOW()
    WHERE id = p_ride_id;
    
    RETURN json_build_object(
        'success', true, 
        'payout', v_total_payout,
        'platform_fee', v_total_payout * 0.10 / (1 - 0.10),
        'passengers_completed', (
            SELECT COUNT(*) 
            FROM jsonb_array_elements(v_ride_record.passengers) 
            WHERE value->>'status' IN ('confirmed', 'verified', 'on_board')
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Función para disputas (devolver fondos al pasajero)
CREATE OR REPLACE FUNCTION public.resolve_dispute(
    p_ride_id UUID,
    p_passenger_id UUID,
    p_resolution TEXT, -- 'refund_passenger' o 'pay_driver'
    p_reason TEXT DEFAULT ''
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_passenger_data JSONB;
    v_ride_price DECIMAL;
    v_admin_id UUID := auth.uid();
BEGIN
    -- Verificar que sea admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Solo los administradores pueden resolver disputas';
    END IF;
    
    -- Obtener información del ride
    SELECT driver_id INTO v_driver_id
    FROM public.rides
    WHERE id = p_ride_id;
    
    -- Obtener datos del pasajero
    SELECT p INTO v_passenger_data
    FROM jsonb_array_elements(passengers) AS p
    WHERE (p->>'id')::UUID = p_passenger_id
        AND id = p_ride_id;
    
    IF v_passenger_data IS NULL THEN
        RAISE EXCEPTION 'Pasajero no encontrado en este viaje';
    END IF;
    
    v_ride_price := (v_passenger_data->>'booked_price')::DECIMAL;
    
    -- Registrar acción de auditoría
    PERFORM public.log_admin_action(
        'resolve_dispute',
        json_build_object(
            'ride_id', p_ride_id,
            'passenger_id', p_passenger_id,
            'resolution', p_resolution,
            'reason', p_reason,
            'amount', v_ride_price
        ),
        p_passenger_id
    );
    
    IF p_resolution = 'refund_passenger' THEN
        -- Devolver fondos al pasajero desde escrow
        PERFORM public.release_from_escrow(
            p_passenger_id,
            v_ride_price,
            'Reembolso por disputa: ' || p_reason
        );
        
        -- Marcar pasajero como refundido
        UPDATE public.rides
        SET passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN (p->>'id')::UUID = p_passenger_id THEN
                        p || jsonb_build_object('status', 'refunded', 'refunded_at', NOW())
                    ELSE p
                END
            )
            FROM jsonb_array_elements(passengers) AS p
        )
        WHERE id = p_ride_id;
        
    ELSIF p_resolution = 'pay_driver' THEN
        -- Pagar al conductor desde escrow del pasajero
        PERFORM public.release_from_escrow(
            p_passenger_id,
            v_ride_price,
            'Pago a conductor por disputa resuelta'
        );
        
        -- Marcar pasajero como pagado
        UPDATE public.rides
        SET passengers = (
            SELECT jsonb_agg(
                CASE 
                    WHEN (p->>'id')::UUID = p_passenger_id THEN
                        p || jsonb_build_object('status', 'dispute_paid', 'dispute_paid_at', NOW())
                    ELSE p
                END
            )
            FROM jsonb_array_elements(passengers) AS p
        )
        WHERE id = p_ride_id;
        
    ELSE
        RAISE EXCEPTION 'Resolución inválida. Use "refund_passenger" o "pay_driver"';
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'resolution', p_resolution,
        'amount', v_ride_price,
        'reason', p_reason
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Job automático para liberar fondos antiguos
CREATE OR REPLACE FUNCTION public.process_escrow_releases() 
RETURNS INTEGER AS $$
DECLARE
    v_released_count INTEGER := 0;
    v_release_records RECORD;
BEGIN
    -- Encontrar fondos en escrow que deben ser liberados
    FOR v_release_records IN
        SELECT user_id, escrow_balance
        FROM public.wallets
        WHERE escrow_balance > 0
            AND escrow_release_date <= NOW()
    LOOP
        -- Liberar fondos automáticamente
        PERFORM public.release_from_escrow(
            v_release_records.user_id,
            v_release_records.escrow_balance,
            'Liberación automática (7 días completados)'
        );
        
        v_released_count := v_released_count + 1;
    END LOOP;
    
    RETURN v_released_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentarios para auditoría
COMMENT ON FUNCTION public.move_to_escrow IS 'Mueve fondos de held a escrow por disputas';
COMMENT ON FUNCTION public.release_from_escrow IS 'Libera fondos de escrow al balance principal';
COMMENT ON FUNCTION public.resolve_dispute IS 'Resuelve disputas entre conductor y pasajero';
COMMENT ON FUNCTION public.process_escrow_releases IS 'Job automático para liberar fondos antiguos';
