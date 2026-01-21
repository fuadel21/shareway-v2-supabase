import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

// Clients
const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const driverClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const p1Client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const p2Client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

const PASS = 'ShareWayTest2026!';
const D_EMAIL = 'driver.elite@shareway.test';
const P1_EMAIL = 'passenger.1@shareway.test';
const P2_EMAIL = 'passenger.2@shareway.test';

describe('🚀 PRODUCTION CHAOS & STRESS TEST (PHASE 2)', () => {
    let driverId, p1Id, p2Id;

    beforeAll(async () => {
        const { data: d } = await driverClient.auth.signInWithPassword({ email: D_EMAIL, password: PASS });
        const { data: p1 } = await p1Client.auth.signInWithPassword({ email: P1_EMAIL, password: PASS });
        const { data: p2 } = await p2Client.auth.signInWithPassword({ email: P2_EMAIL, password: PASS });

        driverId = d.user.id;
        p1Id = p1.user.id;
        p2Id = p2.user.id;
    });

    beforeEach(async () => {
        // Reset balances for EVERY test to ensure isolation
        await supabaseAdmin.from('wallets').upsert([
            { user_id: driverId, balance: 100, held_balance: 0 },
            { user_id: p1Id, balance: 500, held_balance: 0 },
            { user_id: p2Id, balance: 500, held_balance: 0 }
        ]);
        await supabaseAdmin.from('rides').delete().eq('driver_id', driverId);
    });

    describe('🛡️ SECURITY & RLS BREAKING ATTEMPTS', () => {
        it('should NOT allow a passenger to cancel someone else booking', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 15);

            const { data: ride, error: ce } = await driverClient.rpc('create_ride', {
                p_origin: { address: 'Chaos1' }, p_destination: { address: 'Safety1' },
                p_departure_time: departureTime.toISOString(),
                p_seats: 4, p_price: 20, p_distance: 100
            });
            if (ce) throw new Error(`Create ride failed: ${ce.message}`);
            const rideId = ride.rideId;
            await p1Client.rpc('confirm_trip_and_pay', { p_ride_id: rideId });

            const { data, error } = await p2Client.rpc('cancel_booking_and_refund', { p_ride_id: rideId });

            expect(error || (data && !data.success)).toBeTruthy();
            expect(error?.message || data?.message).toMatch(/No tienes una reserva confirmada/i);
        });

        it('should NOT allow a driver to start a ride that is not theirs', async () => {
            // Using admin to insert a ride for p1 as driver (simulating another driver)
            const { data: ride } = await supabaseAdmin.from('rides').insert({
                driver_id: p1Id,
                origin: { address: 'Invasive' }, destination: { address: 'Test' },
                departure_time: new Date(Date.now() + 86400000 * 20).toISOString(),
                seats_total: 1, seats_available: 1, price: 10, status: 'scheduled'
            }).select().single();

            const { error } = await driverClient.rpc('start_ride', { p_ride_id: ride.id });
            expect(error).toBeDefined();
            expect(error.message).toMatch(/No se pudo iniciar el viaje/i);
        });
    });

    describe('💸 FINANCIAL INTEGRITY & CONCURRENCY', () => {
        it('Total Balance Consistency: Money should not vanish', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 25);

            const { data: ride, error: ce } = await driverClient.rpc('create_ride', {
                p_origin: { address: 'Money' }, p_destination: { address: 'Check' },
                p_departure_time: departureTime.toISOString(),
                p_seats: 2, p_price: 100, p_distance: 200
            });
            if (ce) throw new Error(`Create ride failed: ${ce.message}`);
            const rideId = ride.rideId;

            const { data: walletsBefore } = await supabaseAdmin.from('wallets').select('balance, held_balance');
            const totalBefore = walletsBefore.reduce((acc, w) => acc + parseFloat(w.balance) + parseFloat(w.held_balance), 0);

            await Promise.all([
                p1Client.rpc('confirm_trip_and_pay', { p_ride_id: rideId }),
                p2Client.rpc('confirm_trip_and_pay', { p_ride_id: rideId })
            ]);

            await driverClient.rpc('start_ride', { p_ride_id: rideId });

            const { data: pin1 } = await p1Client.rpc('get_my_ride_pin', { p_ride_id: rideId });
            await driverClient.rpc('verify_passenger', { p_ride_id: rideId, p_passenger_id: p1Id, p_pin: pin1.pin });

            const { data: pin2 } = await p2Client.rpc('get_my_ride_pin', { p_ride_id: rideId });
            await driverClient.rpc('verify_passenger', { p_ride_id: rideId, p_passenger_id: p2Id, p_pin: pin2.pin });

            await driverClient.rpc('complete_ride', { p_ride_id: rideId });

            const { data: walletsAfter } = await supabaseAdmin.from('wallets').select('balance, held_balance');
            const totalAfter = walletsAfter.reduce((acc, w) => acc + parseFloat(w.balance) + parseFloat(w.held_balance), 0);

            const fee = (100 * 2) * 0.10;
            expect(totalAfter).toBeCloseTo(totalBefore - fee, 2);
            console.log(`✅ Financial Integrity: Total before ${totalBefore}, Total after ${totalAfter} (Fee: ${fee})`);
        });
    });

    describe('🕒 EDGE CASES: TIMING & STATE', () => {
        it('should NOT allow completing a ride that is not active', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 10);

            const { data: ride, error: ce } = await driverClient.rpc('create_ride', {
                p_origin: { address: 'State' }, p_destination: { address: 'Edge' },
                p_departure_time: departureTime.toISOString(),
                p_seats: 1, p_price: 10, p_distance: 50
            });
            if (ce) throw new Error(`Create ride failed: ${ce.message}`);

            const { error } = await driverClient.rpc('complete_ride', { p_ride_id: ride.rideId });
            expect(error).toBeDefined();
            expect(error.message).toMatch(/no está activo/i);
        });

        it('Grace Period: 100% refund within 15 mins of booking', async () => {
            const departureTime = new Date();
            departureTime.setFullYear(departureTime.getFullYear() + 1); // 1 year away to be very safe

            const { data: ride, error: ce } = await driverClient.rpc('create_ride', {
                p_origin: { address: 'Grace' }, p_destination: { address: 'Period' },
                p_departure_time: departureTime.toISOString(),
                p_seats: 1, p_price: 50, p_distance: 100
            });
            if (ce) throw new Error(`Create ride failed: ${ce.message}`);
            const rideId = ride.rideId;

            const { error: be } = await p1Client.rpc('confirm_trip_and_pay', { p_ride_id: rideId });
            if (be) throw new Error(`Booking failed: ${be.message}`);

            // Immediate cancel (should be 100% refund)
            const { data: cancelResult, error: canE } = await p1Client.rpc('cancel_booking_and_refund', { p_ride_id: rideId });
            if (canE) console.error('Cancel Error:', canE);

            expect(cancelResult.message).toContain('50');

            const { data: wallet } = await p1Client.from('wallets').select('balance').single();
            // Balance should be back to original (reset in beforeAll to 500)
            expect(parseFloat(wallet.balance)).toBe(500);
            console.log('✅ Grace Period Reimbursed 100%');
        });
    });
});
