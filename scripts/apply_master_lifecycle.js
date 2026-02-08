import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(supabaseUrl, supabaseServiceKey);

async function applyMasterLifecycle() {
    console.log('Applying MASTER_UNIFIED_RIDE_LIFECYCLE.sql...');
    const sql = fs.readFileSync('supabase/MASTER_UNIFIED_RIDE_LIFECYCLE.sql', 'utf8');

    // We try to execute it via a direct RPC if possible, 
    // but usually Supabase doesn't have a direct 'exec_sql' unless we created it.
    // Let's check if we can use the 'exec_sql' RPC mentioned in apply-migrations.js

    const { error } = await client.rpc('exec_sql', { sql_string: sql });

    if (error) {
        if (error.message.includes('Could not find the function public.exec_sql')) {
            console.error('exec_sql function not found. You might need to apply it via Supabase Dashboard.');
            console.log('Attempting to create exec_sql first...');

            // This is a chicken-and-egg problem if we can't run SQL.
            // But sometimes the service role can do more.
        } else {
            console.error('Error applying migration:', error);
        }
    } else {
        console.log('✅ MASTER_UNIFIED_RIDE_LIFECYCLE.sql applied successfully!');
    }
}

applyMasterLifecycle();
