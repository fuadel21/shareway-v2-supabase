import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('ShareWay Booking Logic - Final Validation', () => {
    let adminSb;
    let driverClient, passengerClient;
    let driverId, passengerId;
    let rideId;
    let passengerPin;

    beforeAll(async () => {
        adminSb = createClient(supabaseUrl, supabaseServiceKey);

        const { data: dData } = await adminSb.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        driverId = dData.user.id;
        driverClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${dData.session.access_token}` } }
        });

        const { data: pData } = await adminSb.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });
        passengerId = pData.user.id;
        passengerClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${pData.session.access_token}` } }
        });

        console.log('--- Resetting Environment ---');
        await adminSb.from('rides').delete().eq('driver_id', driverId);
        await adminSb.from('wallets').upsert({ user_id: driverId, balance: 100, held_balance: 0 });
        await adminSb.from('wallets').upsert({ user_id: passengerId, balance: 100, held_balance: 0 });
    });

    it('Step 1: Driver creates a ride', async () => {
        // Usamos una hora aleatoria lejana para evitar conflictos de 2h en el entorno de test
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        futureDate.setHours(Math.floor(Math.random() * 24));

        const { data, error } = await driverClient.rpc('create_ride', {
            p_origin: { address: 'Origin', lat: 40, lng: -3 },
            p_destination: { address: 'Dest', lat: 39, lng: -0.1 },
            p_departure_time: futureDate.toISOString(),
            p_seats: 4,
            p_price: 20.00,
            p_distance: 350,
            p_details: 'Final Test'
        });

        expect(error).toBeNull();
        rideId = data.rideId;
    });

    it('Step 2: Passenger reserves seat (Escrow Check)', async () => {
        const { data, error } = await passengerClient.rpc('confirm_trip_and_pay', {
            p_ride_id: rideId
        });

        expect(error).toBeNull();
        passengerPin = data.pin;

        const { data: wallet } = await adminSb.from('wallets').select('balance, held_balance').eq('user_id', passengerId).single();
        expect(Number(wallet.balance)).toBe(80);
        expect(Number(wallet.held_balance)).toBe(20);
    });

    it('Step 3: Driver starts the ride', async () => {
        const { data, error } = await driverClient.rpc('start_ride', {
            p_ride_id: rideId
        });
        expect(error).toBeNull();
    });

    it('Step 4: Driver verifies passenger with PIN', async () => {
        const { data, error } = await driverClient.rpc('verify_passenger', {
            p_ride_id: rideId,
            p_passenger_id: passengerId,
            p_pin: passengerPin
        });
        expect(error).toBeNull();
    });

    it('Step 5: Driver completes the ride (Financial distribution)', async () => {
        const { data, error } = await driverClient.rpc('complete_ride', {
            p_ride_id: rideId
        });

        expect(error).toBeNull();
        expect(Number(data.payout)).toBe(18);

        // Final verification with logging if fails
        const { data: dWallet, error: dErr } = await adminSb.from('wallets').select('*').eq('user_id', driverId).single();
        if (dErr) console.error('Driver Wallet Error:', dErr);
        expect(dWallet).not.toBeNull();
        expect(Number(dWallet.balance)).toBe(118);

        const { data: pWallet, error: pErr } = await adminSb.from('wallets').select('*').eq('user_id', passengerId).single();
        if (pErr) console.error('Passenger Wallet Error:', pErr);
        expect(pWallet).not.toBeNull();
        expect(Number(pWallet.balance)).toBe(80);
        expect(Number(pWallet.held_balance)).toBe(0);

        console.log('✅ COMPLETE LIFECYCLE VALIDATED SUCCESSFULLY!');
    });
});
