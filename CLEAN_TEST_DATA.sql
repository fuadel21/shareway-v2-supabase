-- ==============================================================================
-- 🧹 CLEAN TEST DATA: RESET TOTAL DEL ENTORNO DE PRUEBAS
-- Ejecuta esto para eliminar conflictos de horario y saldos antes de los tests.
-- ==============================================================================

DO $$
DECLARE
    v_driver_id UUID;
    v_passenger_id UUID;
BEGIN
    -- 1. Obtener IDs de los usuarios de test por su email
    SELECT id INTO v_driver_id FROM auth.users WHERE email = 'driver.elite@shareway.test';
    SELECT id INTO v_passenger_id FROM auth.users WHERE email = 'passenger.1@shareway.test';

    -- Si no existen, no hacemos nada
    IF v_driver_id IS NULL AND v_passenger_id IS NULL THEN
        RAISE NOTICE 'No se encontraron usuarios de test. Nada que limpiar.';
        RETURN;
    END IF;

    -- 2. Eliminar viajes y dependencias (Rides)
    -- Esto limpia viajes creados por el driver o donde el passenger participe
    DELETE FROM public.rides
    WHERE driver_id IN (v_driver_id, v_passenger_id)
       OR participant_ids && ARRAY[v_driver_id, v_passenger_id];

    -- 3. Eliminar solicitudes de viaje (Ride Requests)
    DELETE FROM public.ride_requests
    WHERE requester_id IN (v_driver_id, v_passenger_id);

    -- 4. Resetear carteras (Wallets) a un estado inicial limpio
    UPDATE public.wallets
    SET balance = 100.00,
        held_balance = 0.00,
        updated_at = NOW()
    WHERE user_id IN (v_driver_id, v_passenger_id);

    -- 5. Limpiar historial de notificaciones y transacciones de test
    DELETE FROM public.notifications WHERE user_id IN (v_driver_id, v_passenger_id);
    DELETE FROM public.transactions WHERE user_id IN (v_driver_id, v_passenger_id);

    RAISE NOTICE '✅ Limpieza completada: Viajes, solicitudes y carteras reseteadas para usuarios de test.';
END $$;
