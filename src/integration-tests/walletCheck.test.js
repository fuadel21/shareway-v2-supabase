import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('ShareWay Booking Logic - Deep Diagnostic', () => {
    let adminSb;
    let driverClient, passengerId;

    beforeAll(async () => {
        adminSb = createClient(supabaseUrl, supabaseServiceKey);

        const { data: dData } = await adminSb.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        const { data: pData } = await adminSb.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });
        passengerId = pData.user.id;

        const driverId = dData.user.id;

        console.log('--- Checking Wallet Permission ---');
        const { data: testUpsert, error: upsertErr } = await adminSb.from('wallets').upsert({ user_id: driverId, balance: 100, held_balance: 0 }).select();
        if (upsertErr) console.error('CRITICAL: Upsert failed:', upsertErr);
        else console.log('Upsert result:', testUpsert);

        const { data: testRead, error: readErr } = await adminSb.from('wallets').select('*').eq('user_id', driverId).single();
        if (readErr) console.error('CRITICAL: Read failed:', readErr);
        else console.log('Read result:', testRead);
    });

    it('Environment Check', () => {
        expect(true).toBe(true);
    });
});
