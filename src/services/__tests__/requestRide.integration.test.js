/**
 * Tests de Integración - Flujo PEDIR PLAZA (RequestRide)
 * Detecta errores reales de estado y validaciones de negocio
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, excessivePrice, cleanupTestData } from '../helpers.js';
import { createSingleRequest } from '../../services/requestService.js';

describe('RequestRide Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    describe('Validaciones de Negocio', () => {
        it('debe crear request con datos válidos y precio justo', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const origin = testData.locations.sol;
            const destination = testData.locations.plazaMayor;
            const distance = realisticDistance(origin, destination);
            const price = fairPrice(distance);
            
            const requestData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 2,
                suggestedPrice: price,
                details: 'Test request válido',
                distance
            };

            // Act
            const result = await createSingleRequest(requestData);

            // Assert
            expect(result).toBeDefined();
            expect(typeof result).toBe('string'); // UUID
            
            // Verificar en BD
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(request).toBeTruthy();
            expect(request.requester_id).toBe(passenger.id);
            expect(request.status).toBe('pending');
            expect(request.seats_needed).toBe(2);
            expect(parseFloat(request.suggested_price)).toBe(price);
            expect(request.is_women_only).toBe(false);
        });

        it('debe rechazar request con precio excesivo (> 0.60€/km)', async () => {
            // Arrange
            await createTestUser('passengerMale');
            const origin = testData.locations.sol;
            const destination = testData.locations.chamartin;
            const distance = realisticDistance(origin, destination);
            const price = excessivePrice(distance);
            
            const requestData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: price,
                details: 'Test request precio excesivo',
                distance
            };

            // Act & Assert
            await expect(createSingleRequest(requestData)).rejects.toThrow('justo');
        });

        it('debe rechazar request en el pasado (+5 min)', async () => {
            // Arrange
            await createTestUser('passengerMale');
            const pastDate = new Date();
            pastDate.setMinutes(pastDate.getMinutes() - 10); // 10 min en pasado
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: pastDate,
                seats: 1,
                suggestedPrice: 10
            };

            // Act & Assert
            await expect(createSingleRequest(requestData)).rejects.toThrow('futuro');
        });

        it('debe rechazar request con asientos fuera de rango (1-4)', async () => {
            // Arrange
            await createTestUser('passengerMale');
            
            // Test con 0 asientos
            const requestZeroSeats = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 0,
                suggestedPrice: 10
            };

            // Test con 5 asientos (límite es 4)
            const requestTooManySeats = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 5,
                suggestedPrice: 10
            };

            // Act & Assert
            await expect(createSingleRequest(requestZeroSeats)).rejects.toThrow();
            await expect(createSingleRequest(requestTooManySeats)).rejects.toThrow();
        });

        it('debe rechazar request women_only de pasajero masculino', async () => {
            // Arrange
            await createTestUser('passengerMale'); // male
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10,
                isWomenOnly: true
            };

            // Act & Assert
            await expect(createSingleRequest(requestData)).rejects.toThrow('mujeres');
        });

        it('debe permitir request women_only de pasajera', async () => {
            // Arrange
            await createTestUser('passengerFemale');
            const origin = testData.locations.sol;
            const destination = testData.locations.plazaMayor;
            const distance = realisticDistance(origin, destination);
            const price = fairPrice(distance);
            
            const requestData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: price,
                isWomenOnly: true,
                distance
            };

            // Act
            const result = await createSingleRequest(requestData);

            // Assert
            expect(result).toBeDefined();
            
            const { data: request } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(request.is_women_only).toBe(true);
        });
    });

    describe('Límite de Requests Activas', () => {
        it('debe permitir hasta 5 requests activas', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const requestIds = [];
            
            // Crear 5 requests válidas
            for (let i = 0; i < 5; i++) {
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60 + i * 60), // Cada hora
                    seats: 1,
                    suggestedPrice: 10 + i
                };
                
                const result = await createSingleRequest(requestData);
                requestIds.push(result);
            }

            // Assert
            expect(requestIds).toHaveLength(5);
            
            const { data: requests } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('requester_id', passenger.id)
                .eq('status', 'pending');
            
            expect(requests).toHaveLength(5);
        });

        it('debe rechazar la sexta request activa', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            
            // Crear 5 requests
            for (let i = 0; i < 5; i++) {
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60 + i * 60),
                    seats: 1,
                    suggestedPrice: 10 + i
                };
                await createSingleRequest(requestData);
            }

            // Intentar crear la sexta
            const sixthRequest = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: futureDate(300),
                seats: 1,
                suggestedPrice: 15
            };

            // Act & Assert
            await expect(createSingleRequest(sixthRequest)).rejects.toThrow('5 solicitudes');
        });

        it('debe permitir nueva request si algunas fueron canceladas', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const requestIds = [];
            
            // Crear 5 requests
            for (let i = 0; i < 5; i++) {
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60 + i * 60),
                    seats: 1,
                    suggestedPrice: 10 + i
                };
                const result = await createSingleRequest(requestData);
                requestIds.push(result);
            }

            // Cancelar 2 requests
            await testClient
                .from('ride_requests')
                .update({ status: 'cancelled' })
                .in('id', requestIds.slice(0, 2));

            // Ahora debería poder crear una más
            const newRequest = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: futureDate(300),
                seats: 1,
                suggestedPrice: 15
            };

            // Act
            const result = await createSingleRequest(newRequest);

            // Assert
            expect(result).toBeDefined();
            
            const { data: activeRequests } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('requester_id', passenger.id)
                .eq('status', 'pending');
            
            expect(activeRequests).toHaveLength(4); // 3 originales + 1 nueva
        });
    });

    describe('Overlap Prevention (±1h)', () => {
        it('debe rechazar request que solapa con existente (±1h)', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const baseTime = futureDate(120);
            
            // Crear primera request
            const firstRequest = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 1,
                suggestedPrice: 10
            };
            await createSingleRequest(firstRequest);

            // Intentar crear request solapada (30 min después)
            const overlappingRequest = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 30 * 60 * 1000), // +30 min
                seats: 1,
                suggestedPrice: 15
            };

            // Act & Assert
            await expect(createSingleRequest(overlappingRequest)).rejects.toThrow('horario similar');
        });

        it('debe permitir request fuera de ventana de 1h', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const baseTime = futureDate(120);
            
            // Crear primera request
            const firstRequest = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 1,
                suggestedPrice: 10
            };
            await createSingleRequest(firstRequest);

            // Crear request fuera de ventana (2h después)
            const nonOverlappingRequest = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 2 * 60 * 60 * 1000), // +2h
                seats: 1,
                suggestedPrice: 15
            };

            // Act
            const result = await createSingleRequest(nonOverlappingRequest);

            // Assert
            expect(result).toBeDefined();
            
            const { data: requests } = await testClient
                .from('ride_requests')
                .select('*')
                .eq('requester_id', passenger.id);
            
            expect(requests).toHaveLength(2);
        });
    });

    describe('Manejo de Errores', () => {
        it('debe fallar con coordenadas inválidas', async () => {
            // Arrange
            await createTestUser('passengerMale');
            
            const requestData = {
                origin: { name: 'Sin coordenadas' }, // Sin coordinates
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 10
            };

            // Act & Assert
            await expect(createSingleRequest(requestData)).rejects.toThrow('coordenadas');
        });

        it('debe manejar precio negativo', async () => {
            // Arrange
            await createTestUser('passengerMale');
            
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: -5
            };

            // Act & Assert
            await expect(createSingleRequest(requestData)).rejects.toThrow();
        });
    });
});
