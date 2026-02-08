/**
 * Tests de Concurrencia - Detecta Race Conditions y Overbooking
 * Ejecuta operaciones en paralelo para exponer errores sutiles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, cleanupTestData } from '../helpers.js';
import { createSingleRequest } from '../../services/requestService.js';
import { fulfillRequest } from '../../services/rideService.js';

describe('Concurrency Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    describe('Doble Fulfill (Overbooking)', () => {
        it('debe evitar que dos conductores acepten la misma request', async () => {
            // Arrange
            const driver1 = await createTestUser('driverVerified', 200);
            const driver2 = await createTestUser('driverFemale', 200);
            const passenger = await createTestUser('passengerMale', 100);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 20
            };
            const requestId = await createSingleRequest(requestData);

            const rideData = {
                id: requestId,
                origin: requestData.origin,
                destination: requestData.destination,
                dateTime: requestData.dateTime,
                seats: 1,
                price: 20
            };

            // Act: Ambos conductores intentan aceptar al mismo tiempo
            const results = await Promise.allSettled([
                fulfillRequest(rideData, 20),
                fulfillRequest(rideData, 20)
            ]);

            // Assert: Solo uno debe tener éxito
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;
            
            expect(successCount).toBe(1);
            expect(failureCount).toBe(1);

            // Verificar que solo hay un ride
            const { data: rides } = await testClient
                .from('rides')
                .select('*');
            
            expect(rides).toHaveLength(1);

            // Verificar que la request está fulfilled
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('fulfilled');
            expect(request.matched_ride_id).toBeTruthy();

            // Verificar que solo hay un hold de saldo
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(80); // 100 - 20
            expect(parseFloat(wallet.held_balance)).toBe(20); // Solo un hold
        });

        it('debe mantener consistencia con múltiples intentos simultáneos', async () => {
            // Arrange
            const drivers = await Promise.all([
                createTestUser('driverVerified', 200),
                createTestUser('driverFemale', 200),
                createTestUser('driverVerified', 200),
                createTestUser('driverFemale', 200),
                createTestUser('driverVerified', 200)
            ]);
            const passenger = await createTestUser('passengerMale', 100);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.chamartin,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 25
            };
            const requestId = await createSingleRequest(requestData);

            const rideData = {
                id: requestId,
                origin: requestData.origin,
                destination: requestData.destination,
                dateTime: requestData.dateTime,
                seats: 1,
                price: 25
            };

            // Act: 5 conductores intentan aceptar simultáneamente
            const results = await Promise.allSettled(
                drivers.map(() => fulfillRequest(rideData, 25))
            );

            // Assert
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;
            
            expect(successCount).toBe(1);
            expect(failureCount).toBe(4);

            // Verificar consistencia final
            const { data: rides } = await testClient
                .from('rides')
                .select('*');
            
            expect(rides).toHaveLength(1);
            expect(rides[0].driver_id).toBeOneOf(drivers.map(d => d.id));

            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.held_balance)).toBe(25); // Solo un hold
        });
    });

    describe('Overlap Simultáneo', () => {
        it('debe prevenir rides solapados creados simultáneamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 200);
            const baseTime = futureDate(120);
            
            const rideData1 = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 3,
                price: 15
            };

            const rideData2 = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 30 * 60 * 1000), // +30 min
                seats: 2,
                price: 20
            };

            // Act: Intentar crear ambos rides simultáneamente
            const results = await Promise.allSettled([
                (async () => {
                    const { createSingleRide } = await import('../../services/rideService.js');
                    return await createSingleRide(rideData1);
                })(),
                (async () => {
                    const { createSingleRide } = await import('../../services/rideService.js');
                    return await createSingleRide(rideData2);
                })()
            ]);

            // Assert: Uno debe fallar por overlap
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;
            
            expect(successCount).toBe(1);
            expect(failureCount).toBe(1);

            // Verificar que solo hay un ride
            const { data: rides } = await testClient
                .from('rides')
                .select('*')
                .eq('driver_id', driver.id);
            
            expect(rides).toHaveLength(1);
        });

        it('debe permitir rides no solapados creados simultáneamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 300);
            const baseTime = futureDate(120);
            
            const rideData1 = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 2,
                price: 10
            };

            const rideData2 = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 3 * 60 * 60 * 1000), // +3h
                seats: 2,
                price: 25
            };

            // Act: Crear ambos rides simultáneamente
            const results = await Promise.allSettled([
                (async () => {
                    const { createSingleRide } = await import('../../services/rideService.js');
                    return await createSingleRide(rideData1);
                })(),
                (async () => {
                    const { createSingleRide } = await import('../../services/rideService.js');
                    return await createSingleRide(rideData2);
                })()
            ]);

            // Assert: Ambos deben tener éxito
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            
            expect(successCount).toBe(2);

            const { data: rides } = await testClient
                .from('rides')
                .select('*')
                .eq('driver_id', driver.id);
            
            expect(rides).toHaveLength(2);
        });
    });

    describe('Límite de Requests Concurrente', () => {
        it('debe respetar límite de 5 requests bajo concurrencia', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale', 200);
            
            // Crear 6 requests simultáneamente
            const requests = Array.from({ length: 6 }, (_, i) => ({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60 + i * 60), // Cada hora
                seats: 1,
                suggestedPrice: 10 + i
            }));

            // Act: Intentar crear todas las requests a la vez
            const results = await Promise.allSettled(
                requests.map(req => createSingleRequest(req))
            );

            // Assert: Solo 5 deben tener éxito
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;
            
            expect(successCount).toBe(5);
            expect(failureCount).toBe(1);

            // Verificar en BD
            const { data: dbRequests } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('requester_id', passenger.id)
                .eq('status', 'pending');
            
            expect(dbRequests).toHaveLength(5);
        });
    });

    describe('Estado de Wallet bajo Concurrencia', () => {
        it('debe mantener consistencia de wallet con múltiples holds', async () => {
            // Arrange
            const drivers = await Promise.all([
                createTestUser('driverVerified', 200),
                createTestUser('driverFemale', 200),
                createTestUser('driverVerified', 200)
            ]);
            const passenger = await createTestUser('passengerMale', 150); // 150€ de saldo
            
            // Crear 3 requests
            const requests = await Promise.all(
                Array.from({ length: 3 }, async (_, i) => {
                    const requestData = {
                        origin: testData.locations.sol,
                        destination: testData.locations.plazaMayor,
                        dateTime: futureDate(60 + i * 60),
                        seats: 1,
                        suggestedPrice: 20
                    };
                    return await createSingleRequest(requestData);
                })
            );

            // Act: 3 conductores aceptan diferentes requests simultáneamente
            const results = await Promise.allSettled(
                requests.map((requestId, i) => {
                    const rideData = {
                        id: requestId,
                        origin: testData.locations.sol,
                        destination: testData.locations.plazaMayor,
                        dateTime: futureDate(60 + i * 60),
                        seats: 1,
                        price: 20
                    };
                    return fulfillRequest(rideData, 20);
                })
            );

            // Assert
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            expect(successCount).toBe(3);

            // Verificar estado final de wallet
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(90); // 150 - 3*20
            expect(parseFloat(wallet.held_balance)).toBe(60); // 3*20

            // Verificar transacciones
            const { data: transactions } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'hold');
            
            expect(transactions).toHaveLength(3);
            transactions.forEach(tx => {
                expect(parseFloat(tx.amount)).toBe(-20);
            });
        });
    });

    describe('Race Conditions en Estados', () => {
        it('debe mantener consistencia si fulfill falla parcialmente', async () => {
            // Arrange
            const driver1 = await createTestUser('driverVerified', 200);
            const driver2 = await createTestUser('driverFemale', 200);
            const passenger = await createTestUser('passengerMale', 5); // Saldo insuficiente
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10 // Más de lo que tiene
            };
            const requestId = await createSingleRequest(requestData);

            const rideData = {
                id: requestId,
                origin: requestData.origin,
                destination: requestData.destination,
                dateTime: requestData.dateTime,
                seats: 1,
                price: 10
            };

            // Act: Ambos intentan, pero ambos deberían fallar por saldo insuficiente
            const results = await Promise.allSettled([
                fulfillRequest(rideData, 10),
                fulfillRequest(rideData, 10)
            ]);

            // Assert: Ambos deben fallar
            const failureCount = results.filter(r => r.status === 'rejected').length;
            expect(failureCount).toBe(2);

            // Verificar que no hay rides ni holds
            const { data: rides } = await testClient
                .from('rides')
                .select('*');
            
            expect(rides).toHaveLength(0);

            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(5); // Sin cambios
            expect(parseFloat(wallet.held_balance)).toBe(0);

            // La request debe seguir como pending
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('pending');
            expect(request.matched_ride_id).toBeNull();
        });
    });
});
