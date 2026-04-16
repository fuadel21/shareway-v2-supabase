
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Faltan variables de entorno en .env.test');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function runTest() {
  try {
    console.log('🚀 Iniciando Test de Ciclo de Vida de Reserva de ShareWay...');

    // 1. Usuarios de Prueba
    const driverEmail = `driver_${Date.now()}@test.com`;
    const passengerEmail = `passenger_${Date.now()}@test.com`;
    const password = 'Password123!';

    console.log('👥 Creando usuarios de prueba...');
    const { data: dAuth } = await supabase.auth.admin.createUser({ email: driverEmail, password, email_confirm: true });
    const { data: pAuth } = await supabase.auth.admin.createUser({ email: passengerEmail, password, email_confirm: true });
    const driverId = dAuth.user.id;
    const passengerId = pAuth.user.id;

    await supabase.from('profiles').update({ full_name: 'Driver Test', gender: 'male' }).eq('id', driverId);
    await supabase.from('profiles').update({ full_name: 'Passenger Test', gender: 'male' }).eq('id', passengerId);

    // 2. Wallets
    console.log('💰 Inicializando Wallets (100€ para pasajero)...');
    await supabase.from('wallets').update({ balance: 100.00, held_balance: 0 }).eq('user_id', passengerId);
    await supabase.from('wallets').update({ balance: 0.00, held_balance: 0 }).eq('user_id', driverId);

    // 3. Publicar Viaje
    console.log('🚗 Publicando viaje (Precio: 25€)...');
    const { data: ride, error: rideErr } = await supabase.from('rides').insert({
      driver_id: driverId,
      origin: { address: 'Madrid', coordinates: [40.41, -3.70] },
      destination: { address: 'Valencia', coordinates: [39.46, -0.37] },
      departure_time: new Date(Date.now() + 3600000).toISOString(),
      price: 25.00,
      seats_total: 4,
      seats_available: 4,
      status: 'scheduled'
    }).select().single();
    if (rideErr) throw rideErr;
    const rideId = ride.id;

    // 4. Matching
    console.log('🔍 Probando matching...');
    const { data: matches } = await supabase.rpc('search_rides_by_corridor', {
      p_origin_lat: 40.41, p_origin_lng: -3.70, p_dest_lat: 39.46, p_dest_lng: -0.37, p_max_dist_meters: 10000
    });
    console.log(`🎯 Matches: ${matches?.length || 0}`);

    // 5. Reserva
    console.log('🎟️ Reservando plaza...');
    const { data: session } = await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: passengerEmail, password });
    const passengerClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } });
    
    const { data: booking, error: bErr } = await passengerClient.rpc('confirm_trip_and_pay', { p_ride_id: rideId, p_pickup_lat: 40.41, p_pickup_lng: -3.70 });
    if (bErr) throw bErr;
    console.log(`✅ Reserva OK. PIN: ${booking.pin}`);

    // Estado Intermedio
    const { data: wMid } = await supabase.from('wallets').select('*').eq('user_id', passengerId).single();
    console.log(`📊 Saldo Pasajero tras reserva: Balance=${wMid.balance}, Held=${wMid.held_balance}`);

    // 6. Iniciar
    await supabase.from('rides').update({ status: 'in_progress' }).eq('id', rideId);

    // 7. Finalizar (El conductor lo hace)
    console.log('🏁 Finalizando viaje y procesando cobro...');
    const { data: dSession } = await supabase.auth.signInWithPassword({ email: driverEmail, password });
    const driverClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${dSession.session.access_token}` } } });

    const { data: res, error: fErr } = await driverClient.rpc('complete_ride', { p_ride_id: rideId });
    if (fErr) {
        console.error('❌ Error en complete_ride RPC:', fErr.message);
        // Intentar ver si es por la firma (p_ride_id vs ride_id)
        const { data: res2, error: fErr2 } = await driverClient.rpc('complete_ride', { ride_id: rideId });
        if (fErr2) console.error('❌ Re-intento fallido:', fErr2.message);
    } else {
        console.log('✅ RPC complete_ride ejecutado:', res);
    }

    // 8. Resultados Finales
    console.log('✨ RESUMEN FINAL:');
    const { data: dW } = await supabase.from('wallets').select('*').eq('user_id', driverId).single();
    const { data: pW } = await supabase.from('wallets').select('*').eq('user_id', passengerId).single();
    
    console.log(`👨‍✈️ Conductor: Balance=${dW.balance}€, Held=${dW.held_balance}€`);
    console.log(`👤 Pasajero: Balance=${pW.balance}€, Held=${pW.held_balance}€`);

    if (dW.balance > 0) console.log('✅ TEST EXITOSO!');
    else console.warn('❌ FALLO: El conductor sigue con balance 0.');

    await supabase.auth.admin.deleteUser(driverId);
    await supabase.auth.admin.deleteUser(passengerId);

  } catch (err) {
    console.error('❌ ERROR FATAL:', err.message);
  }
}

runTest();
