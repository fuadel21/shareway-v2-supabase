-- ==========================================
-- 20260505_FINAL_COMPLETION_ENGINE.sql
-- Motor de Liquidación Ultra-Resiliente v2
-- ==========================================

-- 1. LIMPIEZA Y REPARACIÓN PROFUNDA (Antes de aplicar restricciones)
-- Reparamos nulos existentes para que no bloqueen los cálculos
UPDATE public.wallets SET balance = 0.00 WHERE balance IS NULL;
UPDATE public.wallets SET held_balance = 0.00 WHERE held_balance IS NULL;

-- Aseguramos que todos los perfiles tengan cartera (Fix para usuarios nuevos sin wallet)
INSERT INTO public.wallets (user_id, balance, held_balance)
SELECT id, 0.00, 0.00 FROM public.profiles
ON CONFLICT (user_id) DO UPDATE
SET balance = COALESCE(public.wallets.balance, 0.00),
    held_balance = COALESCE(public.wallets.held_balance, 0.00);

-- Aplicamos restricciones físicas de No Nulidad y Valores por Defecto
ALTER TABLE public.wallets ALTER COLUMN balance SET NOT NULL;
ALTER TABLE public.wallets ALTER COLUMN balance SET DEFAULT 0.00;
ALTER TABLE public.wallets ALTER COLUMN held_balance SET NOT NULL;
ALTER TABLE public.wallets ALTER COLUMN held_balance SET DEFAULT 0.00;

-- 2. LIMPIEZA DE FUNCIONES ANTIGUAS
DROP FUNCTION IF EXISTS public.complete_ride(uuid);

-- 3. CREACIÓN DE COMPLETE_RIDE (Lógica Blindada contra Nulos)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_total_payout NUMERIC := 0;
    v_platform_fee_total NUMERIC := 0;
    v_ride_status TEXT;
BEGIN
    -- 1. Bloqueo y verificación de estado (FOR UPDATE evita condiciones de carrera)
    SELECT status INTO v_ride_status FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Viaje no encontrado o no eres el conductor');
    END IF;

    IF v_ride_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este viaje ya fue liquidado anteriormente');
    END IF;

    -- 2. Procesamiento de pasajeros
    FOR v_passenger IN
        SELECT (p->>'id')::UUID as id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) as price,
               COALESCE((p->>'seats_booked')::INTEGER, 1) as seats,
               (p->>'status') as status
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE r.id = p_ride_id
    LOOP
        -- Subtotal de la transacción de este pasajero
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
        BEGIN
            IF v_passenger.status = 'verified' THEN
                DECLARE
                    v_net_payout NUMERIC := v_subtotal * 0.90; -- 90% Conductor
                    v_fee NUMERIC := v_subtotal * 0.10;        -- 10% Plataforma
                BEGIN
                    -- Liquidación al conductor (COALESCE blinda la operación)
                    UPDATE public.wallets
                    SET balance = COALESCE(balance, 0.00) + v_net_payout
                    WHERE user_id = v_driver_id;

                    -- Descuento del saldo retenido del pasajero
                    UPDATE public.wallets
                    SET held_balance = COALESCE(held_balance, 0.00) - v_subtotal
                    WHERE user_id = v_passenger.id;

                    -- Registro de transacción para el historial
                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso por viaje finalizado');

                    v_total_payout := v_total_payout + v_net_payout;
                    v_platform_fee_total := v_platform_fee_total + v_fee;
                END;
            ELSE
                -- DEVOLUCIÓN: Si el pasajero no subió (no verificado), liberamos su dinero
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0.00) + v_subtotal,
                    held_balance = COALESCE(held_balance, 0.00) - v_subtotal
                WHERE user_id = v_passenger.id;
            END IF;
        END;
    END LOOP;

    -- 3. Cierre oficial del ciclo de vida del viaje
    UPDATE public.rides
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'payout', v_total_payout,
        'fee', v_platform_fee_total,
        'message', 'Viaje finalizado y saldos actualizados correctamente'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
