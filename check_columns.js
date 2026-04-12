import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    const { data, error } = await supabase.rpc('get_table_columns', { p_table_name: 'ride_requests' });
    if (error) {
        // Fallback: Try a simple query
        const { data: qData, error: qError } = await supabase.from('ride_requests').select('*').limit(1);
        if (qError) {
            console.error('Error fetching ride_requests:', qError);
        } else {
            console.log('Columns in ride_requests:', Object.keys(qData[0] || {}));
        }
    } else {
        console.log('Columns in ride_requests:', data);
    }
}

checkSchema();
