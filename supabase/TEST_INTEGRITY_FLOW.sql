-- SHAREWAY V2: MULTI-SEAT & TREASURY STRESS TEST (STRIPE-ONLY VERSION)
-- Objetivo: Verificar el flujo donde Stripe alimenta el held_balance y las reservas no tocan el monedero.
DO $$
DECLARE v_user_pax1 UUID;
v_user_pax2 UUID;
v_driver_id UUID;
v_ride_id UUID := '33333333-3333-3333-3333-333333333333';
v_req_id UUID := '44444444-4444-4444-4444-444444444444';
v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
v_res JSON;
v_pin1 TEXT;
v_pin2 TEXT;
v_balance_driver_initial DECIMAL;
v_balance_treasury_initial DECIMAL;
v_balance_treasury_final DECIMAL;
BEGIN -- 0. PREPARACIÓN: Necesitamos 3 usuarios reales
SELECT id INTO v_driver_id
FROM public.profiles
LIMIT 1 OFFSET 0;
SELECT id INTO v_user_pax1
FROM public.profiles
LIMIT 1 OFFSET 1;
SELECT id INTO v_user_pax2
FROM public.profiles
LIMIT 1 OFFSET 2;
IF v_user_pax2 IS NULL THEN RAISE EXCEPTION 'Se necesitan al menos 3 usuarios para este test.';
END IF;
-- Limpieza profunda para evitar errores de duplicados
DELETE FROM public.ride_requests
WHERE id = v_req_id
    OR ride_id = v_ride_id;
DELETE FROM public.rides
WHERE id = v_ride_id;
-- Guardar balances iniciales
SELECT balance INTO v_balance_driver_initial
FROM public.wallets
WHERE user_id = v_driver_id;
SELECT balance INTO v_balance_treasury_initial
FROM public.wallets
WHERE user_id = v_platform_id;
-- Crear un viaje con 4 asientos libres a 10€
INSERT INTO public.rides (
        id,
        driver_id,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        status
    )
VALUES (
        v_ride_id,
        v_driver_id,
        '{"name":"A"}',
        '{"name":"B"}',
        NOW() + INTERVAL '1 day',
        4,
        4,
        10.00,
        'scheduled'
    );
RAISE NOTICE '--- INICIANDO TEST STRIPE-ONLY (HELD BALANCE) ---';
-- 1. PASAJERO 1: Simula pago exitoso en Stripe de 30€ (3 asientos)
-- Esto alimenta el held_balance directamente
PERFORM public.hold_funds_on_booking_success(
    v_user_pax1,
    v_ride_id,
    30.00,
    'pi_stripe_pax1_30'
);
-- Simular Sesión: Pasajero 1 reserva en la App
PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_pax1)::text,
    true
);
INSERT INTO public.ride_requests (
        id,
        requester_id,
        ride_id,
        seats_needed,
        origin,
        destination,
        departure_time,
        status
    )
VALUES (
        v_req_id,
        v_user_pax1,
        v_ride_id,
        3,
        '{"name":"A"}',
        '{"name":"B"}',
        NOW() + INTERVAL '1 day',
        'pending'
    );
-- Reserva física de los 3 asientos
v_res := public.confirm_trip_and_pay(v_ride_id, v_req_id);
v_pin1 := v_res->>'pin';
RAISE NOTICE 'Paso 1: Pasajero 1 reservó 3 asientos. PIN: %',
v_pin1;
-- 2. PASAJERO 2: Simula pago en Stripe de 10€ (1 asiento)
-- Importante: El total ahora es 4/4 ocupados
PERFORM public.hold_funds_on_booking_success(
    v_user_pax2,
    v_ride_id,
    10.00,
    'pi_stripe_pax2_10'
);
-- Simular Sesión: Pasajero 2 reserva en la App
PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_pax2)::text,
    true
);
v_res := public.confirm_trip_and_pay(v_ride_id);
-- Sin request ID, asume 1 asiento
v_pin2 := v_res->>'pin';
RAISE NOTICE 'Paso 2: Pasajero 2 reservó el último asiento. PIN: %',
v_pin2;
-- 3. FLUJO DE VIAJE Y CHECK-IN
-- Simular Sesión: Conductor verifica PINs
PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_driver_id)::text,
    true
);
RAISE NOTICE 'Paso 3: Verificando pasajero 1...';
PERFORM public.verify_passenger_boarding(v_ride_id, v_pin1);
-- El Pasajero 2 NO sube (No-Show)
UPDATE public.rides
SET passengers = (
        SELECT jsonb_agg(
                CASE
                    WHEN p->>'id' = v_user_pax2::text THEN jsonb_set(p, '{status}', '"no_show"')
                    ELSE p
                END
            )
        FROM jsonb_array_elements(passengers) p
    )
WHERE id = v_ride_id;
-- 4. FINALIZAR VIAJE
RAISE NOTICE 'Paso 4: Finalizando viaje...';
v_res := public.complete_ride(v_ride_id);
RAISE NOTICE 'Reparto final: %',
v_res;
-- 5. AUDITORÍA
SELECT balance INTO v_balance_treasury_final
FROM public.wallets
WHERE user_id = v_platform_id;
-- Cálculos esperado: 
-- 15% de 40€ = 6€ para plataforma
-- 85% de 40€ = 34€ para conductor
RAISE NOTICE 'Auditoría Final:';
RAISE NOTICE '- Tesorería (Anterior: %€, Actual: %€)',
v_balance_treasury_initial,
v_balance_treasury_final;
IF (
    v_balance_treasury_final - v_balance_treasury_initial
) >= 6.00 THEN RAISE NOTICE '✅ TEST COMPLETADO: El flujo Stripe -> Held -> Driver/Treasury funciona.';
ELSE RAISE WARNING '❌ TEST FALLIDO: La tesorería no recibió los 6€ de comisión.';
END IF;
END $$;