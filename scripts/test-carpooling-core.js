
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Cargar variables de entorno
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
// Usamos SERVICE_ROLE_KEY para poder limpiar datos de prueba y actuar como admin/usuarios diferentes sin loguearnos en frontend
// Si no tienes la service role key en .env.local, usaremos la anon key y simularemos auth si es posible, o pediremos la key.
// Asumo que para test local/dev tienes permisos suficientes o RLS permite tests.
// MEJOR: Usar la ANON KEY y simular login con email/password de prueba si existen, o crear usuarios temporales.
// Para simplificar, intentaré usar la ANON key básica. Si falla por RLS, necesitaré un usuario real.

// NOTA: Para pruebas robustas de backend, lo ideal es tener la SERVICE_ROLE_KEY.
// Voy a intentar leerla del archivo .env si existe, suele llamarse SUPABASE_SERVICE_ROLE_KEY.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Faltan credenciales de Supabase en .env.local");
    process.exit(1);
}

// Cliente Admin (bypass RLS para setup/teardown)
const adminSb = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;
// Cliente normal
const sb = createClient(supabaseUrl, supabaseKey);

async function runTests() {
    console.log("🚀 Iniciando Test de Lógica Core de Carpooling (ShareWay)...");

    // VARIABLES DE PRUEBA
    let driverId, passengerId;
    let rideId, bookingId;

    // 1. SETUP: Conseguir usuarios (o crearlos si tuviéramos admin access, pero usaremos existentes o pediremos login)
    // Para no complicar con Auth real, voy a buscar 2 perfiles existentes aleatorios para usarlos como actores.
    // Esto requiere que las tablas 'profiles' sean legibles.

    console.log("\n👤 Seleccionando actores de prueba...");
    const { data: profiles, error: profilesError } = await sb.from('profiles').select('id, email, display_name').limit(2);

    if (profilesError || !profiles || profiles.length < 2) {
        console.error("❌ No se encontraron suficientes usuarios para la prueba (mínimo 2). Error:", profilesError);
        console.log("⚠️ Asegúrate de tener al menos 2 usuarios registrados en la BD.");
        return;
    }

    driverId = profiles[0].id;
    passengerId = profiles[1].id;
    console.log(`✅ Conductor: ${profiles[0].display_name} (${driverId})`);
    console.log(`✅ Pasajero: ${profiles[1].display_name} (${passengerId})`);

    // 2. PUBLICAR VIAJE (DRIVER)
    console.log("\n🚗 [Test 1] Publicando Viaje (Driver)...");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const rideData = {
        driver_id: driverId,
        origin: { lat: 40.4168, lng: -3.7038, address: "Madrid, España", name: "Madrid" },
        destination: { lat: 41.3851, lng: 2.1734, address: "Barcelona, España", name: "Barcelona" },
        departure_time: tomorrow.toISOString(),
        seats_available: 3,
        seats_total: 3,
        price: 45.50,
        status: 'active',
        // Asumiendo estructura de tu tabla rides
    };

    // Usamos RPC o Insert directo? 
    // Tu app usa 'create_ride' RPC normalmente. Vamos a intentar simular eso o insert directo si RLS lo permite para el "admin" simulado.
    // Como no tengo token de usuario, insertaré directo si las policies son permisivas o fallaré.
    // Si falla, es BUENA SEÑAL (RLS funciona).

    // INTENTO DE INSERT DIRECTO (simulando que somos el sistema)
    // Nota: Esto fallará si RLS está activo y no uso Service Role Key.
    // Si falla, usaré un método alternativo o solo validaré lecturas.

    let rideRes;
    if (adminSb) {
        rideRes = await adminSb.from('rides').insert(rideData).select().single();
    } else {
        // Sin admin key, no puedo suplantar identidades fácilmente sin tokens.
        // Voy a intentar RPC si existe 'debug_create_ride' o similar, si no, avisaré.
        console.log("⚠️ No tengo Service Role Key. Intentando insert público (probablemente fallará por RLS).");
        rideRes = await sb.from('rides').insert(rideData).select().single();
    }

    if (rideRes.error) {
        console.error("❌ Falló la creación del viaje:", rideRes.error.message);
        console.log("💡 Sugerencia: Añade SUPABASE_SERVICE_ROLE_KEY a .env.local para tests de integración.");
        return;
    }

    rideId = rideRes.data.id;
    console.log(`✅ Viaje creado con ID: ${rideId}`);
    console.log(`   Asientos iniciales: ${rideRes.data.seats_available}`);

    // 3. BUSCAR VIAJE (PASSENGER)
    console.log("\n🔍 [Test 2] Buscando Viaje (Passenger)...");
    // Simulamos búsqueda por radio
    // Postgres function search_rides(origin_lat, origin_lng, ...)
    const { data: searchResults, error: searchError } = await sb.rpc('search_rides', {
        origin_lat: 40.41,
        origin_lng: -3.70,
        destination_lat: 41.38,
        destination_lng: 2.17,
        search_radius: 50000, // 50km
        search_date: tomorrow.toISOString().split('T')[0],
        seats_required: 1
    });

    if (searchError) {
        console.error("❌ Error en búsqueda:", searchError);
    } else {
        const found = searchResults?.find(r => r.id === rideId);
        if (found) {
            console.log("✅ Viaje encontrado en los resultados de búsqueda.");
        } else {
            console.warn("⚠️ El viaje creado no aparece en la búsqueda (¿PostGIS configurado? ¿Radio pequeño?).");
            console.log("Resultados:", searchResults?.length);
        }
    }

    // 4. RESERVAR VIAJE (PASSENGER)
    console.log("\n🎫 [Test 3] Solicitando Reserva (Passenger)...");
    const bookingData = {
        ride_id: rideId,
        passenger_id: passengerId,
        seats_booked: 1,
        status: 'pending', // O 'approved' si es instantáneo
        total_price: 45.50
    };

    let bookingRes;
    if (adminSb) {
        bookingRes = await adminSb.from('bookings').insert(bookingData).select().single();
    } else {
        bookingRes = await sb.from('bookings').insert(bookingData).select().single();
    }

    if (bookingRes.error) {
        console.error("❌ Falló la reserva:", bookingRes.error.message);
        return;
    }

    bookingId = bookingRes.data.id;
    console.log(`✅ Reserva creada con ID: ${bookingId} (Estado: ${bookingRes.data.status})`);

    // 5. VALIDAR ASIENTOS (PRE-APROBACIÓN)
    // Dependiendo de tu lógica, pending puede o no reservar asiento.
    // Verifiquemos el viaje de nuevo.
    const { data: rideAfterBooking } = await sb.from('rides').select('seats_available').eq('id', rideId).single();
    console.log(`ℹ️ Asientos disponibles tras reserva PENDIENTE: ${rideAfterBooking.seats_available} (Esperado: Igual o -1 dependiendo de lógica)`);

    // 6. APROBAR RESERVA (DRIVER)
    console.log("\n👍 [Test 4] Aprobando Reserva (Driver)...");

    // Usamos admin para actualizar status
    if (adminSb) {
        const { error: approveError } = await adminSb
            .from('bookings')
            .update({ status: 'approved' })
            .eq('id', bookingId);

        if (approveError) console.error("❌ Error aprobando:", approveError);
        else console.log("✅ Reserva Aprobada.");

        // Disparar Trigger de decremento de asientos? O hacerlo manual?
        // En ShareWay v2 idealmente hay un trigger o función RPC.
        // Vamos a verificar si los asientos bajaron automáticamente.

        const { data: rideAfterApprove } = await adminSb.from('rides').select('seats_available').eq('id', rideId).single();
        console.log(`✅ Asientos tras APROBACIÓN: ${rideAfterApprove.seats_available}`);

        if (rideAfterApprove.seats_available === 3) {
            console.warn("⚠️ ALERTA: Los asientos NO se decrementaron automáticamente. Revisa tus Triggers o RPC de aprobación.");

            // Intento de llamar a función manual si existe
            // await adminSb.rpc('decrement_seats', { ride_id: rideId, count: 1 });
        } else if (rideAfterApprove.seats_available === 2) {
            console.log("Testing passed: Logic de asientos funciona correctamente.");
        }
    } else {
        console.log("⚠️ Saltando test de aprobación por falta de permisos admin (Service Key).");
    }

    // 7. CLEANUP
    console.log("\n🧹 Limpiando datos de prueba...");
    if (adminSb) {
        await adminSb.from('bookings').delete().eq('id', bookingId);
        await adminSb.from('rides').delete().eq('id', rideId);
        console.log("✅ Datos eliminados.");
    } else {
        console.log("⚠️ No se pudieron limpiar los datos (falta admin key). Bórralos manualmente.");
    }
}

runTests().catch(console.error);
