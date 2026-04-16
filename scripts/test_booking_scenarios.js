
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function runScenarios() {
  console.log('🧪 Iniciando batería de pruebas para Escenarios de Reserva...');
  
  const password = 'Password123!';
  const users = {};

  try {
    // SETUP: Usuarios
    console.log('👥 Creando usuarios de prueba...');
    const createU = async (name, gender = 'male') => {
        const email = `${name}_${Date.now()}@test.com`;
        const { data } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
        const id = data.user.id;
        await supabase.from('profiles').update({ full_name: name, gender }).eq('id', id);
        await supabase.from('wallets').update({ balance: 0, held_balance: 0 }).eq('user_id', id);
        return { id, email, client: createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY) };
    };

    users.driver = await createU('driver');
    users.driver_female = await createU('driver_female', 'female');
    users.passenger = await createU('passenger');
    users.passenger_male = await createU('passenger_male', 'male');

    // Login passengers
    const login = async (user) => {
        const { data } = await user.client.auth.signInWithPassword({ email: user.email, password });
        user.client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
        });
    };
    await login(users.passenger);
    await login(users.passenger_male);
    await login(users.driver);

    // ESCENARIO 1: Éxito
    console.log('\n🔹 Escenario 1: Reserva Exitosa');
    const { data: ride1 } = await supabase.from('rides').insert({
        driver_id: users.driver.id, price: 10, seats_total: 2, seats_available: 2, status: 'scheduled',
        origin: { address: 'A' }, destination: { address: 'B' }, departure_time: new Date(Date.now() + 3600000).toISOString()
    }).select().single();
    
    await supabase.from('wallets').update({ balance: 20 }).eq('user_id', users.passenger.id);
    const { data: res1, error: err1 } = await users.passenger.client.rpc('confirm_trip_and_pay', { p_ride_id: ride1.id });
    console.log(res1?.success ? '✅ Éxito confirmado' : `❌ Falló: ${err1?.message || res1?.message}`);

    // ESCENARIO 2: Saldo Insuficiente
    console.log('\n🔹 Escenario 2: Saldo Insuficiente');
    await supabase.from('wallets').update({ balance: 5 }).eq('user_id', users.passenger_male.id);
    const { data: res2, error: err2 } = await users.passenger_male.client.rpc('confirm_trip_and_pay', { p_ride_id: ride1.id });
    console.log(err2 || res2?.success === false ? `✅ Error capturado: ${err2?.message || res2?.message}` : '❌ NO capturó el error');

    // ESCENARIO 3: Sin Plazas
    console.log('\n🔹 Escenario 3: Viaje Lleno');
    // Llenamos la última plaza del ride1
    await supabase.from('wallets').update({ balance: 50 }).eq('user_id', users.passenger_male.id);
    await users.passenger_male.client.rpc('confirm_trip_and_pay', { p_ride_id: ride1.id });
    // Intentamos una tercera reserva
    const p3 = await createU('passenger3');
    await login(p3);
    await supabase.from('wallets').update({ balance: 50 }).eq('user_id', p3.id);
    const { data: res3, error: err3 } = await p3.client.rpc('confirm_trip_and_pay', { p_ride_id: ride1.id });
    console.log(err3 || res3?.success === false ? `✅ Error capturado: ${err3?.message || res3?.message}` : '❌ NO capturó el error');

    // ESCENARIO 4: Reserva Duplicada
    console.log('\n🔹 Escenario 4: Reserva Duplicada');
    const { data: ride2 } = await supabase.from('rides').insert({
        driver_id: users.driver.id, price: 10, seats_total: 5, seats_available: 5, status: 'scheduled',
        origin: { address: 'A' }, destination: { address: 'B' }, departure_time: new Date(Date.now() + 3600000).toISOString()
    }).select().single();
    await users.passenger.client.rpc('confirm_trip_and_pay', { p_ride_id: ride2.id });
    const { data: res4, error: err4 } = await users.passenger.client.rpc('confirm_trip_and_pay', { p_ride_id: ride2.id });
    console.log(err4 || res4?.success === false ? `✅ Error capturado: ${err4?.message || res4?.message}` : '❌ NO capturó el error');

    // ESCENARIO 5: Reservar Propio Viaje
    console.log('\n🔹 Escenario 5: Reservar Propio Viaje');
    const { data: res5, error: err5 } = await users.driver.client.rpc('confirm_trip_and_pay', { p_ride_id: ride2.id });
    console.log(err5 || res5?.success === false ? `✅ Error capturado: ${err5?.message || res5?.message}` : '❌ NO capturó el error');

    // ESCENARIO 6: Restricción de Género (Solo Mujeres)
    console.log('\n🔹 Escenario 6: Solo Mujeres (Intento por Hombre)');
    const { data: rideW } = await supabase.from('rides').insert({
        driver_id: users.driver_female.id, price: 10, seats_total: 4, seats_available: 4, status: 'scheduled', is_women_only: true,
        origin: { address: 'A' }, destination: { address: 'B' }, departure_time: new Date(Date.now() + 3600000).toISOString()
    }).select().single();
    const { data: res6, error: err6 } = await users.passenger_male.client.rpc('confirm_trip_and_pay', { p_ride_id: rideW.id });
    console.log(err6 || res6?.success === false ? `✅ Error capturado: ${err6?.message || res6?.message}` : '❌ NO capturó el error');

    // LIMPIEZA
    console.log('\n🧹 Limpiando usuarios...');
    for (const u of Object.values(users)) await supabase.auth.admin.deleteUser(u.id);
    await supabase.auth.admin.deleteUser(p3.id);

    console.log('\n🏁 PRUEBAS FINALIZADAS');

  } catch (err) {
    console.error('❌ ERROR DURANTE LOS ESCENARIOS:', err.message);
  }
}

runScenarios();
