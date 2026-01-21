import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PASS = 'ShareWayTest2026!';
const USERS = [
    { id: '10000000-0000-0000-0000-000000000001', email: 'driver.elite@shareway.test', name: 'Test Driver' },
    { id: '10000000-0000-0000-0000-000000000002', email: 'passenger.1@shareway.test', name: 'Passenger 1' },
    { id: '10000000-0000-0000-0000-000000000003', email: 'passenger.2@shareway.test', name: 'Passenger 2' }
];

async function seed() {
    console.log("🚀 MASTER SEED: Clean & Provision...");

    try {
        // Cleaning
        console.log("🧹 Cleaning profiles/rides...");
        // Borrar dependencias explícitas para asegurar limpieza
        await supabase.from('rides').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');

        for (const u of USERS) {
            console.log(`👤 Provisioning ${u.email}...`);

            // Delete if exists (Nuclear option)
            await supabase.auth.admin.deleteUser(u.id).catch(() => { });

            const { data, error } = await supabase.auth.admin.createUser({
                id: u.id,
                email: u.email,
                password: PASS,
                email_confirm: true,
                user_metadata: { full_name: u.name }
            });

            if (error) {
                console.warn(`   ⚠️ Warning: ${error.message} (attempting password reset)`);
                await supabase.auth.admin.updateUserById(u.id, { password: PASS });
            } else {
                console.log(`   ✅ User ready: ${u.id}`);
            }

            // Ensure profile exists with verification
            await supabase.from('profiles').upsert({
                id: u.id,
                email: u.email,
                display_name: u.name,
                full_name: u.name,
                verification: { status: 'verified' }
            });

            // Ensure wallet has funds
            const balance = u.id.endsWith('1') ? 100 : 500;
            await supabase.from('wallets').upsert({
                user_id: u.id,
                balance: balance,
                held_balance: 0
            });
        }

        console.log("🚕 Adding reference ride...");
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(12, 0, 0, 0);

        await supabase.from('rides').insert({
            driver_id: USERS[0].id,
            origin: { address: 'Madrid', lat: 40.41, lng: -3.70 },
            destination: { address: 'Barcelona', lat: 41.38, lng: 2.17 },
            departure_time: tomorrow.toISOString(),
            seats_total: 4,
            seats_available: 4,
            price: 30.00,
            status: 'scheduled'
        });

        console.log("✨ Seed completed successfully!");
    } catch (err) {
        console.error("❌ Master Seed CRITICAL FAILURE:", err);
    }
}

seed();
