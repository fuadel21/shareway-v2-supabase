-- ==========================================
-- 20260509_FIX_NOTIFICATIONS_AND_CANCEL_RIDE.sql
-- Reparación de la API de Notificaciones y Cancelación
-- ==========================================

-- 0. FLEXIBILIZAR TABLA DE NOTIFICACIONES (Quitar restricciones rígidas de tipo)
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- 1. LIMPIEZA DE NOTIFICACIONES (Borrar todas las versiones para evitar ambigüedad de firma)
DO $$
DECLARE _fn record;
BEGIN
    FOR _fn IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'create_notification' AND n.nspname = 'public'
    ) LOOP
        EXECUTE format('DROP FUNCTION %I.%I(%s) CASCADE', _fn.nspname, _fn.proname, _fn.args);
    END LOOP;
END $$;

-- 2. DEFINICIÓN ESTÁNDAR DE NOTIFICACIONES (Versión Robusta)
-- Firma principal: (user, type, title, body, data)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (p_user_id, p_type, p_title, p_body, p_data)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sobrecarga para compatibilidad con llamadas de 4 argumentos (PostgREST lo pide como 'unknown')
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT
) RETURNS UUID AS $$
BEGIN
    RETURN public.create_notification(p_user_id, p_type, p_title, p_body, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sobrecarga para compatibilidad con el orden (user, title, body)
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_title TEXT,
    p_body TEXT
) RETURNS UUID AS $$
BEGIN
    RETURN public.create_notification(p_user_id, 'info', p_title, p_body, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. REPARACIÓN DE CANCEL_RIDE (Asegurando firma y parámetros)
DROP FUNCTION IF EXISTS public.cancel_ride(uuid);
DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'Cancelación operativa')
RETURNS JSONB AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price NUMERIC;
BEGIN
    -- Bloqueo y verificación
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    -- Reembolsos y Notificaciones a Pasajeros
    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            v_passenger_id := (v_passenger->>'id')::UUID;
            v_booked_price := COALESCE((v_passenger->>'booked_price')::NUMERIC, 0);

            IF v_passenger->>'status' != 'cancelled' AND v_passenger_id IS NOT NULL THEN
                -- Devolución de dinero
                UPDATE public.wallets
                SET held_balance = GREATEST(0, held_balance - v_booked_price),
                    balance = balance + v_booked_price
                WHERE user_id = v_passenger_id;

                -- Historial
                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso por cancelación: ' || p_reason, p_ride_id);

                -- Notificación segura (Usando la nueva API robusta)
                PERFORM public.create_notification(
                    v_passenger_id,
                    'ride_cancelled',
                    'Viaje Cancelado',
                    'El conductor ha cancelado el viaje. Se ha devuelto tu dinero.',
                    jsonb_build_object('ride_id', p_ride_id)
                );
            END IF;
        END LOOP;
    END IF;

    -- Cambiar estado del viaje
    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Exponer cancel_ride al frontend (Asegurando el nombre del parámetro p_ride_id)
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSONB AS $$
BEGIN
    RETURN public.cancel_ride_unified(p_ride_id, 'Cancelado por el conductor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PERMISOS
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID) TO authenticated;
