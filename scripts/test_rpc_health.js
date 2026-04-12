import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing environment variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRPC(name, params = {}) {
    console.log(`Testing RPC: ${name}...`);
    const { data, error } = await supabase.rpc(name, params);
    if (error) {
        console.error(`  ❌ ${name} failed:`, error.message);
        return false;
    } else {
        console.log(`  ✅ ${name} success!`);
        return true;
    }
}

async function runTests() {
    console.log("🚀 Starting RPC Health Check...\n");

    const results = {
        'get_platform_stats': await testRPC('get_platform_stats'),
        'get_dashboard_stats': await testRPC('get_dashboard_stats'),
        'confirm_trip_and_pay': await testRPC('confirm_trip_and_pay', { p_ride_id: '00000000-0000-0000-0000-000000000000' }), // Should fail with business error, not PG error
        'search_rides_secure': await testRPC('search_rides_secure', {
            p_origin: { lat: 0, lng: 0 },
            p_destination: { lat: 0, lng: 0 }
        }),
    };

    console.log("\n📊 Health Check Summary:");
    let failed = 0;
    for (const [name, success] of Object.entries(results)) {
        if (!success) failed++;
    }

    if (failed === 0) {
        console.log("✨ All critical RPCs are reachable and defined!");
    } else {
        console.warn(`⚠️ ${failed} RPCs reported issues. Check the log above.`);
    }
}

runTests();
