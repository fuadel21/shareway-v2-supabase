import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const RPCS_TO_CHECK = [
    'create_payout_request',
    'confirm_trip_and_pay',
    'start_ride',
    'complete_ride',
    'cancel_ride',
    'cancel_pending_booking',
    'cancel_booking_and_refund',
    'create_ride',
    'create_ride_request'
];

async function checkRPCs() {
    console.log('🔍 Checking RPCs existence and signatures...');
    
    for (const rpcName of RPCS_TO_CHECK) {
        // We try to call them with dummy/missing parameters to see the error message
        // If it says "function not found", it's missing.
        // If it says "missing parameter" or "no authenticated", it exists.
        const { error } = await supabase.rpc(rpcName, {});
        
        if (error && error.message.includes('Could not find the function')) {
            console.log(`❌ ${rpcName}: MISSING`);
        } else if (error) {
            console.log(`✅ ${rpcName}: EXISTS (Message: ${error.message})`);
        } else {
            console.log(`✅ ${rpcName}: EXISTS (Success call - unexpected but fine)`);
        }
    }
}

checkRPCs();
