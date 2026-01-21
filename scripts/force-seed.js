import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PASS = 'ShareWayTest2026!';

async function forceSeed() {
    console.log("🔥 Force Seeding Users...");

    const users = [
        { email: 'driver@test.com', name: 'Test Driver' },
        { email: 'p1@test.com', name: 'Passenger 1' },
        { email: 'p2@test.com', name: 'Passenger 2' }
    ];

    for (const u of users) {
        console.log(`Processing ${u.email}...`);
        const { data, error } = await supabase.auth.admin.createUser({
            email: u.email,
            password: PASS,
            email_confirm: true,
            user_metadata: { full_name: u.name }
        });

        if (error) {
            console.log(`   - Error creating: ${error.message}`);
            // If exists, just update password
            const { data: list } = await supabase.auth.admin.listUsers();
            const existing = list.users.find(user => user.email === u.email);
            if (existing) {
                console.log(`   - Updating existing user ${existing.id}...`);
                await supabase.auth.admin.updateUserById(existing.id, { password: PASS });
            }
        } else {
            console.log(`   - Created user: ${data.user.id}`);
        }
    }
}

forceSeed();
