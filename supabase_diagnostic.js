import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: No se encontraron las variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log('--- Iniciando Diagnóstico de Supabase ---');

    // 1. Verificar Tabla Chats
    console.log('\n1. Verificando tabla "chats":');
    const { data: chatCols, error: chatError } = await supabase
        .from('chats')
        .select('*')
        .limit(1);

    if (chatError) {
        console.log('❌ Error al acceder a "chats":', chatError.message);
        if (chatError.message.includes('column "participants" does not exist')) {
            console.log('   ⚠️ CONFIRMADO: La columna "participants" NO existe.');
        }
    } else {
        console.log('✅ Tabla "chats" accesible.');
        if (chatCols.length > 0) {
            console.log('   Columnas detectadas en el primer registro:', Object.keys(chatCols[0]));
        }
    }

    // 2. Verificar Función get_user_rides
    console.log('\n2. Verificando función "get_user_rides":');
    const { data: rideData, error: rideError } = await supabase
        .rpc('get_user_rides', { p_role: 'all' });

    if (rideError) {
        console.log('❌ Error al llamar a "get_user_rides":', rideError.message);
        console.log('   Diferencia técnica:', rideError);
    } else {
        console.log('✅ Función "get_user_rides" funciona correctamente.');
    }

    console.log('\n--- Diagnóstico Finalizado ---');
}

diagnose();
