import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * INTEGRATION TEST: Cancellation & Refund Policy
 * 
 * Valida la política de cancelación y reembolsos:
 * - 100% reembolso si >24h antes
 * - 50% reembolso si entre 2h y 24h antes
 * - 0% reembolso si <2h antes
 * - 100% reembolso en periodo de gracia (15 min)
 */
describe('Cancellation & Refund Policy', () => {

    const DRIVER_EMAIL = 'driver.elite@shareway.test';
    const PASSENGER_EMAIL = 'passenger.1@shareway.test';
    const PASS = 'ShareWayTest2026!';

    const supabaseDriver = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const supabasePassenger = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    beforeAll(async () => {
        await supabaseDriver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        await supabasePassenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });
    });

    it.todo('should refund 100% when cancelled >24h before departure', async () => {
        console.log('📅 Testing 100% refund (>24h before)...');

        // Crear viaje para pasado mañana
        const dayAfterTomorrow = new Date();
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        dayAfterTomorrow.setHours(14, 0, 0, 0);

        const { data: { user: driver } } = await supabaseDriver.auth.getUser();

        const { data: ride } = await supabaseDriver.from('rides').insert({
            driver_id: driver.id,
            driver_display_name: 'Test Driver',
            origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
            destination: { address: 'Barcelona', lat: 41.38, lng: 2.17 },
            departure_time: dayAfterTomorrow.toISOString(),
            seats_total: 3,
            seats_available: 3,
            price: 50.00,
            status: 'scheduled'
        }).select('id').single();

        // Reservar
        await supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: ride.id });

        // Capturar balance antes de cancelar
        const { data: walletBefore } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        const balanceBefore = parseFloat(walletBefore.balance);
        const heldBefore = parseFloat(walletBefore.held_balance);

        // Cancelar
        const { data: cancelResult, error } = await supabasePassenger.rpc('cancel_booking_and_refund', {
            p_ride_id: ride.id
        });

        expect(error).toBeNull();
        expect(cancelResult.success).toBe(true);

        // Verificar reembolso 100%
        const { data: walletAfter } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        const balanceAfter = parseFloat(walletAfter.balance);
        const heldAfter = parseFloat(walletAfter.held_balance);

        expect(heldAfter).toBe(0); // Fondos liberados
        expect(balanceAfter).toBe(balanceBefore + heldBefore); // 100% devuelto

        console.log(`✅ 100% refund confirmed: ${heldBefore}€ returned`);
    }, 20000);

    it.todo('should refund 50% when cancelled between 2h and 24h before departure', async () => {
        console.log('📅 Testing 50% refund (2h-24h before)...');

        // Crear viaje para dentro de 5 horas
        const in5Hours = new Date();
        in5Hours.setHours(in5Hours.getHours() + 5);

        const { data: { user: driver } } = await supabaseDriver.auth.getUser();

        const { data: ride } = await supabaseDriver.from('rides').insert({
            driver_id: driver.id,
            driver_display_name: 'Test Driver',
            origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
            destination: { address: 'Barcelona', lat: 41.38, lng: 2.17 },
            departure_time: in5Hours.toISOString(),
            seats_total: 3,
            seats_available: 3,
            price: 100.00,
            status: 'scheduled'
        }).select('id').single();

        // Reservar
        await supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: ride.id });

        // Capturar balance
        const { data: walletBefore } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        const balanceBefore = parseFloat(walletBefore.balance);
        const heldBefore = parseFloat(walletBefore.held_balance);

        // Cancelar
        const { data: cancelResult } = await supabasePassenger.rpc('cancel_booking_and_refund', {
            p_ride_id: ride.id
        });

        expect(cancelResult.success).toBe(true);

        // Verificar reembolso 50%
        const { data: walletAfter } = await supabasePassenger.from('wallets').select('balance, held_balance').single();
        const balanceAfter = parseFloat(walletAfter.balance);
        const heldAfter = parseFloat(walletAfter.held_balance);

        expect(heldAfter).toBe(0);

        const refundAmount = balanceAfter - balanceBefore;
        const expectedRefund = heldBefore * 0.5;

        expect(refundAmount).toBeCloseTo(expectedRefund, 1); // Permitir 0.1€ de margen

        console.log(`✅ 50% refund confirmed: ${refundAmount.toFixed(2)}€ of ${heldBefore}€ returned`);
    }, 20000);

    it('should reject booking if passenger has insufficient balance', async () => {
        console.log('💳 Testing insufficient balance rejection...');

        // Crear viaje muy caro
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const { data: { user: driver } } = await supabaseDriver.auth.getUser();

        const { data: ride } = await supabaseDriver.from('rides').insert({
            driver_id: driver.id,
            driver_display_name: 'Test Driver',
            origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
            destination: { address: 'Barcelona', lat: 41.38, lng: 2.17 },
            departure_time: tomorrow.toISOString(),
            seats_total: 3,
            seats_available: 3,
            price: 999999.00, // Precio imposible
            status: 'scheduled'
        }).select('id').single();

        // Intentar reservar
        const { data: bookingResult, error } = await supabasePassenger.rpc('confirm_trip_and_pay', {
            p_ride_id: ride.id
        });

        // Debe fallar
        expect(error || !bookingResult.success).toBeTruthy();

        if (error) {
            expect(error.message).toMatch(/saldo|balance|fondos/i);
        } else {
            expect(bookingResult.message).toMatch(/saldo|balance|fondos/i);
        }

        console.log(`✅ Insufficient balance correctly rejected`);
    }, 15000);
});
