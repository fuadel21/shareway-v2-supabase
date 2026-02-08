/**
 * Tests de Integración - Flujo FULFILL REQUEST
 * Detecta overbooking, doble hold y estados inconsistentes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, cleanupTestData } from '../helpers.js';
import { createSingleRequest } from '../../services/requestService.js';
import { fulfillRequest } from '../../services/rideService.js';

describe('FulfillRequest Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    describe('Flujo Exitoso', () => {
        it('debe crear ride y actualizar request atómicamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 200); // 200€ balance
            const passenger = await createTestUser('passengerMale', 100); // 100€ balance
            
            const origin = testData.locations.sol;
            const destination = testData.locations.plazaMayor;
            const distance = realisticDistance(origin, destination);
            const price = fairPrice(distance);
            
            // Crear request
            const requestData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: price,
                details: 'Test request',
                distance
            };
            const requestId = await createSingleRequest(requestData);

            // Act
            const rideId = await fulfillRequest({ 
                id: requestId, 
                origin, 
                destination, 
                departure_time: requestData.dateTime.toISOString(),
                seats_needed: 1,
                suggested_price: price,
                distance 
            }, price);

            // Assert
            expect(rideId).toBeDefined();
            expect(typeof rideId).toBe('string');

            // Verificar ride creado
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride).toBeTruthy();
            expect(ride.driver_id).toBe(driver.id);
            expect(ride.status).toBe('scheduled');
            expect(ride.seats_available).toBe(0); // 1 total - 1 passenger
            expect(ride.seats_total).toBe(1);
            expect(parseFloat(ride.price)).toBe(price);

            // Verificar pasajero en ride
            expect(ride.passengers).toHaveLength(1);
            const passengerData = ride.passengers[0];
            expect(passengerData.id).toBe(passenger.id);
            expect(passengerData.status).toBe('confirmed');
            expect(passengerData.booked_price).toBe(price);
            expect(passengerData.pin).toMatch(/^\d{4}$/);

            // Verificar request actualizada
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            expect(request.status).toBe('fulfilled');
            expect(request.matched_ride_id).toBe(rideId);
            expect(request.payment_expires_at).toBeTruthy();

            // Verificar hold de saldo
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(100 - price);
            expect(parseFloat(wallet.held_balance)).toBe(price);

            // Verificar transacción
            const { data: transaction } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'hold')
                .single();
            
            expect(transaction).toBeTruthy();
            expect(parseFloat(transaction.amount)).toBe(-price);
            expect(transaction.related_ride_id).toBe(rideId);
        });

        it('debe establecer payment_expires_at a 15 minutos', async () => {
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

            const beforeFulfill = new Date();

            // Act
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Assert
            const { data: request } = await testClient
                .from('ride_requests')
                .select('payment_expires_at')
                .eq('id', requestId)
                .single();
            
            const expiresAt = new Date(request.payment_expires_at);
            const expectedExpires = new Date(beforeFulfill.getTime() + 15 * 60 * 1000);
            
            // Permitir diferencia de 1 segundo
            const diff = Math.abs(expiresAt.getTime() - expectedExpires.getTime());
            expect(diff).toBeLessThan(1000);
        });
    });

    describe('Validaciones y Errores', () => {
        it('debe rechazar fulfillment de request no existente', async () => {
            // Arrange
            await createTestUser('driverVerified');
            const fakeRequestId = '00000000-0000-0000-0000-000000000000';
            
            const rideData = {
                id: fakeRequestId,
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                price: 10
            };

            // Act & Assert
            await expect(fulfillRequest(rideData, 10)).rejects.toThrow('disponible');
        });

        it('debe rechazar fulfillment de request ya aceptada', async () => {
            // Arrange
            const driver1 = await createTestUser('driverVerified', 100);
            const driver2 = await createTestUser('driverFemale', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10
            };
            const requestId = await createSingleRequest(requestData);

            // Primer fulfillment exitoso
            await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Intento con segundo conductor
            const rideData2 = {
                id: requestId,
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                price: 10
            };

            // Act & Assert
            await expect(fulfillRequest(rideData2, 10)).rejects.toThrow('aceptada');
        });

        it('debe rechazar fulfillment con saldo insuficiente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 5); // Solo 5€ de saldo
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10 // Pide 10€ pero solo tiene 5€
            };
            const requestId = await createSingleRequest(requestData);

            const rideData = {
                id: requestId,
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                price: 10
            };

            // Act & Assert
            await expect(fulfillRequest(rideData, 10)).rejects.toThrow('saldo suficiente');

            // Verificar que no se creó ride ni se modificó saldo
            const { data: rides } = await testClient
                .from('rides')
                .select('*')
                .eq('driver_id', driver.id);
            
            expect(rides).toHaveLength(0);

            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(5); // Sin cambios
            expect(parseFloat(wallet.held_balance)).toBe(0);
        });

        it('debe rechazar fulfillment de propia request', async () => {
            // Arrange
            const user = await createTestUser('driverVerified', 100);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10
            };
            const requestId = await createSingleRequest(requestData);

            const rideData = {
                id: requestId,
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                price: 10
            };

            // Act & Assert
            await expect(fulfillRequest(rideData, 10)).rejects.toThrow('propia solicitud');
        });
    });

    describe('Atomicidad y Rollback', () => {
        it('no debe dejar datos inconsistentes si create_ride falla', async () => {
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

            // Mock para hacer fallar create_ride internamente
            // Esto simula un error en la creación del ride después de validar la request
            const originalRPC = testClient.rpc;
            let callCount = 0;
            testClient.rpc = vi.fn().mockImplementation((fn, params) => {
                if (fn === 'fulfill_ride_request' && callCount === 0) {
                    callCount++;
                    // Simular error en create_ride interno
                    return { data: null, error: { message: 'Error simulado en create_ride' } };
                }
                return originalRPC.call(testClient, fn, params);
            });

            // Act
            const result = await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Assert
            expect(result).toBeUndefined();

            // Verificar estado consistente
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', requestId)
                .single();
            
            // La request debe seguir como pending (no fue actualizada)
            expect(request.status).toBe('pending');
            expect(request.matched_ride_id).toBeNull();

            // Verificar que no se modificó el saldo
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(50);
            expect(parseFloat(wallet.held_balance)).toBe(0);

            // Restaurar RPC original
            testClient.rpc = originalRPC;
        });
    });

    describe('Edge Cases', () => {
        it('debe manejar request con waypoints y preferences', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const waypoints = [
                { name: 'Parada 1', coordinates: { lat: 40.42, lng: -3.70 } }
            ];
            const preferences = {
                smoking: 'no',
                pets: 'small'
            };
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10,
                waypoints,
                preferences
            };
            const requestId = await createSingleRequest(requestData);

            // Act
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 10);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('waypoints, preferences')
                .eq('id', rideId)
                .single();
            
            expect(ride.waypoints).toEqual(waypoints);
            expect(ride.preferences).toEqual(preferences);
        });

        it('debe manejar precio con decimales correctamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 12.50
            };
            const requestId = await createSingleRequest(requestData);

            // Act
            const rideId = await fulfillRequest({ id: requestId, ...requestData }, 12.50);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('price')
                .eq('id', rideId)
                .single();
            
            expect(parseFloat(ride.price)).toBe(12.50);

            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(37.50); // 50 - 12.50
            expect(parseFloat(wallet.held_balance)).toBe(12.50);
        });
    });
});
