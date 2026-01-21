import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('--- RIDES ---');
    const { data: rides } = await supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(3);
    console.log(JSON.stringify(rides, (key, value) => {
        if (key === 'passengers') return value;
        return value;
    }, 2));

    console.log('--- TRANSACTIONS FOR LATEST RIDE ---');
    if (rides.length > 0) {
        const { data: txs } = await supabase.from('transactions').select('*').eq('related_ride_id', rides[0].id);
        console.log(JSON.stringify(txs, null, 2));
    }
}
check();
