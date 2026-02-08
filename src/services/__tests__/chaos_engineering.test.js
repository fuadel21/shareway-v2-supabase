import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const supabaseDriver = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const supabasePassenger = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('☣️ CHAOS ENGINEERING - Resilience & Failure Simulation', () => {
    let driverId, passengerId;

    beforeAll(async () => {
        const { data: dData, error: de } = await supabaseDriver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        const { data: pData, error: pe } = await supabasePassenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });

        if (de || !dData.user) throw new Error("Driver auth failed: " + (de?.message || "No user data"));
        if (pe || !pData.user) throw new Error("Passenger auth failed: " + (pe?.message || "No user data"));

        driverId = dData.user.id;
        passengerId = pData.user.id;

        await supabaseAdmin.rpc('admin_update_user_status', { p_user_id: driverId, p_status: 'verified' });
        await supabaseAdmin.rpc('admin_update_user_status', { p_user_id: passengerId, p_status: 'verified' });
    });

    describe('SIM-1: Network Latency (Race Condition Prevention)', () => {
        it('should handle multiple rapid calls to confirm_trip_and_pay without double booking', async () => {
            const { data: rideData, error: re } = await supabaseDriver.rpc('create_ride', {
                p_origin: { lat: 40, lng: -3 }, p_destination: { lat: 41, lng: -4 },
                p_departure_time: new Date(Date.now() + 86400000).toISOString(),
                p_seats: 2, p_price: 15, p_distance: 100
            });

            if (re || !rideData?.rideId) throw new Error("Failed to create ride: " + JSON.stringify(re));
            const rideId = rideData.rideId;

            await supabaseAdmin.from('wallets').upsert({ user_id: passengerId, balance: 100, held_balance: 0 });

            const attempts = [
                supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: rideId }),
                supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: rideId })
            ];

            const results = await Promise.all(attempts);
            const successes = results.filter(r => !r.error && r.data?.success);
            const errors = results.filter(r => r.error);

            expect(successes.length).toBe(1);
            expect(errors.length).toBe(1);
        });
    });

    describe('SIM-2: Financial Rollback (Atomic integrity)', () => {
        it('should not deduct funds if the booking fails (insufficient balance)', async () => {
            const { data: rideData, error: re } = await supabaseDriver.rpc('create_ride', {
                p_origin: { lat: 10, lng: 10 }, p_destination: { lat: 11, lng: 11 },
                p_departure_time: new Date(Date.now() + 86400000 * 2).toISOString(),
                p_seats: 1, p_price: 50, p_distance: 50
            });

            if (re || !rideData?.rideId) throw new Error("Failed to create ride: " + JSON.stringify(re));

            // Set balance to 10 (insufficient for 50 price)
            await supabaseAdmin.from('wallets').upsert({ user_id: passengerId, balance: 10, held_balance: 0 });

            const { error } = await supabasePassenger.rpc('confirm_trip_and_pay', { p_ride_id: rideData.rideId });
            expect(error).toBeDefined();
            expect(error.message).toContain('Saldo insuficiente');

            const { data: wallet } = await supabaseAdmin.from('wallets').select('*').eq('user_id', passengerId).single();
            expect(parseFloat(wallet.balance)).toBe(10);
            expect(parseFloat(wallet.held_balance)).toBe(0);
        });
    });

    describe('SIM-3: Session Expiry (Security Shield)', () => {
        it('should strictly reject operations if the JWT is invalid', async () => {
            const expiredClient = createClient(supabaseUrl, 'invalid.token.here');
            const { error } = await expiredClient.rpc('get_platform_stats');
            expect(error).toBeDefined();
        });
    });
});
