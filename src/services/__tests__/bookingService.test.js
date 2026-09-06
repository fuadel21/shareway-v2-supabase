import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { calculateRefundAmount, confirmTripAndPay } from '../bookingService';
import * as rpc from '@/lib/supabaseRPC';

// REGLA 4: Mock de RPC para control total del estado
vi.mock('@/lib/supabaseRPC', () => ({
    confirmTripAndPay: vi.fn(),
}));

describe('BookingService - Motor de Reservas y Concurrencia', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Manejo de Errores y Reglas de Negocio (Regla 7)', () => {
        
        it('debería transformar el código SIN_PLAZAS_LIBRES en un mensaje amigable', async () => {
            rpc.confirmTripAndPay.mockResolvedValue({ 
                success: false, 
                error: 'PGRST_ERROR: SIN_PLAZAS_LIBRES' 
            });

            await expect(confirmTripAndPay('ride_123'))
                .rejects.toThrow("Lo sentimos, ya no quedan plazas libres.");
        });

        it('debería transformar SALDO_INSUFICIENTE en una instrucción de recarga', async () => {
            rpc.confirmTripAndPay.mockResolvedValue({ 
                success: false, 
                error: 'DATABASE_ERROR: SALDO_INSUFICIENTE' 
            });

            await expect(confirmTripAndPay('ride_123'))
                .rejects.toThrow("Saldo insuficiente. Por favor, recarga tu wallet.");
        });

        it('debería rechazar si no se proporciona rideId', async () => {
            await expect(confirmTripAndPay(null))
                .rejects.toThrow("ID de viaje requerido");
        });
    });

    describe('Simulación de Concurrencia (Regla 6)', () => {
        
        it('debería manejar correctamente múltiples intentos simultáneos de reserva', async () => {
            const RIDE_ID = 'ride_concurrente_999';
            
            // Simulamos que el primer intento tiene éxito y el segundo falla por plazas (Race Condition)
            // En un entorno real, esto lo gestiona el RPC atómico, pero aquí testeamos que el service
            // maneje ambas respuestas correctamente en paralelo.
            rpc.confirmTripAndPay
                .mockResolvedValueOnce({ success: true, data: { booking_id: 'bk_1' } })
                .mockResolvedValueOnce({ success: false, error: 'SIN_PLAZAS_LIBRES' });

            // REGLA 6: Disparamos peticiones en paralelo
            const promise1 = confirmTripAndPay(RIDE_ID, 'req_1');
            const promise2 = confirmTripAndPay(RIDE_ID, 'req_2');

            const results = await Promise.allSettled([promise1, promise2]);

            // Verificamos resultados
            const success = results.find(r => r.status === 'fulfilled');
            const failure = results.find(r => r.status === 'rejected');

            expect(success.value.success).toBe(true);
            expect(failure.reason.message).toBe("Lo sentimos, ya no quedan plazas libres.");
            
            // Verificamos que se llamó al RPC dos veces
            expect(rpc.confirmTripAndPay).toHaveBeenCalledTimes(2);
        });
    });

    describe('Estimación de reembolso para la UI', () => {
        const baseTime = new Date('2026-09-01T12:00:00.000Z');
        const booking = {
            payment_amount: 100,
            booked_price: 50,
            seats_booked: 2,
        };

        it.each([
            [25, 100],
            [24, 50],
            [2, 50],
            [1.99, 0],
        ])('applies the cancellation policy at %s hours (%s%%)', (hours, percentage) => {
            vi.useFakeTimers();
            vi.setSystemTime(baseTime);
            try {
                const result = calculateRefundAmount({
                    departure_time: new Date(baseTime.getTime() + hours * 60 * 60 * 1000).toISOString(),
                }, booking);

                expect(result.percentage).toBe(percentage);
                expect(result.amount).toBe(percentage === 100 ? 100 : percentage === 50 ? 50 : 0);
                expect(result.serverAuthoritative).toBe(false);
                expect(result.presentationOnly).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('uses the persisted multi-seat payment amount instead of ride.price', () => {
            vi.useFakeTimers();
            vi.setSystemTime(baseTime);
            try {
                const result = calculateRefundAmount({
                    price: 10,
                    departure_time: new Date(baseTime.getTime() + 25 * 60 * 60 * 1000).toISOString(),
                }, booking);

                expect(result.total).toBe(100);
                expect(result.amount).toBe(100);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('Confirmación Exitosa', () => {
        it('debería devolver success: true cuando el RPC responde correctamente', async () => {
            rpc.confirmTripAndPay.mockResolvedValue({ 
                success: true, 
                data: { status: 'confirmed', booking_id: '123' } 
            });

            const result = await confirmTripAndPay('ride_ok');
            expect(result.success).toBe(true);
            expect(result.data.booking_id).toBe('123');
        });
    });
});
