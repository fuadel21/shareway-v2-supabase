import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const supabaseDriver = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const supabasePassenger = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('Comprehensive Carpooling Flow & Security Audit', () => {
    let driverId, passengerId;
    let testRideId;

    beforeAll(async () => {
        const { data: dData, error: de } = await supabaseDriver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        const { data: pData, error: pe } = await supabasePassenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });

        if (de || pe) throw new Error(`Auth failed: ${de?.message || pe?.message}`);

        driverId = dData.user.id;
        passengerId = pData.user.id;

        await supabaseAdmin.from('rides').delete().eq('driver_id', driverId);
        await supabaseAdmin.from('transactions').delete().in('user_id', [driverId, passengerId]);
        await supabaseAdmin.from('wallets').upsert({ user_id: driverId, balance: 100, held_balance: 0 });
        await supabaseAdmin.from('wallets').upsert({ user_id: passengerId, balance: 500, held_balance: 0 });
    });

    describe('1. Ride Creation', () => {
        it('should allow creating a valid ride', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 5);

            const { data, error } = await supabaseDriver.rpc('create_ride', {
                p_origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
                p_destination: { address: 'Valencia', lat: 39.46, lng: -0.37 },
                p_departure_time: departureTime.toISOString(),
                p_seats: 4,
                p_price: 25.00,
                p_distance: 350,
                p_details: 'Viaje tranquilo'
            });

            if (error) console.error('Create Ride Error:', error);
            expect(error).toBeNull();
            expect(data.success).toBe(true);
            testRideId = data.rideId;
        });
    });

    describe('2. Booking & Escrow', () => {
        it('should allow booking and hold funds correctly', async () => {
            const { data: result, error } = await supabasePassenger.rpc('confirm_trip_and_pay', {
                p_ride_id: testRideId
            });

            if (error) console.error('Booking Error:', error);
            expect(error).toBeNull();
            expect(result.success).toBe(true);

            const { data: wallet } = await supabaseAdmin.from('wallets').select('*').eq('user_id', passengerId).single();
            expect(parseFloat(wallet.held_balance)).toBe(25.00);
        });
    });

    describe('3. Lifecycle: Start → Verify → Complete', () => {
        it('should transition to active', async () => {
            const { data, error } = await supabaseDriver.rpc('start_ride', { p_ride_id: testRideId });
            expect(error).toBeNull();
            expect(data.success).toBe(true);
        });

        it('should record GPS', async () => {
            const { error } = await supabaseDriver.rpc('update_ride_location', {
                p_ride_id: testRideId,
                p_location: { lat: 40.42, lng: -3.69 }
            });
            expect(error).toBeNull();
        });

        it('should verify passenger', async () => {
            const { data: pinData } = await supabasePassenger.rpc('get_my_ride_pin', { p_ride_id: testRideId });
            const { data: verifyResult, error } = await supabaseDriver.rpc('verify_passenger', {
                p_ride_id: testRideId,
                p_passenger_id: passengerId,
                p_pin: pinData.pin
            });
            expect(error).toBeNull();
            expect(verifyResult.success).toBe(true);
        });

        it('should complete and payout', async () => {
            const { data: result, error } = await supabaseDriver.rpc('complete_ride', { p_ride_id: testRideId });
            expect(error).toBeNull();
            expect(result.success).toBe(true);
        });
    });

    describe('4. Audit Verification', () => {
        it('should have recorded transactions', async () => {
            const { data: txs } = await supabaseAdmin.from('transactions')
                .select('*')
                .eq('related_ride_id', testRideId);

            expect(txs.some(t => t.type === 'hold')).toBe(true);
            expect(txs.some(t => t.type === 'payout')).toBe(true);
        });
    });

    describe('5. Stress: Concurrency', () => {
        it('should only allow one booking for the last seat', async () => {
            const { data } = await supabaseDriver.rpc('create_ride', {
                p_origin: { address: 'Stress' }, p_destination: { address: 'End' },
                p_departure_time: new Date(Date.now() + 86400000 * 30).toISOString(),
                p_seats: 1, p_price: 10, p_distance: 50
            });
            const rideId = data.rideId;

            // Use two different passenger clients to avoid "already booked" error if it was checking that.
            // But here we use the same passenger email, so we need another passenger for true concurrency test.
            // Let's provision 'passenger.2@shareway.test' too.
            const supabaseP2 = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
            await supabaseP2.auth.signInWithPassword({ email: 'passenger.2@shareway.test', password: PASS });

            const attempts = [
                supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: rideId }),
                supabaseP2.rpc('confirm_trip_and_pay', { p_ride_id: rideId })
            ];

            const results = await Promise.all(attempts);
            const successes = results.filter(r => !r.error && r.data?.success);

            if (successes.length !== 1) {
                console.log('Concurrency Results:', JSON.stringify(results, null, 2));
            }
            expect(successes.length).toBe(1);
        });
    });
});
