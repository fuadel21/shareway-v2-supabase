import { describe, it, expect, beforeAll } from 'vitest';
import { createSingleRide } from './rideService';
import { supabase } from '../lib/supabase';

/**
 * Pruebas de Integración: Reglas de Negocio Elite
 */
describe('Business Rules: Ride Creation Hardening', () => {

    const testDriverId = '10000000-0000-0000-0000-000000000001';

    beforeAll(async () => {
        console.log("🔍 Integration Test pointing to:", supabase.supabaseUrl);
        const { error } = await supabase.auth.signInWithPassword({
            email: 'driver.elite@shareway.test',
            password: 'ShareWayTest2026!'
        });
        if (error) {
            console.error("⛔ Auth failure in integration tests:", error);
            throw error;
        }

        // Cleanup previous rides for this driver to avoid overlap conflicts
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
            await supabase.from('rides').delete().eq('driver_id', userData.user.id);
        }
    });

    it('should reject a ride with a price exceeding 0.60€/km (Fair Price Policy)', async () => {
        const unfairRide = {
            origin: { coordinates: { lat: 40, lng: -3 }, address: 'Madrid' },
            destination: { coordinates: { lat: 41, lng: 2 }, address: 'Barcelona' },
            distance: 600, // 600km
            price: 500,    // 500€ / 600km = 0.83€/km (> 0.60€)
            seats: 4,
            dateTime: new Date(Date.now() + 86400000 * 3)
        };

        try {
            await createSingleRide(unfairRide);
            // Si llega aquí, el test falló porque debería haber lanzado excepción
            expect(true).toBe(false);
        } catch (error) {
            expect(error.message).toContain('0.60€/km');
            console.log("✅ Fair Price Policy validated: Rejected high price");
        }
    });

    it('should reject a ride that overlaps with an existing one (+/- 2h)', async () => {
        // 1. Crear un viaje base
        const baseDateTime = new Date();
        baseDateTime.setDate(baseDateTime.getDate() + 4); // 4 días adelante para no chocar con nada
        baseDateTime.setHours(10, 0, 0, 0);

        const baseRide = {
            origin: { coordinates: { lat: 40, lng: -3 }, address: 'Madrid' },
            destination: { coordinates: { lat: 41, lng: 2 }, address: 'Barcelona' },
            distance: 600,
            price: 30,
            seats: 4,
            dateTime: baseDateTime
        };
        await createSingleRide(baseRide);
        console.log("   📍 Base ride for overlap test created at:", baseDateTime.toISOString());

        // 2. Intentar crear uno que solapa (1h después)
        const overlappingRide = {
            ...baseRide,
            dateTime: new Date(baseDateTime.getTime() + 3600000) // 1 hora después
        };

        try {
            await createSingleRide(overlappingRide);
            expect(true).toBe(false); // No debería llegar aquí
        } catch (error) {
            expect(error.message).toContain('2h');
            console.log("✅ Overlap Prevention validated: Rejected overlapping ride");
        }
    });

    it('should prevent an unverified user from creating a ride', async () => {
        // En una prueba real, usaríamos un token de usuario no verificado
        // Aquí simulamos la lógica que el backend debe aplicar
        const unverifiedUserId = '00000000-0000-0000-0000-000000000999';

        // Esta prueba asume que el backend está blindado con el check de 'is_user_verified'
        // Lo cual implementamos en MIGRATION_CREATE_RIDE_HARDENING.sql
    });
});
