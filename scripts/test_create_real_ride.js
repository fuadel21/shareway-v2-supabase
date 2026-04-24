import { createSingleRide } from '../src/services/rideService.js';
import { supabase } from '../src/lib/supabase.js';

async function testRealRideCreation() {
    console.log("🚀 Iniciando prueba de creación de viaje real...");

    try {
        // 1. Obtener el usuario actual
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.error("❌ Error: No hay usuario autenticado. Por favor, inicia sesión en la app primero.");
            return;
        }
        console.log(`✅ Usuario detectado: ${user.email} (${user.id})`);

        // 2. Preparar datos del viaje (24 horas en el futuro)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);

        const testRide = {
            origin: {
                address: "Calle Mayor, Madrid, España",
                name: "Madrid Centro",
                lat: 40.4168,
                lng: -3.7038
            },
            destination: {
                address: "Plaza de Cataluña, Barcelona, España",
                name: "Barcelona Centro",
                lat: 41.3871,
                lng: 2.1700
            },
            dateTime: tomorrow.toISOString(),
            price: 25.50,
            seats: 3,
            details: "Viaje de prueba técnica para auditoría de componentes.",
            isWomenOnly: false
        };

        console.log("📡 Enviando solicitud de creación al servicio...");
        const rideId = await createSingleRide(testRide);

        console.log(`\n✨ ¡VIAJE CREADO CON ÉXITO!`);
        console.log(`🆔 ID del Viaje: ${rideId}`);
        console.log(`🔗 Link para auditar: http://localhost:5173/ride/${rideId}`);

        // 3. Verificación inmediata en DB
        const { data: dbRide, error: dbError } = await supabase
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single();

        if (dbError) throw dbError;

        console.log("\n📊 Auditoría de Datos en DB:");
        console.log(`- Precio guardado: ${dbRide.price}€ (Esperado: 25.5)`);
        console.log(`- Estado inicial: ${dbRide.status} (Esperado: scheduled)`);
        console.log(`- Driver ID: ${dbRide.driver_id} (Debe coincidir con el usuario)`);

        if (dbRide.price === 25.5 && dbRide.driver_id === user.id) {
            console.log("\n✅ PRUEBA SUPERADA: Los datos son íntegros.");
        } else {
            console.log("\n⚠️ PRUEBA PARCIAL: Revisa las discrepancias de datos arriba.");
        }

    } catch (error) {
        console.error("\n❌ Error durante la creación del viaje:");
        console.error(error.message);
    }
}

testRealRideCreation();
