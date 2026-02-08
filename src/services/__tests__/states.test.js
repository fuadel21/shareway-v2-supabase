/**
 * Tests de Estados y Temporalidad
 * Verifica expiración, cancelaciones y transiciones de estado
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, cleanupTestData } from '../helpers.js';
import { createSingleRequest } from '../../services/requestService.js';
import { fulfillRequest } from '../../services/rideService.js';
import { confirmTripAndPay } from '../../services/bookingService.js';

describe('State and Temporal Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
        // Usar fake timers para tests de tiempo
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Expiración de Pago', () => {
        it('debe establecer payment_expires_at correctamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10
            };
            const requestId = await createSingleRequest(requestData);

            const beforeFulfill = Date.now();

            // Act
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Assert
            const { data: request } = await testClient
                .from('ride_requests')
                .select('payment_expires_at')
                .eq('id', requestId)
                .single();
            
            const expiresAt = new Date(request.payment_expires_at).getTime();
            const expectedExpires = beforeFulfill + 15 * 60 * 1000; // +15 min
            
            expect(expiresAt).toBe(expectedExpires);
        });

        it('debe poder detectar requests expiradas', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10
            };
            const requestId = await createSingleRequest(requestData);

            await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Avanzar el tiempo 16 minutos (más allá de expiración)
            vi.advanceTimersByTime(16 * 60 * 1000);

            // Act: Verificar estado de expiración
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            // Assert
            expect(request.status).toBe('fulfilled'); // Sigue fulfilled hasta que se procese
            expect(new Date(request.payment_expires_at).getTime()).toBeLessThan(Date.now());
        });
    });

    describe('Cancelaciones con Fondos en Hold', () => {
        it('debe liberar fondos al cancelar booking pendiente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 20
            };
            const requestId = await createSingleRequest(requestData);

            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 20);

            // Verificar estado inicial con hold
            const { data: walletBefore } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(walletBefore.balance)).toBe(30); // 50 - 20
            expect(parseFloat(walletBefore.held_balance)).toBe(20);

            // Act: Cancelar booking
            const { cancelBookingAndRefund } = await import('../../services/bookingService.js');
            await cancelBookingAndRefund(rideId);

            // Assert
            const { data: walletAfter } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(walletAfter.balance)).toBe(50); // Recuperado
            expect(parseFloat(walletAfter.held_balance)).toBe(0); // Liberado

            // Verificar transacción de refund
            const { data: transactions } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'refund');
            
            expect(transactions).toHaveLength(1);
            expect(parseFloat(transactions[0].amount)).toBe(20);

            // Verificar estado del ride
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.status).toBe('cancelled');
        });

        it('debe mantener consistencia si la cancelación falla', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 20
            };
            const requestId = await createSingleRequest(requestData);

            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 20);

            // Mock para simular fallo en cancelación
            const originalRPC = testClient.rpc;
            testClient.rpc = vi.fn().mockImplementation((fn) => {
                if (fn === 'cancel_booking_and_refund') {
                    return { data: null, error: { message: 'Error simulado' } };
                }
                return originalRPC.call(testClient, fn);
            });

            // Act & Assert
            const { cancelBookingAndRefund } = await import('../../services/bookingService.js');
            await expect(cancelBookingAndRefund(rideId)).rejects.toThrow();

            // Verificar que el estado no cambió
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(30);
            expect(parseFloat(wallet.held_balance)).toBe(20);

            // Restaurar RPC
            testClient.rpc = originalRPC;
        });
    });

    describe('Transiciones de Estado Completas', () => {
        it('debe seguir la secuencia completa: pending -> fulfilled -> accepted -> confirmed', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15
            };
            const requestId = await createSingleRequest(requestData);

            // Step 1: pending -> fulfilled
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 15);

            let { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('fulfilled');

            // Step 2: fulfilled -> accepted (simular que el pasajero inicia pago)
            await testClient
                .from('ride_requests')
                .update({ status: 'accepted' })
                .eq('id', requestId);

            request = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('accepted');

            // Step 3: accepted -> confirmed (confirm_trip_and_pay)
            await confirmTripAndPay(rideId, requestId);

            // Assert final
            request = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('confirmed');

            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.status).toBe('scheduled'); // Sigue scheduled hasta inicio
            expect(ride.passengers).toHaveLength(1);
            expect(ride.passengers[0].status).toBe('confirmed');
        });
    });

    describe('Consistencia de Datos Relacionados', () => {
        it('debe mantener consistencia entre rides.ride_requests y passengers', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                suggestedPrice: 20
            };
            const requestId = await createSingleRequest(requestData);

            // Act
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 20);

            // Assert: Verificar consistencia cruzada
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            // Verificar relaciones
            expect(request.matched_ride_id).toBe(rideId);
            expect(ride.passengers).toHaveLength(1);
            expect(ride.passengers[0].id).toBe(passenger.id);
            expect(ride.participant_ids).toContain(passenger.id);

            // Verificar consistencia de fondos
            const passengerInRide = ride.passengers[0];
            expect(parseFloat(passengerInRide.booked_price)).toBe(20);
            expect(parseFloat(wallet.held_balance)).toBe(20);
            expect(parseFloat(wallet.balance)).toBe(30);

            // Verificar timestamps
            expect(new Date(request.payment_expires_at).getTime()).toBeGreaterThan(Date.now());
            expect(new Date(passengerInRide.booked_at).getTime()).toBeLessThan(Date.now());
        });

        it('debe manejar múltiples pasajeros consistentemente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 200);
            const passenger1 = await createTestUser('passengerMale', 50);
            const passenger2 = await createTestUser('passengerFemale', 50);
            
            // Crear ride directamente (no via request)
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 3,
                price: 15
            });

            // Act: Confirmar viaje para ambos pasajeros
            await confirmTripAndPay(rideId);
            await confirmTripAndPay(rideId);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.passengers).toHaveLength(2);
            expect(ride.seats_available).toBe(1); // 3 - 2
            expect(ride.participant_ids).toHaveLength(3); // driver + 2 passengers

            // Verificar wallets
            for (const passengerId of [passenger1.id, passenger2.id]) {
                const { data: wallet } = await testClient
                    .from('wallets')
                    .select('*')
                    .eq('user_id', passengerId)
                    .single();
                
                expect(parseFloat(wallet.balance)).toBe(35); // 50 - 15
                expect(parseFloat(wallet.held_balance)).toBe(15);
            }
        });
    });

    describe('Edge Cases Temporales', () => {
        it('debe manejar creación justo en el límite de tiempo', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            
            // Crear ride con tiempo mínimo (+10 min)
            const minimalTime = new Date();
            minimalTime.setMinutes(minimalTime.getMinutes() + 10);
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: minimalTime,
                seats: 2,
                price: 10
            };

            // Act & Assert
            const { createSingleRide } = await import('../../services/rideService.js');
            const result = await createSingleRide(rideData);
            expect(result).toBeDefined();
        });

        it('debe rechazar creación 1 segundo antes del límite', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            // Crear ride 9 minutos y 59 segundos en futuro
            const tooEarly = new Date();
            tooEarly.setMinutes(tooEarly.getMinutes() + 9);
            tooEarly.setSeconds(tooEarly.getSeconds() + 59);
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: tooEarly,
                seats: 2,
                price: 10
            };

            // Act & Assert
            const { createSingleRide } = await import('../../services/rideService.js');
            await expect(createSingleRide(rideData)).rejects.toThrow('futuro');
        });
    });
});
