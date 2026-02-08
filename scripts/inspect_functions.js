import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectFunctions() {
    console.log('🔍 Inspecting create_ride and other RPCs...');

    const { data, error } = await supabase.rpc('exec_sql', {
        sql_string: `
            SELECT 
                p.proname,
                pg_get_function_arguments(p.oid) as args,
                n.nspname as schema
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND p.proname IN ('create_ride', 'confirm_trip_and_pay', 'start_ride', 'complete_ride', 'verify_passenger')
            ORDER BY p.proname;
        `
    });

    if (error) {
        if (error.message.includes('exec_sql')) {
            // If exec_sql doesn't exist, try to use a different way or just list them via a normal query if permissions allow
            // Usually we can't run raw SQL via RPC unless exec_sql exists.
            // Let's try to see if we can use the 'rpc' tool but it doesn't support raw SQL query results.
            console.error('❌ exec_sql not available. Attempting via standard select if possible (unlikely for pg_proc)...');

            // Try a simpler check
            const { data: d2, error: e2 } = await supabase.from('rides').select('id').limit(1);
            if (e2) console.error('Connection error:', e2.message);
            else console.log('✅ Connection to Supabase is OK.');
        } else {
            console.error('Error:', error.message);
        }
    } else {
        console.log('--- Database Functions ---');
        data.forEach(f => {
            console.log(`[${f.proname}] Arguments: ${f.args}`);
        });
        console.log('---------------------------');
    }
}

inspectFunctions();
