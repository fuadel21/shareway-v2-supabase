import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RIDE_RULES, createSingleRide, createRideRequest } from '../rideService';
import * as rpc from '@/lib/supabaseRPC';
import { addMinutes, subMinutes } from 'date-fns';

// REGLA 4: Mock de tiempo y RPC
vi.mock('@/lib/supabaseRPC', () => ({
    safeCall: vi.fn(),
    createRide: vi.fn(),
}));

describe('RideService - Reglas de Negocio (Lógica Pura)', () => {
    
    beforeEach(() => {
        vi.useFakeTimers();
        // Fijamos fecha: 2024-01-01 12:00:00
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('Validación de Publicación (Conductor)', () => {
        
        it('debería rechazar un viaje programado para el pasado', async () => {
            const pastDate = subMinutes(new Date(), 1);
            const rideData = {
                origin: { lat: 40, lng: -3 },
                destination: { lat: 41, lng: -4 },
                dateTime: pastDate,
                price: 10,
                seats: 3
            };

            await expect(createSingleRide(rideData)).rejects.toThrow(/antelación/);
        });

        it('debería rechazar un viaje con precio superior al límite de seguridad', async () => {
            const validDate = addMinutes(new Date(), 30);
            const rideData = {
                origin: { lat: 40, lng: -3 },
                destination: { lat: 41, lng: -4 },
                dateTime: validDate,
                price: RIDE_RULES.MAX_PRICE + 1,
                seats: 3
            };

            await expect(createSingleRide(rideData)).rejects.toThrow(/límite de seguridad/);
        });

        it('debería permitir la creación si los datos cumplen todas las reglas', async () => {
            const validDate = addMinutes(new Date(), 30);
            const rideData = {
                origin: { lat: 40, lng: -3 },
                destination: { lat: 41, lng: -4 },
                dateTime: validDate,
                price: 25,
                seats: 4,
                waypoints: []
            };

            // Mock de respuesta exitosa del RPC
            rpc.createRide.mockResolvedValue({ success: true, data: { rideId: 'new_ride_123' } });

            const result = await createSingleRide(rideData);
            expect(result).toBe('new_ride_123');
            expect(rpc.createRide).toHaveBeenCalled();
        });
    });

    describe('Validación de Solicitudes (Pasajero)', () => {
        
        it('debería exigir los mismos 10 minutos de antelación que las ofertas', async () => {
            const tightDate = addMinutes(new Date(), 5); // Solo 5 min
            const requestData = {
                origin: { lat: 40, lng: -3 },
                destination: { lat: 41, lng: -4 },
                dateTime: tightDate,
                seats: 1,
                price: 10
            };

            await expect(createRideRequest(requestData)).rejects.toThrow(/antelación/);
        });
    });
});
