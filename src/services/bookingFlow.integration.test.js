import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * INTEGRATION TEST: Complete Booking Lifecycle
 * 
 * Valida el flujo completo de reserva desde la creación del viaje
 * hasta la finalización y procesamiento de pago.
 * 
 * Flujo:
 * 1. Driver crea viaje
 * 2. Passenger reserva plaza
 * 3. Driver inicia viaje
 * 4. Passenger confirma llegada
 * 5. Sistema procesa pago y libera fondos
 */
describe('Booking Flow: Complete Lifecycle', () => {

    const DRIVER_EMAIL = 'driver.elite@shareway.test';
    const PASSENGER_EMAIL = 'passenger.1@shareway.test';
    const PASS = 'ShareWayTest2026!';

    const supabaseDriver = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const supabasePassenger = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    let testRideId;
    let driverInitialBalance;
    let passengerInitialBalance;

    beforeAll(async () => {
        // Autenticar usuarios
        await supabaseDriver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        await supabasePassenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });

        // Capturar balances iniciales
        const { data: driverWallet } = await supabaseDriver.from('wallets').select('balance').single();
        const { data: passengerWallet } = await supabasePassenger.from('wallets').select('balance').single();

        driverInitialBalance = parseFloat(driverWallet.balance);
        passengerInitialBalance = parseFloat(passengerWallet.balance);

        console.log(`💰 Initial balances - Driver: ${driverInitialBalance}€, Passenger: ${passengerInitialBalance}€`);
    });

    it('should complete full booking lifecycle: create → book → start → complete → pay', async () => {
        // PASO 1: Driver crea viaje
        console.log('📝 Step 1: Driver creates ride...');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 5);
        tomorrow.setHours(14, 0, 0, 0);

        const { data: { user: driver } } = await supabaseDriver.auth.getUser();

        const { data: newRide, error: createError } = await supabaseDriver.from('rides').insert({
            driver_id: driver.id,
            driver_display_name: 'Test Driver',
            origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
            destination: { address: 'Barcelona', lat: 41.38, lng: 2.17 },
            departure_time: tomorrow.toISOString(),
            seats_total: 3,
            seats_available: 3,
            price: 30.00,
            status: 'scheduled'
        }).select('id').single();

        expect(createError).toBeNull();
        expect(newRide.id).toBeDefined();
        testRideId = newRide.id;
        console.log(`✅ Ride created: ${testRideId}`);

        // PASO 2: Passenger reserva plaza
        console.log('🎫 Step 2: Passenger books seat...');

        const { data: bookingResult, error: bookingError } = await supabasePassenger.rpc('confirm_trip_and_pay', {
            p_ride_id: testRideId
        });

        expect(bookingError).toBeNull();
        expect(bookingResult.success).toBe(true);
        console.log(`✅ Booking confirmed. Status: ${bookingResult.status}`);

        // Verificar que los fondos fueron retenidos
        const { data: passengerWalletAfterBooking } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        expect(parseFloat(passengerWalletAfterBooking.held_balance)).toBe(30.00);
        console.log(`💳 Funds held: ${passengerWalletAfterBooking.held_balance}€`);

        // PASO 3: Driver inicia viaje
        console.log('🚗 Step 3: Driver starts ride...');

        const { error: startError } = await supabaseDriver.rpc('start_ride', {
            p_ride_id: testRideId
        });

        expect(startError).toBeNull();

        // Verificar estado
        const { data: rideAfterStart } = await supabaseDriver.from('rides').select('status').eq('id', testRideId).single();
        expect(rideAfterStart.status).toBe('active');
        console.log(`✅ Ride active. Status: ${rideAfterStart.status}`);

        // PASO 4: Passenger confirma llegada
        console.log('🏁 Step 4: Passenger confirms arrival...');

        const { error: arrivalError } = await supabasePassenger.rpc('confirm_passenger_arrival', {
            p_ride_id: testRideId
        });

        expect(arrivalError).toBeNull();
        console.log(`✅ Arrival confirmed`);

        // PASO 5: Driver completa viaje (procesa pago)
        console.log('💰 Step 5: Driver completes ride and payment is processed...');

        const { error: completeError } = await supabaseDriver.rpc('complete_ride', {
            p_ride_id: testRideId
        });

        expect(completeError).toBeNull();

        // Verificar estado final
        const { data: finalRide } = await supabaseDriver.from('rides').select('status').eq('id', testRideId).single();
        expect(finalRide.status).toBe('completed');
        console.log(`✅ Ride completed. Status: ${finalRide.status}`);

        // VALIDACIÓN FINAL: Verificar transferencia de fondos
        const { data: driverWalletFinal } = await supabaseDriver.from('wallets').select('balance').single();
        const { data: passengerWalletFinal } = await supabasePassenger.from('wallets').select('balance, held_balance').single();

        // Driver debe haber recibido el pago (menos comisión de plataforma ~10%)
        const expectedDriverIncrease = 30.00 * 0.9; // 90% del precio
        const actualDriverIncrease = parseFloat(driverWalletFinal.balance) - driverInitialBalance;

        expect(actualDriverIncrease).toBeGreaterThan(25); // Al menos 25€ (permitir margen)
        expect(actualDriverIncrease).toBeLessThanOrEqual(30); // Máximo 30€

        // Passenger debe haber pagado y held_balance debe estar en 0
        expect(parseFloat(passengerWalletFinal.held_balance)).toBe(0);
        expect(parseFloat(passengerWalletFinal.balance)).toBeLessThan(passengerInitialBalance);

        console.log(`💰 Final balances - Driver: +${actualDriverIncrease.toFixed(2)}€, Passenger: -${(passengerInitialBalance - parseFloat(passengerWalletFinal.balance)).toFixed(2)}€`);
        console.log(`🎉 COMPLETE LIFECYCLE VALIDATED`);
    }, 30000); // 30 segundos de timeout para el flujo completo
    it('should atomic rollback if internal logic fails (Proof of Atomicity)', async () => {
        // Escenario: Intentamos reservar pero forzamos un error de saldo insuficiente
        // Resultado esperado: Ni se cobra el saldo ni se reduce el asiento (atomicidad nativa Postgres)

        console.log('🧪 Testing Atomic Rollback (Financial Integrity)...');

        // 1. Crear viaje con 1 asiento
        const { data: ride } = await supabaseDriver.from('rides').insert({
            driver_id: (await supabaseDriver.auth.getUser()).data.user.id,
            origin: { address: 'Origin' }, destination: { address: 'Dest' },
            departure_time: new Date(Date.now() + 86400000 * 5).toISOString(),
            seats_total: 1, seats_available: 1, price: 9999.00, // Precio impagable
            status: 'scheduled'
        }).select('id').single();

        const { data: walletBefore } = await supabasePassenger.from('wallets').select('balance, held_balance').single();

        // 2. Intentar pagar (fallará por saldo insuficiente)
        const { error } = await supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: ride.id });

        expect(error).not.toBeNull(); // Debe fallar

        // 3. Verificar que NADA cambió
        const { data: walletAfter } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        const { data: rideAfter } = await supabaseDriver.from('rides').select('seats_available').eq('id', ride.id).single();

        expect(walletAfter.balance).toBe(walletBefore.balance);
        expect(walletAfter.held_balance).toBe(walletBefore.held_balance);
        expect(rideAfter.seats_available).toBe(1);

        console.log('✅ Atomic Rollback validated: No partial state committed.');
    });
});
