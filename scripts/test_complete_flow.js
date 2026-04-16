
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function runCompleteFlow() {
  console.log('🏁 Iniciando Test de Flujo: Desde Verificación hasta Liquidación Final...');
  
  const password = 'Password123!';
  try {
    // 1. Setup Usuarios
    const dEmail = `d_${Date.now()}@test.com`;
    const pEmail = `p_${Date.now()}@test.com`;
    
    const { data: dAuth } = await supabase.auth.admin.createUser({ email: dEmail, password, email_confirm: true });
    const { data: pAuth } = await supabase.auth.admin.createUser({ email: pEmail, password, email_confirm: true });
    const dId = dAuth.user.id;
    const pId = pAuth.user.id;

    await supabase.from('profiles').update({ full_name: 'Driver', gender: 'male' }).eq('id', dId);
    await supabase.from('profiles').update({ full_name: 'Passenger', gender: 'male' }).eq('id', pId);
    
    // Inicializar carteras
    await supabase.from('wallets').update({ balance: 50, held_balance: 0 }).eq('user_id', pId);
    await supabase.from('wallets').update({ balance: 0, held_balance: 0 }).eq('user_id', dId);

    // 2. Crear y Reservar
    const { data: ride } = await supabase.from('rides').insert({
      driver_id: dId, price: 20, seats_total: 4, seats_available: 4, status: 'scheduled',
      origin: { address: 'A' }, destination: { address: 'B' }, departure_time: new Date(Date.now() + 3600000).toISOString()
    }).select().single();

    const pClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
    const { data: pSess } = await pClient.auth.signInWithPassword({ email: pEmail, password });
    const authPaxClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${pSess.session.access_token}` } }
    });

    console.log('🎟️ Reservando plaza...');
    const { data: bookRes } = await authPaxClient.rpc('confirm_trip_and_pay', { p_ride_id: ride.id });
    const pin = bookRes.pin;
    console.log(`✅ Reservado. PIN: ${pin}`);

    // 3. Verificación (Conductor introduce PIN)
    const dClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
    const { data: dSess } = await dClient.auth.signInWithPassword({ email: dEmail, password });
    const authDriClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${dSess.session.access_token}` } }
    });

    console.log('🔑 Verificando pasajero con PIN...');
    const { error: vErr } = await authDriClient.rpc('verify_passenger', { p_ride_id: ride.id, p_passenger_id: pId, p_pin: pin });
    if (vErr) throw vErr;
    
    // Comprobar estado "A bordo"
    const { data: rCheck } = await supabase.from('rides').select('passengers').eq('id', ride.id).single();
    const paxStatus = rCheck.passengers[0].status;
    console.log(`📡 Estado del pasajero en DB: ${paxStatus} (Debe ser verified u on_board)`);

    // 4. Iniciar y Completar
    console.log('🚦 Iniciando trayecto...');
    await authDriClient.rpc('start_ride', { p_ride_id: ride.id });

    console.log('🏁 Finalizando trayecto y liquidando pagos...');
    const { data: compRes, error: compErr } = await authDriClient.rpc('complete_ride', { p_ride_id: ride.id });
    if (compErr) throw compErr;
    console.log(`✅ Viaje completado. Saldo transferido: ${compRes.payout}€`);

    // 5. Verificación de Carteras Final
    const { data: walletD } = await supabase.from('wallets').select('*').eq('user_id', dId).single();
    const { data: walletP } = await supabase.from('wallets').select('*').eq('user_id', pId).single();
    
    console.log('\n📊 ESTADO FINAL DE CUENTAS:');
    console.log(`👨‍✈️ Conductor: ${walletD.balance}€ (Antes: 0€)`);
    console.log(`👤 Pasajero: ${walletP.balance}€ (Antes: 50€, Retenido: 20€)`);
    console.log(`🔒 Escrow Pasajero: ${walletP.held_balance}€ (Debe ser 0)`);

    if (walletD.balance === 18 && walletP.held_balance === 0) {
        console.log('\n🌟 TEST DE CICLO COMPLETO EXITOSO: El conductor recibió el 90% (18€) y el Escrow se liberó.');
    } else {
        console.log('\n⚠️ Discrepancia en los saldos finales.');
    }

    // Cleanup
    await supabase.auth.admin.deleteUser(dId);
    await supabase.auth.admin.deleteUser(pId);
  } catch (err) {
    console.error('❌ ERROR FATAL:', err.message);
  }
}

runCompleteFlow();
