/**
 * TEST DE CONCURRENCIA: EL ÚLTIMO ASIENTO
 * Objetivo: Validar que el sistema bloquea el sobre-vuelo de plazas.
 */
import { supabase } from '@/lib/supabase';

describe('Integridad de Plazas (Atomicidad)', () => {
    test('Solo un usuario debe poder reservar la última plaza en condiciones de carrera', async () => {
        const testRideId = '1b281ab2-7358-4d8d-b1aa-98e9a0dc1b0c'; // ID de prueba estable
        
        // Simulamos dos peticiones casi simultáneas
        const [res1, res2] = await Promise.all([
            supabase.rpc('confirm_trip_and_pay', { p_ride_id: testRideId }),
            supabase.rpc('confirm_trip_and_pay', { p_ride_id: testRideId })
        ]);

        // RESULTADO OBSERVABLE: Un éxito, un fallo específico.
        const results = [res1.data?.success, res2.data?.success];
        const errors = [res1.error?.message, res2.error?.message];

        expect(results).toContain(true);
        expect(errors.some(e => e?.includes('SIN_PLAZAS_LIBRES') || e?.includes('YA_EN_VIAJE'))).toBe(true);
    });
});
