import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyFix() {
    console.log('🔧 Applying FIX_GET_USER_NOTIFICATIONS...');

    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', 'FIX_GET_USER_NOTIFICATIONS.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolons to execute statements separately
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        console.log(`📝 Found ${statements.length} SQL statements to execute`);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i] + ';';
            console.log(`\n⚙️  Executing statement ${i + 1}/${statements.length}...`);

            try {
                const { data, error } = await supabase.rpc('exec_sql', {
                    sql_string: statement
                });

                if (error) {
                    console.error(`❌ Error in statement ${i + 1}:`, error.message);
                    console.error('Statement:', statement.substring(0, 200));
                } else {
                    console.log(`✅ Statement ${i + 1} executed successfully`);
                }
            } catch (err) {
                console.error(`❌ Exception in statement ${i + 1}:`, err.message);
            }
        }

        console.log('\n✅ Migration completed!');
        console.log('🔄 Please refresh your browser to see the changes');

    } catch (error) {
        console.error('❌ Error applying fix:', error);
        process.exit(1);
    }
}

applyFix();
