-- ========================================================
-- MIGRACIÓN: STATE MACHINE REFACTOR V4 (Fase 2) - CORREGIDA
-- Objetivo: Geofencing, Anti-Brute Force PIN y Seguridad en Ruta
-- ========================================================
-- 1. Utilidad Geográfica: Haversine Distance (Meters)
CREATE OR REPLACE FUNCTION public.haversine_distance(lat1 float, lon1 float, lat2 float, lon2 float) RETURNS float AS $$
DECLARE R float := 6371000;
-- Radio de la Tierra en metros
dlat float;
dlon float;
a float;
c float;
BEGIN dlat := radians(lat2 - lat1);
dlon := radians(lon2 - lon1);
a := sin(dlat / 2) * sin(dlat / 2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) * sin(dlon / 2);
c := 2 * atan2(sqrt(a), sqrt(1 - a));
RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 2. VERIFY PASSENGER: Con Blindaje de Intentos (Anti-Brute Force)
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passengers JSONB;
v_match BOOLEAN := false;
v_attempts INTEGER;
BEGIN
SELECT passengers INTO v_passengers
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_passengers IS NULL THEN RAISE EXCEPTION 'No autorizado o viaje inexistente.';
END IF;
-- Extraer intentos fallidos actuales
SELECT COALESCE((p->>'failed_attempts')::INTEGER, 0) INTO v_attempts
FROM jsonb_array_elements(v_passengers) p
WHERE (p->>'id')::UUID = p_passenger_id;
IF v_attempts >= 3 THEN RAISE EXCEPTION 'PIN_BLOQUEADO: Demasiados intentos fallidos. Contacta con soporte.';
END IF;
-- CORRECCIÓN: Verificar match primero (sin asignación inline en SELECT)
SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_passengers) p
        WHERE (p->>'id')::UUID = p_passenger_id
            AND p->>'pin' = p_pin
    ) INTO v_match;
-- Actualizar el JSONB según el resultado
SELECT jsonb_agg(
        CASE
            WHEN (p->>'id')::UUID = p_passenger_id THEN CASE
                WHEN v_match THEN jsonb_set(p, '{status}', '"verified"')
                ELSE jsonb_set(
                    p,
                    '{failed_attempts}',
                    (
                        COALESCE((p->>'failed_attempts')::INTEGER, 0) + 1
                    )::TEXT::JSONB
                )
            END
            ELSE p
        END
    ) INTO v_passengers
FROM jsonb_array_elements(v_passengers) p;
UPDATE public.rides
SET passengers = v_passengers
WHERE id = p_ride_id;
IF NOT v_match THEN RAISE EXCEPTION 'PIN_INCORRECTO: Intento registrado.';
END IF;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. COMPLETE RIDE: Con Validación de Destino (Geofencing)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_ride RECORD;
v_dist_to_dest FLOAT;
v_total_payout DECIMAL := 0;
v_p RECORD;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'active' FOR
UPDATE;
IF v_ride.id IS NULL THEN RAISE EXCEPTION 'El viaje no está activo o no eres el conductor.';
END IF;
-- GEOFENCING: Validar posición del conductor vs Destino
IF v_ride.current_location IS NULL THEN RAISE EXCEPTION 'GPS_REQUERIDO: No hay señal GPS reciente para validar la llegada.';
END IF;
v_dist_to_dest := public.haversine_distance(
    (v_ride.current_location->>'lat')::FLOAT,
    (v_ride.current_location->>'lng')::FLOAT,
    (v_ride.destination->>'lat')::FLOAT,
    (v_ride.destination->>'lng')::FLOAT
);
IF v_dist_to_dest > 1000 THEN -- 1km de tolerancia
RAISE EXCEPTION 'DESTINO_NO_ALCANZADO: Estás a % metros del destino. Acércate más para cobrar.',
ROUND(v_dist_to_dest::numeric, 0);
END IF;
-- Procesar Payouts
FOR v_p IN
SELECT (p->>'id')::UUID as pid,
    (p->>'booked_price')::DECIMAL as price,
    (p->>'status') as stat
FROM jsonb_array_elements(v_ride.passengers) p
WHERE p->>'status' IN ('verified', 'confirmed', 'no_show') LOOP
UPDATE public.wallets
SET held_balance = held_balance - v_p.price
WHERE user_id = v_p.pid;
v_total_payout := v_total_payout + v_p.price;
END LOOP;
UPDATE public.wallets
SET balance = balance + v_total_payout
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'payout',
    v_total_payout,
    balance,
    'Pago por trayecto completado (Validado por GPS)',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
UPDATE public.rides
SET status = 'completed'
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'payout', v_total_payout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. HANDLE NO-SHOW: Con Validación de Presencia en Origen
CREATE OR REPLACE FUNCTION public.handle_passenger_no_show(p_ride_id UUID, p_passenger_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_ride RECORD;
v_dist_to_origin FLOAT;
BEGIN
SELECT * INTO v_ride
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status = 'scheduled' FOR
UPDATE;
IF v_ride.id IS NULL THEN RAISE EXCEPTION 'No se puede marcar No-Show en este estado.';
END IF;
IF v_ride.current_location IS NULL THEN RAISE EXCEPTION 'GPS_REQUERIDO: Necesitamos tu ubicación para validar que estás en el punto de encuentro.';
END IF;
v_dist_to_origin := public.haversine_distance(
    (v_ride.current_location->>'lat')::FLOAT,
    (v_ride.current_location->>'lng')::FLOAT,
    (v_ride.origin->>'lat')::FLOAT,
    (v_ride.origin->>'lng')::FLOAT
);
IF v_dist_to_origin > 500 THEN RAISE EXCEPTION 'NO_ESTAS_EN_EL_ORIGEN: Debes estar en el punto de encuentro para marcar una ausencia.';
END IF;
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN jsonb_set(p, '{status}', '"no_show"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Ausencia registrada correctamente.'
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;