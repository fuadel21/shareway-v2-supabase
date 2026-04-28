-- ==========================================
-- 20260509_FIX_NOTIFICATIONS_AND_CANCEL_RIDE.sql
-- Reparación de la API de Notificaciones y Cancelación (V3 - Blindaje UUID)
-- ==========================================

-- 0. FLEXIBILIZAR TABLA DE NOTIFICACIONES
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- 1. LIMPIEZA TOTAL AGRESIVA
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

-- 2. DEFINICIÓN ÚNICA Y UNIVERSAL
CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id UUID,
    p_type TEXT DEFAULT 'info',
    p_title TEXT DEFAULT 'Notificación',
    p_body TEXT DEFAULT '',
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

-- 3. REPARACIÓN DE CANCEL_RIDE (Blindado contra datos corruptos "567")
DROP FUNCTION IF EXISTS public.cancel_ride(uuid);
DROP FUNCTION IF EXISTS public.cancel_ride_unified(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'Cancelación operativa')
RETURNS JSONB AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price NUMERIC;
    v_p_id_str TEXT;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            -- Intentar obtener el ID del pasajero de forma segura (id o user_id)
            v_p_id_str := COALESCE(v_passenger->>'id', v_passenger->>'user_id');

            -- VALIDACIÓN DE UUID: Solo procesamos si el ID tiene formato válido de UUID
            IF v_p_id_str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                v_passenger_id := v_p_id_str::UUID;
                v_booked_price := COALESCE((v_passenger->>'booked_price')::NUMERIC, 0);

                IF v_passenger->>'status' != 'cancelled' AND v_passenger_id IS NOT NULL THEN
                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, held_balance - v_booked_price),
                        balance = balance + v_booked_price
                    WHERE user_id = v_passenger_id;

                    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                    VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso por cancelación: ' || p_reason, p_ride_id);

                    PERFORM public.create_notification(
                        v_passenger_id,
                        'ride_cancelled',
                        'Viaje Cancelado',
                        'El conductor ha cancelado el viaje. Se ha devuelto tu dinero.',
                        jsonb_build_object('ride_id', p_ride_id)
                    );
                END IF;
            ELSE
                -- Si no es un UUID (ej: "567"), lo ignoramos para no romper la función
                CONTINUE;
            END IF;
        END LOOP;
    END IF;

    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSONB AS $$
BEGIN
    RETURN public.cancel_ride_unified(p_ride_id, 'Cancelado por el conductor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PERMISOS
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID) TO authenticated;

