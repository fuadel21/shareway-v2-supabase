-- SHAREWAY V2: FINAL POLISHING & SAFETY GUARDIANS
-- Objetivo: Blindar el sistema de emergencias y automatizar la gamificación básica.
-- 1. MEJORA: trigger_emergency_alert (Notificación Proactiva)
CREATE OR REPLACE FUNCTION public.trigger_emergency_alert(p_ride_id UUID, p_location JSONB DEFAULT NULL) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_user_name TEXT;
v_ride_details RECORD;
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN -- 1. Registrar la alerta
INSERT INTO public.emergency_alerts (user_id, ride_id, location)
VALUES (v_user_id, p_ride_id, p_location);
SELECT display_name INTO v_user_name
FROM public.profiles
WHERE id = v_user_id;
SELECT * INTO v_ride_details
FROM public.rides
WHERE id = p_ride_id;
-- 2. Notificar a la Tesorería / Admin Central
PERFORM public.create_notification(
    v_platform_id,
    '🚨 EMERGENCIA ACTIVADA',
    'El usuario ' || v_user_name || ' ha activado el SOS en el viaje ' || p_ride_id,
    'error',
    jsonb_build_object(
        'ride_id',
        p_ride_id,
        'user_id',
        v_user_id,
        'location',
        p_location
    )
);
-- 3. Notificar a los GUARDIANES (Todos los administradores)
INSERT INTO public.notifications (user_id, payload)
SELECT id,
    jsonb_build_object(
        'title',
        '🚨 ALERTA SOS CRÍTICA',
        'content',
        'Emergencia activa de ' || v_user_name || '. Revisa el mapa de inmediato.',
        'type',
        'error',
        'data',
        jsonb_build_object('ride_id', p_ride_id, 'location', p_location)
    )
FROM public.profiles
WHERE role = 'admin'
    OR is_admin = true;
RETURN json_build_object(
    'success',
    true,
    'message',
    'SOS propagado a la red de seguridad ShareWay.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. AUTOMATIZACIÓN: Gamificación en el completion
-- Extendemos complete_ride para otorgar logros.
CREATE OR REPLACE FUNCTION public.award_achievement(p_user_id UUID, p_achievement_id TEXT) RETURNS VOID AS $$ BEGIN
INSERT INTO public.user_achievements (user_id, achievement_id)
VALUES (p_user_id, p_achievement_id) ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. INTEGRACIÓN: Reforzar complete_ride con logros
-- Nota: Solo modificamos la lógica de logros al final.
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_ride RECORD;
v_pax JSONB;
v_pax_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_net DECIMAL;
v_total_driver DECIMAL := 0;
v_total_platform DECIMAL := 0;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_ride.status = 'completed' THEN RAISE EXCEPTION 'Viaje ya completado';
END IF;
FOR v_pax IN
SELECT *
FROM jsonb_array_elements(v_ride.passengers) LOOP v_pax_price := (v_pax->>'booked_price')::DECIMAL;
IF v_pax->>'status' IN ('verified', 'no_show') THEN v_platform_fee := ROUND(v_pax_price * 0.15, 2);
v_driver_net := v_pax_price - v_platform_fee;
v_total_driver := v_total_driver + v_driver_net;
v_total_platform := v_total_platform + v_platform_fee;
-- Mover del Held del pasajero a la "invisibilidad" (ya se cobró real en el banco)
UPDATE public.wallets
SET held_balance = held_balance - v_pax_price
WHERE user_id = (v_pax->>'id')::UUID;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        (v_pax->>'id')::UUID,
        (v_pax->>'id')::UUID,
        - v_pax_price,
        'ride_payment',
        'Pago viaje finalizado',
        p_ride_id
    );
-- Logro para el pasajero
PERFORM public.award_achievement((v_pax->>'id')::UUID, 'FIRST_RIDE');
END IF;
END LOOP;
-- Pagar al conductor
IF v_total_driver > 0 THEN
UPDATE public.wallets
SET balance = balance + v_total_driver
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_driver_id,
        v_driver_id,
        v_total_driver,
        'payout',
        'Ganancia por viaje finalizado',
        p_ride_id
    );
-- Logro para el conductor
PERFORM public.award_achievement(v_driver_id, 'FIRST_RIDE');
END IF;
-- Pagar a la plataforma
IF v_total_platform > 0 THEN
UPDATE public.wallets
SET balance = balance + v_total_platform
WHERE user_id = v_platform_id;
INSERT INTO public.transactions (
        user_id,
        wallet_id,
        amount,
        type,
        description,
        related_ride_id
    )
VALUES (
        v_platform_id,
        v_platform_id,
        v_total_platform,
        'platform_fee',
        'Comisión plataforma (15%)',
        p_ride_id
    );
END IF;
-- Finalizar viaje
UPDATE public.rides
SET status = 'completed',
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'driver_payout',
    v_total_driver,
    'platform_commission',
    v_total_platform
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;