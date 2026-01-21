/**
 * TEST DE SEGURIDAD GEOGRÁFICA (GPS Enforcement)
 * Objetivo: Validar que los cobros están bloqueados si no hay cercanía física al destino.
 */
import { supabase } from '@/lib/supabase';

describe('Seguridad de Cobro (Geofencing)', () => {
    const testRideId = '195c75e7-8562-4d80-8586-7152f5ad8d1a'; // Ride para pruebas de sistema

    test('Debe denegar el cobro si el conductor está lejos del destino', async () => {
        // 1. Simular ubicación remota (Madrid) para un destino en Barcelona
        await supabase.rpc('update_ride_location', {
            p_ride_id: testRideId,
            p_lat: 40.4167,
            p_lng: -3.7037
        });

        // 2. Intentar finalizar viaje
        const { data, error } = await supabase.rpc('complete_ride', { p_ride_id: testRideId });

        // RESULTADO OBSERVABLE: Error de geofencing
        expect(error).toBeDefined();
        expect(error.message).toContain('DESTINO_NO_ALCANZADO');
        
        // El viaje NO debe haber pasado a completado
        const { data: ride } = await supabase.from('rides').select('status').eq('id', testRideId).single();
        expect(ride.status).toBe('active');
    });

    test('Debe permitir el cobro si el conductor está en el radio de destino', async () => {
        // 1. Obtener coordenadas de destino reales del viaje
        const { data: rideData } = await supabase.from('rides').select('destination').eq('id', testRideId).single();
        const { lat, lng } = rideData.destination;

        // 2. Simular ubicación exacta en destino
        await supabase.rpc('update_ride_location', {
            p_ride_id: testRideId,
            p_lat: lat,
            p_lng: lng
        });

        // 3. Intentar finalizar viaje
        const { data, error } = await supabase.rpc('complete_ride', { p_ride_id: testRideId });

        // RESULTADO OBSERVABLE: Éxito
        if (error) console.error("Fallo inesperado en GPS test:", error);
        expect(error).toBeNull();
        expect(data.success).toBe(true);

        // ESTADO FINAL: El viaje está completado
        const { data: ride } = await supabase.from('rides').select('status').eq('id', testRideId).single();
        expect(ride.status).toBe('completed');
    });
});
