-- ========================================================
-- FINAL FIX: Sincronización Total Frontend-Backend
-- ========================================================

-- 1. Añadir columna is_verified a profiles para compatibilidad con el código
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- Sincronizar is_verified con el objeto verification existente
UPDATE public.profiles 
SET is_verified = (verification->>'status' = 'verified');

-- 2. Asegurar que chats y messages tengan todas las columnas necesarias
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'individual';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '[]'::jsonb;

-- 3. Re-crear complete_ride con lógica permisiva y pago instantáneo
DROP FUNCTION IF EXISTS public.complete_ride(uuid);
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_total_driver_payout DECIMAL := 0;
    v_driver_id UUID;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- Permitimos completar incluso si está 'scheduled' por si el conductor olvidó darle a 'iniciar'
    IF v_ride_record.status NOT IN ('scheduled', 'active', 'in_progress') THEN
        RAISE EXCEPTION 'El viaje no se puede completar en su estado actual (%)', v_ride_record.status;
    END IF;

    v_driver_id := v_ride_record.driver_id;

    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF v_passenger->>'status' IN ('confirmed', 'verified', 'on_board', 'confirmed_by_pin') THEN
            v_total_driver_payout := v_total_driver_payout + (v_passenger->>'booked_price')::DECIMAL;
            
            -- Liberar el saldo retenido del pasajero
            UPDATE public.wallets 
            SET held_balance = held_balance - (v_passenger->>'booked_price')::DECIMAL,
                updated_at = NOW()
            WHERE user_id = (v_passenger->>'id')::UUID;
        END IF;
    END LOOP;

    -- Pagar al conductor (90% neto)
    IF v_total_driver_payout > 0 THEN
        v_total_driver_payout := v_total_driver_payout * 0.90;
        UPDATE public.wallets 
        SET balance = balance + v_total_driver_payout,
            updated_at = NOW()
        WHERE user_id = v_driver_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_total_driver_payout, 'payout', 'Ingreso por viaje completado', p_ride_id);
    END IF;

    UPDATE public.rides 
    SET status = 'completed', completed_at = NOW(), updated_at = NOW() 
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'payout', v_total_driver_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Re-crear get_ride_chats para evitar error 400
DROP FUNCTION IF EXISTS public.get_ride_chats(uuid);
CREATE OR REPLACE FUNCTION public.get_ride_chats(p_ride_id UUID) 
RETURNS TABLE (
    chat_id UUID,
    chat_type TEXT,
    participants UUID [],
    participant_names JSONB,
    last_message JSONB,
    unread_count INTEGER,
    ride_id UUID
) AS $$ 
BEGIN 
    RETURN QUERY
    SELECT 
        c.id,
        COALESCE(c.type, 'individual'),
        c.participants,
        COALESCE(c.participant_names, '{}'::jsonb),
        COALESCE(c.last_message, '{}'::jsonb),
        0, -- unread_count default
        c.ride_id
    FROM public.chats c
    WHERE c.ride_id = p_ride_id AND auth.uid() = ANY(c.participants);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
