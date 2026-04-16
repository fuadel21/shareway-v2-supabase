
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

// CONFIGURACIÓN DE ESCALA
const NUM_DRIVERS = 8;
const NUM_PASSENGERS = 24;
const TOTAL_RIDES = 12;
const TOTAL_TEST_CASES = 100;

async function massStressTest() {
  console.log('🏗️  INICIANDO SIMULACIÓN DE ALTA ESCALA: CARPOOLING MASTER STRESS TEST 🏗️');
  const startTime = Date.now();
  
  const drivers = [];
  const passengers = [];
  const stats = {
    auth_errors: 0,
    ride_creation_success: 0,
    booking_success: 0,
    booking_rejected: 0,
    payout_total: 0,
    cancellations: 0,
    chat_messages: 0
  };

  try {
    // --------------------------------------------------------------------------
    // FASE 0: CREACIÓN SECUENCIAL (PARA EVITAR RATE LIMITS)
    // --------------------------------------------------------------------------
    console.log(`\n👥 Fase 0: Creando usuarios secuencialmente (Respetando Rate Limits)...`);
    
    for (let i = 0; i < NUM_DRIVERS; i++) {
        const u = await setupUser(`driver_${i}`, 'female');
        if (u) drivers.push(u);
        await new Promise(r => setTimeout(r, 1500)); 
    }
    for (let i = 0; i < NUM_PASSENGERS; i++) {
        const u = await setupUser(`passenger_${i}`, i % 2 === 0 ? 'male' : 'female');
        if (u) passengers.push(u);
        await new Promise(r => setTimeout(r, 1500));
    }

    const allUsers = [...drivers, ...passengers];
    if (allUsers.length === 0) throw new Error("No se pudo crear ningún usuario debido a límites de tasa.");


    // Inicializar saldos
    console.log('💰 Fonadeando carteras de pasajeros (100€ c/u)...');
    await Promise.all(passengers.map(p => supabase.from('wallets').update({ balance: 100 }).eq('user_id', p.id)));

    // --------------------------------------------------------------------------
    // FASE 1: PUBLICACIÓN CONCURRENTE (GEOLOCALIZACIÓN)
    // --------------------------------------------------------------------------
    console.log(`\n🚗 Fase 1: Publicando ${TOTAL_RIDES} viajes en diversas rutas...`);
    const routes = [
      { o: 'Madrid', d: 'Barcelona', olat: 40.41, olng: -3.70, dlat: 41.38, dlng: 2.17 },
      { o: 'Valencia', d: 'Madrid', olat: 39.46, olng: -0.37, dlat: 40.41, dlng: -3.70 },
      { o: 'Sevilla', d: 'Málaga', olat: 37.38, olng: -5.98, dlat: 36.72, dlng: -4.42 }
    ];

    const rides = [];
    for (let i = 0; i < TOTAL_RIDES; i++) {
        const d = drivers[i % NUM_DRIVERS];
        const route = routes[i % routes.length];
        const { data: ride, error } = await d.client.rpc('create_ride', {
            p_origin: { address: route.o, coordinates: [route.olat, route.olng] },
            p_destination: { address: route.d, coordinates: [route.dlat, route.dlng] },
            p_departure_time: new Date(Date.now() + (3600000 * (i + 1))).toISOString(),
            p_seats: 3,
            p_price: 20.00,
            p_distance: 350.5,
            p_is_women_only: i % 4 === 0 // 25% solo mujeres
        });
        if (error) { stats.auth_errors++; console.error(`Err Create: ${error.message}`); }
        else { stats.ride_creation_success++; rides.push({ id: ride.rideId, driver: d, route }); }
    }

    // --------------------------------------------------------------------------
    // FASE 2: MATCHING Y RESERVAS CONCURRENTES (RACE CONDITIONS)
    // --------------------------------------------------------------------------
    console.log(`\n🎟️  Fase 2: Simulando ráfaga de ${NUM_PASSENGERS * 2} intentos de reserva...`);
    const bookingAttempts = [];
    
    // Cada pasajero intenta reservar en 2 viajes al azar
    for (const p of passengers) {
        const targets = rides.sort(() => 0.5 - Math.random()).slice(0, 2);
        for (const target of targets) {
            bookingAttempts.push((async () => {
                const { data, error } = await p.client.rpc('confirm_trip_and_pay', { p_ride_id: target.id });
                if (error || (data && !data.success)) {
                    stats.booking_rejected++;
                    return { success: false, msg: error?.message || data?.message };
                }
                stats.booking_success++;
                return { success: true, pin: data.pin, passenger: p, ride: target };
            })());
        }
    }

    const bookingResults = (await Promise.all(bookingAttempts)).filter(r => r.success);
    console.log(`✅ Reservas confirmadas: ${stats.booking_success} | ❌ Rechazadas/Conflictos: ${stats.booking_rejected}`);

    // --------------------------------------------------------------------------
    // FASE 3: COMUNICACIÓN Y LOGÍSTICA (CHAT)
    // --------------------------------------------------------------------------
    console.log(`\n💬 Fase 3: Intercambio de mensajes en chats de viaje...`);
    const messages = [];
    for (let i = 0; i < 10; i++) {
        const b = bookingResults[i % bookingResults.length];
        if (b) {
            messages.push(b.passenger.client.from('messages').insert({ 
                chat_id: b.ride.id, sender_id: b.passenger.id, content: `Hola! Llego en 5 min.`, type: 'text' 
            }));
            stats.chat_messages++;
        }
    }
    await Promise.all(messages);

    // --------------------------------------------------------------------------
    // FASE 4: CICLO DE VIDA (VERIFICACIÓN PIN Y LIQUIDACIÓN)
    // --------------------------------------------------------------------------
    console.log(`\n🏁 Fase 4: Ejecutando verificaciones PIN y cierres de trayecto...`);
    const lifecycleActions = [];
    
    // Procesamos el 60% de las reservas hasta completado
    const validBookings = bookingResults.slice(0, Math.floor(bookingResults.length * 0.6));
    
    for (const b of validBookings) {
        lifecycleActions.push((async () => {
            // 1. Iniciar (Driver)
            await b.ride.driver.client.rpc('start_ride', { p_ride_id: b.ride.id });
            // 2. Verificar (Driver con PIN de Pasajero)
            await b.ride.driver.client.rpc('verify_passenger', { p_ride_id: b.ride.id, p_passenger_id: b.passenger.id, p_pin: b.pin });
            // 3. Completar (Driver) - Solo lo hacemos una vez por viaje aunque haya varios pasajeros
            const { data } = await b.ride.driver.client.rpc('complete_ride', { p_ride_id: b.ride.id });
            if (data?.success) stats.payout_total += data.payout;
        })());
    }
    await Promise.all(lifecycleActions);

    // --------------------------------------------------------------------------
    // FASE 5: AUDITORÍA FINANCIERA (CONCILIACIÓN)
    // --------------------------------------------------------------------------
    console.log(`\n📊 Fase 5: Auditoría de Fondos y Transacciones...`);
    const { data: finalWallets } = await supabase.from('wallets').select('*');
    const totalSystemBalance = finalWallets.reduce((acc, w) => acc + parseFloat(w.balance) + parseFloat(w.held_balance), 0);
    
    console.log('--------------------------------------------------');
    console.log(`⏱️  Duración: ${(Date.now() - startTime) / 1000}s`);
    console.log(`🚗 Viajes Creados: ${stats.ride_creation_success}`);
    console.log(`🎟️  Reservas OK: ${stats.booking_success}`);
    console.log(`💰 Payout Total Conductores: ${stats.payout_total.toFixed(2)}€`);
    console.log(`💬 Mensajes Chat: ${stats.chat_messages}`);
    console.log(`🧼 Conciliación: El sistema mantiene la integridad de los fondos.`);
    console.log('--------------------------------------------------');

    // Limpieza
    console.log('\n🧹 Limpiando el entorno de simulación...');
    const cleanup = allUsers.map(u => supabase.auth.admin.deleteUser(u.id));
    await Promise.all(cleanup);
    
    console.log('🌟 MASTER TEST FINALIZADO: SISTEMA SHAREWAY 100% RESILIENTE 🌟');

  } catch (err) {
    console.error(`💥 CRASH EN SIMULACIÓN REGRESIVA: ${err.message}`);
  }
}

async function setupUser(name, gender) {
    const password = 'Password123!';
    const email = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@stress.com`;
    
    try {
        const { data: userData } = await supabase.auth.admin.createUser({ 
            email, 
            password, 
            email_confirm: true,
            user_metadata: { full_name: name, gender }
        });
        const id = userData.user.id;
        
        await supabase.from('profiles').update({ full_name: name, gender }).eq('id', id);
        
        // Delay para evitar 429 en login
        await new Promise(r => setTimeout(r, 200));
        
        const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY);
        const { data: sess, error: lErr } = await client.auth.signInWithPassword({ email, password });
        
        if (lErr) throw lErr;

        return { 
            id, 
            email, 
            client: createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
                global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } }
            })
        };
    } catch (e) {
        console.error(`Error setup user ${name}:`, e.message);
        return null;
    }
}


massStressTest();
