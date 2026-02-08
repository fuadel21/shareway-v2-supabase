/**
 * Tests de Integración - Flujo OFRECER PLAZA (CreateRide)
 * Detecta errores reales de estado y validaciones de negocio
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, excessivePrice, cleanupTestData } from '../helpers.js';
import { createSingleRide } from '../../services/rideService.js';

describe('CreateRide Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    describe('Validaciones de Negocio', () => {
        it('debe crear ride con datos válidos y precio justo', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            const origin = testData.locations.sol;
            const destination = testData.locations.plazaMayor;
            const distance = realisticDistance(origin, destination);
            const price = fairPrice(distance);
            
            const rideData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 4,
                price,
                details: 'Test ride válido',
                distance,
                overview_polyline: 'test_polyline'
            };

            // Act
            const result = await createSingleRide(rideData);

            // Assert
            expect(result).toBeDefined();
            expect(typeof result).toBe('string'); // UUID
            
            // Verificar en BD
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(ride).toBeTruthy();
            expect(ride.driver_id).toBe(driver.id);
            expect(ride.status).toBe('scheduled');
            expect(ride.seats_available).toBe(4);
            expect(ride.seats_total).toBe(4);
            expect(parseFloat(ride.price)).toBe(price);
            expect(ride.is_women_only).toBe(false);
        });

        it('debe rechazar ride con precio excesivo (> 0.60€/km)', async () => {
            // Arrange
            await createTestUser('driverVerified');
            const origin = testData.locations.sol;
            const destination = testData.locations.chamartin;
            const distance = realisticDistance(origin, destination);
            const price = excessivePrice(distance); // > 0.60€/km
            
            const rideData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 2,
                price,
                details: 'Test ride precio excesivo',
                distance
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('justo');
        });

        it('debe rechazar ride en el pasado', async () => {
            // Arrange
            await createTestUser('driverVerified');
            const pastDate = new Date();
            pastDate.setMinutes(pastDate.getMinutes() - 10); // 10 min en pasado
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: pastDate,
                seats: 2,
                price: 10,
                details: 'Test ride pasado'
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('futuro');
        });

        it('debe rechazar ride con asientos fuera de rango', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            // Test con 0 asientos
            const rideDataZeroSeats = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 0,
                price: 10
            };

            // Test con 10 asientos (límite es 9)
            const rideDataTooManySeats = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 10,
                price: 10
            };

            // Act & Assert
            await expect(createSingleRide(rideDataZeroSeats)).rejects.toThrow();
            await expect(createSingleRide(rideDataTooManySeats)).rejects.toThrow();
        });

        it('debe rechazar ride women_only de conductor masculino', async () => {
            // Arrange
            await createTestUser('driverVerified'); // male
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 10,
                isWomenOnly: true
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('mujeres');
        });

        it('debe permitir ride women_only de conductora', async () => {
            // Arrange
            await createTestUser('driverFemale');
            const origin = testData.locations.sol;
            const destination = testData.locations.plazaMayor;
            const distance = realisticDistance(origin, destination);
            const price = fairPrice(distance);
            
            const rideData = {
                origin,
                destination,
                dateTime: futureDate(60),
                seats: 2,
                price,
                isWomenOnly: true,
                distance
            };

            // Act
            const result = await createSingleRide(rideData);

            // Assert
            expect(result).toBeDefined();
            
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(ride.is_women_only).toBe(true);
        });
    });

    describe('Overlap Prevention', () => {
        it('debe rechazar ride que solapa con existente (±2h)', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            const baseTime = futureDate(120); // 2h en futuro
            
            // Crear primer ride
            const firstRide = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 3,
                price: 15
            };
            await createSingleRide(firstRide);

            // Intentar crear ride solapado (1h después)
            const overlappingRide = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 60 * 60 * 1000), // +1h
                seats: 2,
                price: 20
            };

            // Act & Assert
            await expect(createSingleRide(overlappingRide)).rejects.toThrow('2h');
        });

        it('debe permitir ride fuera de ventana de 2h', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            const baseTime = futureDate(120);
            
            // Crear primer ride
            const firstRide = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: baseTime,
                seats: 3,
                price: 15
            };
            await createSingleRide(firstRide);

            // Crear ride fuera de ventana (3h después)
            const nonOverlappingRide = {
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: new Date(baseTime.getTime() + 3 * 60 * 60 * 1000), // +3h
                seats: 2,
                price: 20
            };

            // Act
            const result = await createSingleRide(nonOverlappingRide);

            // Assert
            expect(result).toBeDefined();
            
            const { data: rides } = await testClient
                .from('rides')
                .select('*')
                .eq('driver_id', driver.id);
            
            expect(rides).toHaveLength(2);
        });
    });

    describe('Persistencia de Datos', () => {
        it('debe persistir waypoints y preferences', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            const waypoints = [
                { name: 'Parada 1', coordinates: { lat: 40.42, lng: -3.70 } }
            ];
            const preferences = {
                smoking: 'no',
                pets: 'small',
                music: 'low'
            };
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 10,
                waypoints,
                preferences
            };

            // Act
            const result = await createSingleRide(rideData);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(ride.waypoints).toEqual(waypoints);
            expect(ride.preferences).toEqual(preferences);
        });

        it('debe calcular seats_available correctamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 5,
                price: 20
            };

            // Act
            const result = await createSingleRide(rideData);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(ride.seats_total).toBe(5);
            expect(ride.seats_available).toBe(5);
        });
    });

    describe('Manejo de Errores', () => {
        it('debe fallar con coordenadas inválidas', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: { name: 'Sin coordenadas' }, // Sin coordinates
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 10
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('coordenadas');
        });

        it('debe manejar coordenadas con latitude/longitude', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            
            const rideData = {
                origin: {
                    name: 'Origen con lat/lng',
                    coordinates: { latitude: 40.4168, longitude: -3.7038 }
                },
                destination: {
                    name: 'Destino con lat/lng',
                    coordinates: { latitude: 40.4155, longitude: -3.7074 }
                },
                dateTime: futureDate(60),
                seats: 2,
                price: 10
            };

            // Act
            const result = await createSingleRide(rideData);

            // Assert
            expect(result).toBeDefined();
        });
    });
});
