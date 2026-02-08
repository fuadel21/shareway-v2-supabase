import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('--- WALLETS ---');
    const { data: profiles } = await supabase.from('profiles').select('id, email');
    const { data: wallets } = await supabase.from('wallets').select('*');

    wallets.forEach(w => {
        const p = profiles.find(prof => prof.id === w.user_id);
        console.log(`Email: ${p?.email || 'unknown'} | Balance: ${w.balance} | Held: ${w.held_balance}`);
    });

    console.log('--- LATEST TRANSACTIONS ---');
    const { data: txs } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(txs, null, 2));

    console.log('--- LATEST ERRORS ---');
    const { data: errors } = await supabase.from('rpc_error_logs').select('*').order('created_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(errors, null, 2));
}
check();
