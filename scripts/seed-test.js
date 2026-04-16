import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PASS = 'ShareWayTest2026!';
const USERS = [
    { 
        id: '10000000-0000-0000-0000-000000000001', 
        email: 'driver.elite@shareway.test', 
        name: 'Test Driver',
        vehicle: { brand: 'Tesla', model: 'Model 3', color: 'Blanco Élite', plate: '7777-SWY' } 
    },
    { 
        id: '10000000-0000-0000-0000-000000000002', 
        email: 'passenger.1@shareway.test', 
        name: 'Passenger 1' 
    },
    { 
        id: '10000000-0000-0000-0000-000000000003', 
        email: 'passenger.2@shareway.test', 
        name: 'Passenger 2' 
    }
];

async function seed() {
    console.log("🚀 MASTER SEED: Provisioning Elite Users...");

    try {
        for (const u of USERS) {
            console.log(`👤 Provisioning ${u.email}...`);

            // Delete if exists
            await supabase.auth.admin.deleteUser(u.id).catch(() => { });

            const { data: authData, error } = await supabase.auth.admin.createUser({
                id: u.id,
                email: u.email,
                password: PASS,
                email_confirm: true,
                user_metadata: { full_name: u.name }
            });

            // Upsert profile with vehicle and verification
            await supabase.from('profiles').upsert({
                id: u.id,
                email: u.email,
                display_name: u.name,
                full_name: u.name,
                vehicle: u.vehicle || null,
                verification: { status: 'verified' }
            });

            // Provision Wallet
            await supabase.from('wallets').upsert({
                user_id: u.id,
                balance: 1000.00,
                held_balance: 0
            });
        }

        console.log("🚕 Adding active ride for testing...");
        const farFuture = new Date();
        farFuture.setHours(farFuture.getHours() + 5); // 5h en el futuro para probar bloqueo 15min

        await supabase.from('rides').insert({
            driver_id: USERS[0].id,
            origin: { address: 'Madrid', coordinates: { lat: 40.41, lng: -3.70 } },
            destination: { address: 'Barcelona', coordinates: { lat: 41.38, lng: 2.17 } },
            departure_time: farFuture.toISOString(),
            seats_total: 4,
            seats_available: 4,
            price: 30.00,
            status: 'scheduled',
            participant_ids: [USERS[0].id]
        });

        console.log("✨ Elite Seed completed successfully!");
    } catch (err) {
        console.error("❌ Seed failure:", err);
    }
}

seed();
