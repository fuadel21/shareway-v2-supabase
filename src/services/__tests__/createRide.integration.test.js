import { describe, it, expect, vi } from 'vitest';
import { createSingleRide } from '../rideService';
import * as rpc from '../../lib/supabaseRPC';

// Mock del RPC para simular la base de datos
vi.mock('../../lib/supabaseRPC', () => ({
    createRide: vi.fn(),
    safeCall: vi.fn()
}));

describe('Auditoría Técnica: Creación de Viaje Real', () => {

    it('debe validar e integrar correctamente los datos de un nuevo viaje', async () => {
        // Datos de entrada (Simulando lo que vendría del formulario)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const testRide = {
            origin: { address: "Madrid", lat: 40.41, lng: -3.70 },
            destination: { address: "Barcelona", lat: 41.38, lng: 2.17 },
            dateTime: tomorrow.toISOString(),
            price: 25.50,
            seats: 3,
            details: "Audit Test"
        };

        // Simular respuesta exitosa del RPC de Supabase
        rpc.createRide.mockResolvedValue({
            success: true,
            data: {
                success: true,
                rideId: 'uuid-creado-123',
                note: 'created'
            }
        });

        // EJECUCIÓN
        const rideId = await createSingleRide(testRide);

        // VERIFICACIONES DE AUDITORÍA
        expect(rideId).toBe('uuid-creado-123');

        // Verificar que los datos enviados al RPC están normalizados
        const callArgs = rpc.createRide.mock.calls[0][0];
        expect(callArgs.price).toBe(25.50);
        expect(callArgs.origin.address).toBe("Madrid");
        expect(typeof callArgs.idempotency_key).toBe('string');

        console.log("✅ AUDITORÍA PASADA: El servicio normaliza y envía los datos correctamente.");
    });

    it('debe bloquear la creación si la fecha es en el pasado', async () => {
        const pastDate = new Date();
        pastDate.setMinutes(pastDate.getMinutes() - 30);

        const invalidRide = {
            origin: { address: "Madrid", lat: 40.41, lng: -3.70 },
            destination: { address: "Barcelona", lat: 41.38, lng: 2.17 },
            dateTime: pastDate.toISOString(),
            price: 10,
            seats: 2
        };

        await expect(createSingleRide(invalidRide)).rejects.toThrow(/antelación/);
        console.log("✅ AUDITORÍA PASADA: El bloqueador de seguridad de fechas funciona.");
    });
});
