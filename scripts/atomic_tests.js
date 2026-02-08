
require('dotenv').config({ path: '.env.test' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runAtomicTests() {
    console.log("🚀 Iniciando Fase 1: Pruebas Atómicas de Integridad...");

    // Setup: Create a driver and a passenger
    const driverId = '00000000-0000-0000-0000-000000000001';
    const passenger1Id = '00000000-0000-0000-0000-000000000002';
    const passenger2Id = '00000000-0000-0000-0000-000000000003';

    // Ensure wallets exist and have balance
    await supabase.from('profiles').upsert([
        { id: driverId, display_name: 'Atomic Driver', gender: 'male' },
        { id: passenger1Id, display_name: 'Atomic P1', gender: 'female' },
        { id: passenger2Id, display_name: 'Atomic P2', gender: 'female' }
    ]);

    await supabase.from('wallets').upsert([
        { user_id: driverId, balance: 100 },
        { user_id: passenger1Id, balance: 50 },
        { user_id: passenger2Id, balance: 50 }
    ]);

    // Test 1: Overbooking Prevention (2 passengers, 1 seat)
    console.log("\n🧪 Test 1: Prevención de Overbooking (Race Condition)...");

    const rideTime = new Date(Date.now() + 3600000).toISOString();
    const { data: ride, error: rideError } = await supabase.rpc('create_ride_as_user', {
        p_uid: driverId,
        p_origin: { address: 'Calle A', lat: 40.4168, lng: -3.7038 },
        p_destination: { address: 'Calle B', lat: 40.4168, lng: -3.8038 },
        p_departure_time: rideTime,
        p_seats: 1,
        p_price: 15,
        p_distance: 10
    });

    if (rideError) {
        console.error("❌ Error creando viaje:", rideError);
        return;
    }
    const rideId = ride.rideId || ride;
    console.log(`✅ Viaje creado (ID: ${rideId}) con 1 plaza.`);

    console.log("📡 Lanzando reserva simultánea...");
    const p1Promise = supabase.rpc('confirm_trip_as_user', { p_uid: passenger1Id, p_ride_id: rideId });
    const p2Promise = supabase.rpc('confirm_trip_as_user', { p_uid: passenger2Id, p_ride_id: rideId });

    const results = await Promise.all([p1Promise, p2Promise]);

    const successCount = results.filter(r => r.data?.success === true).length;
    const errorMessages = results.filter(r => r.error).map(r => r.error.message);

    if (successCount === 1) {
        console.log("✅ RESULTADO ESPERADO: Solo 1 pasajero pudo reservar.");
    } else {
        console.error(`❌ FALLO CRÍTICO: ${successCount} pasajeros reservaron la única plaza disponible.`);
    }

    // Test 2: Women Only Policy Enforcement
    console.log("\n🧪 Test 2: Validación de Política 'Solo Mujeres'...");
    const { data: rideW, error: rideWError } = await supabase.rpc('create_ride_as_user', {
        p_uid: driverId, // Driver is male in profiles? Let's check.
        p_origin: { address: 'Calle A', lat: 40.4168, lng: -3.7038 },
        p_destination: { address: 'Calle B', lat: 40.4168, lng: -3.8038 },
        p_departure_time: new Date(Date.now() + 7200000).toISOString(),
        p_seats: 2,
        p_price: 10,
        p_distance: 10,
        p_is_women_only: true
    });

    if (rideWError) {
        console.log("✅ El sistema bloqueó la creación de viaje 'Solo Mujeres' por conductor masculino:", rideWError.message);
    } else {
        console.warn("⚠️ Advertencia: El sistema permitió crear un viaje 'Solo Mujeres' a un hombre (si profile.gender no es 'female')");
    }

    // Test 3: Financial Integrity (Atomic Balance)
    console.log("\n🧪 Test 3: Integridad Financiera...");
    // Check balances after Test 1
    const { data: w1 } = await supabase.from('wallets').select('*').eq('user_id', passenger1Id).single();
    const { data: w2 } = await supabase.from('wallets').select('*').eq('user_id', passenger2Id).single();

    console.log(`P1 Balance: ${w1.balance} (Held: ${w1.held_balance})`);
    console.log(`P2 Balance: ${w2.balance} (Held: ${w2.held_balance})`);

    // Total money in escrow should match the successful booking
    const totalEscrow = parseFloat(w1.held_balance) + parseFloat(w2.held_balance);
    if (totalEscrow === 15) {
        console.log("✅ Integridad financiera confirmada (15€ en Escrow).");
    } else {
        console.error(`❌ Error financiero: ${totalEscrow}€ en Escrow, se esperaba 15€.`);
    }

    console.log("\n--- Fin de Pruebas Atómicas ---");
}

runAtomicTests();
