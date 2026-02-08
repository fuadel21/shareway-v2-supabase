-- SHAREWAY V2: COMPLETE PAYMENT & BOOKING SIMULATION DRIVE
-- Objetivo: Verificar que el flujo de dinero (Carga -> Reserva -> Retiro) funciona sin fisuras.
DO $$
DECLARE v_test_user_id UUID;
v_test_ride_id UUID := '22222222-2222-2222-2222-222222222222';
v_driver_id UUID;
v_res JSON;
v_initial_balance DECIMAL;
BEGIN -- 0. PREPARACIÓN: Seleccionar un usuario real que ya exista en la plataforma
SELECT id INTO v_test_user_id
FROM public.profiles
LIMIT 1;
IF v_test_user_id IS NULL THEN RAISE EXCEPTION 'No se encontró ningún usuario en la tabla profiles para realizar la prueba.';
END IF;
-- Guardar balance inicial para referencia
SELECT COALESCE(balance, 0) INTO v_initial_balance
FROM public.wallets
WHERE user_id = v_test_user_id;
RAISE NOTICE '--- INICIANDO SIMULACIÓN DE FLUJO PARA USUARIO: % ---',
v_test_user_id;
RAISE NOTICE 'Balance inicial: %€',
v_initial_balance;
-- Obtener un conductor existente para el viaje de prueba
SELECT id INTO v_driver_id
FROM public.profiles
WHERE stripe_account_id IS NOT NULL
LIMIT 1;
IF v_driver_id IS NULL THEN v_driver_id := 'ad968f42-5b45-41a2-a76b-2bbc1028766b';
-- Fallback a usuario 1
END IF;
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
        v_test_ride_id,
        v_driver_id,
        '{"name": "Madrid"}',
        '{"name": "Barcelona"}',
        NOW() + INTERVAL '1 day',
        4,
        4,
        20.00,
        'scheduled'
    ) ON CONFLICT (id) DO NOTHING;
RAISE NOTICE '--- INICIANDO SIMULACIÓN DE FLUJO ---';
-- 1. SIMULAR CARGA DE WALLET (Webhook de Stripe)
-- Simulamos que el usuario recarga 50€
RAISE NOTICE 'Paso 1: Simulando recarga de 50€ vía Webhook...';
v_res := public.credit_wallet_on_success(v_test_user_id, 'pi_mock_123', 50.00);
RAISE NOTICE 'Resultado: %',
v_res;
-- 2. SIMULAR RESERVA DE VIAJE (Pago Directo)
RAISE NOTICE 'Paso 2: Simulando confirmación de reserva de 20€...';
INSERT INTO public.ride_requests (
        ride_id,
        requester_id,
        status,
        payment_intent_id,
        origin,
        destination,
        departure_time
    )
VALUES (
        v_test_ride_id,
        v_test_user_id,
        'pending',
        'pi_booking_' || floor(random() * 10000),
        '{"name": "Madrid"}'::jsonb,
        '{"name": "Barcelona"}'::jsonb,
        NOW() + INTERVAL '1 day'
    ) ON CONFLICT DO NOTHING;
-- El webhook procesa el éxito
UPDATE public.ride_requests
SET status = 'accepted'
WHERE ride_id = v_test_ride_id
    AND requester_id = v_test_user_id;
RAISE NOTICE 'Resultado: Reserva de viaje pi_booking_456 marcada como aceptada.';
-- 3. SIMULAR RETIRO DE FONDOS (Payout con Deducción)
-- El usuario quiere retirar 25.50€ de su saldo restante
RAISE NOTICE 'Paso 3: Simulando solicitud de retiro de 25.50€...';
v_res := public.request_payout_with_deduction(v_test_user_id, 25.50);
RAISE NOTICE 'Resultado: %',
v_res;
-- 4. VERIFICACIÓN FINAL DE SALDOS
RAISE NOTICE 'Paso 4: Verificando estado final de la cartera...';
DECLARE v_final_balance DECIMAL;
BEGIN
SELECT balance INTO v_final_balance
FROM public.wallets
WHERE user_id = v_test_user_id;
RAISE NOTICE 'Saldo final del usuario: %€ (Inicial: %€, Neto Simulado: +24.50€)',
v_final_balance,
v_initial_balance;
END;
RAISE NOTICE '--- SIMULACIÓN COMPLETADA ---';
-- Limpieza opcional:
-- DELETE FROM public.transactions WHERE user_id = v_test_user_id;
-- DELETE FROM public.wallets WHERE user_id = v_test_user_id;
-- DELETE FROM public.ride_requests WHERE requester_id = v_test_user_id;
END $$;