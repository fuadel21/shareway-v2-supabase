import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testCreate() {
    const email = `test-${Math.random().toString(36).substring(7)}@test.com`;
    const { data, error } = await supabase.auth.admin.createUser({
        email: email,
        password: 'Password123!',
        email_confirm: true
    });

    if (error) console.error("FAILED TO CREATE:", error);
    else console.log("SUCCESSFULLY CREATED:", data.user.id, email);
}

testCreate();
