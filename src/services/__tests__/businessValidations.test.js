/**
 * Tests de Validaciones de Negocio
 * Verifica reglas críticas: precio justo, límites, escudo de género
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, excessivePrice, cleanupTestData } from '../helpers.js';
import { createSingleRide } from '../../services/rideService.js';
import { createSingleRequest } from '../../services/requestService.js';

describe('Business Validations Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
    });

    describe('Precio Justo (Fair Price Policy)', () => {
        describe('Rides (Ofrecer Plaza)', () => {
            it('debe aceptar precio justo en el límite (0.60€/km)', async () => {
                // Arrange
                await createTestUser('driverVerified');
                const origin = testData.locations.sol;
                const destination = testData.locations.chamartin;
                const distance = realisticDistance(origin, destination);
                const maxFairPrice = Math.round(distance * 0.60 * 100) / 100; // Exactly 0.60€/km
                
                const rideData = {
                    origin,
                    destination,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: maxFairPrice,
                    details: 'Precio justo límite',
                    distance
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
                
                const { data: ride } = await testClient
                    .from('rides')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(parseFloat(ride.price)).toBe(maxFairPrice);
            });

            it('debe rechazar precio 0.01€ por encima del límite', async () => {
                // Arrange
                await createTestUser('driverVerified');
                const origin = testData.locations.sol;
                const destination = testData.locations.chamartin;
                const distance = realisticDistance(origin, destination);
                const excessivePrice = Math.round((distance * 0.60 + 0.01) * 100) / 100;
                
                const rideData = {
                    origin,
                    destination,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: excessivePrice,
                    details: 'Precio excesivo mínimo',
                    distance
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow('justo');
            });

            it('debe permitir precio cero o gratuito', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: 0,
                    details: 'Viaje gratuito'
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
            });

            it('debe ignorar validación si distance es null o cero', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: 1000, // Precio muy alto pero sin distancia
                    details: 'Precio sin distancia'
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
            });
        });

        describe('Requests (Pedir Plaza)', () => {
            it('debe aceptar precio justo en el límite (0.60€/km)', async () => {
                // Arrange
                await createTestUser('passengerMale');
                const origin = testData.locations.sol;
                const destination = testData.locations.chamartin;
                const distance = realisticDistance(origin, destination);
                const maxFairPrice = Math.round(distance * 0.60 * 100) / 100;
                
                const requestData = {
                    origin,
                    destination,
                    dateTime: futureDate(60),
                    seats: 1,
                    suggestedPrice: maxFairPrice,
                    details: 'Request precio justo límite',
                    distance
                };

                // Act & Assert
                const result = await createSingleRequest(requestData);
                expect(result).toBeDefined();
            });

            it('debe rechazar precio excesivo en request', async () => {
                // Arrange
                await createTestUser('passengerMale');
                const origin = testData.locations.sol;
                const destination = testData.locations.chamartin;
                const distance = realisticDistance(origin, destination);
                const excessivePrice = Math.round((distance * 0.60 + 0.05) * 100) / 100;
                
                const requestData = {
                    origin,
                    destination,
                    dateTime: futureDate(60),
                    seats: 1,
                    suggestedPrice: excessivePrice,
                    details: 'Request precio excesivo',
                    distance
                };

                // Act & Assert
                await expect(createSingleRequest(requestData)).rejects.toThrow('justo');
            });
        });
    });

    describe('Límites de Asientos', () => {
        describe('Rides (1-9 asientos)', () => {
            it('debe aceptar exactamente 1 asiento', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 1,
                    price: 10
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
                
                const { data: ride } = await testClient
                    .from('rides')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(ride.seats_total).toBe(1);
                expect(ride.seats_available).toBe(1);
            });

            it('debe aceptar exactamente 9 asientos', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.chamartin,
                    dateTime: futureDate(60),
                    seats: 9,
                    price: 50
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
                
                const { data: ride } = await testClient
                    .from('rides')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(ride.seats_total).toBe(9);
                expect(ride.seats_available).toBe(9);
            });

            it('debe rechazar 0 asientos', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 0,
                    price: 10
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow();
            });

            it('debe rechazar 10 asientos', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 10,
                    price: 50
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow();
            });
        });

        describe('Requests (1-4 asientos)', () => {
            it('debe aceptar exactamente 4 asientos', async () => {
                // Arrange
                await createTestUser('passengerMale');
                
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 4,
                    suggestedPrice: 20
                };

                // Act & Assert
                const result = await createSingleRequest(requestData);
                expect(result).toBeDefined();
                
                const { data: request } = await testClient
                    .from('ride_requests')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(request.seats_needed).toBe(4);
            });

            it('debe rechazar 5 asientos', async () => {
                // Arrange
                await createTestUser('passengerMale');
                
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 5,
                    suggestedPrice: 25
                };

                // Act & Assert
                await expect(createSingleRequest(requestData)).rejects.toThrow();
            });
        });
    });

    describe('Escudo de Género (Women Only)', () => {
        describe('Rides', () => {
            it('debe permitir women_only de conductora verificada', async () => {
                // Arrange
                await createTestUser('driverFemale');
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: 15,
                    isWomenOnly: true
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
                
                const { data: ride } = await testClient
                    .from('rides')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(ride.is_women_only).toBe(true);
            });

            it('debe rechazar women_only de conductor masculino', async () => {
                // Arrange
                await createTestUser('driverVerified'); // male
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: 15,
                    isWomenOnly: true
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow('mujeres');
            });

            it('debe rechazar women_only de conductor sin género especificado', async () => {
                // Arrange
                const driver = await createTestUser('driverVerified');
                // Establecer género a null
                await testClient
                    .from('profiles')
                    .update({ gender: null })
                    .eq('id', driver.id);
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 2,
                    price: 15,
                    isWomenOnly: true
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow('mujeres');
            });
        });

        describe('Requests', () => {
            it('debe permitir women_only de pasajera verificada', async () => {
                // Arrange
                await createTestUser('passengerFemale');
                
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60),
                    seats: 1,
                    suggestedPrice: 10,
                    isWomenOnly: true
                };

                // Act & Assert
                const result = await createSingleRequest(requestData);
                expect(result).toBeDefined();
                
                const { data: request } = await testClient
                    .from('ride_requests')
                    .select('*')
                    .eq('id', result)
                    .single();
                
                expect(request.is_women_only).toBe(true);
            });

            it('debe rechazar women_only de pasajero masculino', async () => {
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
        });
    });

    describe('Validaciones Temporales', () => {
        describe('Rides (+10 minutos)', () => {
            it('debe aceptar ride exactamente a +10 minutos', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const exactTime = new Date();
                exactTime.setMinutes(exactTime.getMinutes() + 10);
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: exactTime,
                    seats: 2,
                    price: 10
                };

                // Act & Assert
                const result = await createSingleRide(rideData);
                expect(result).toBeDefined();
            });

            it('debe rechazar ride a +9 minutos', async () => {
                // Arrange
                await createTestUser('driverVerified');
                
                const tooEarly = new Date();
                tooEarly.setMinutes(tooEarly.getMinutes() + 9);
                
                const rideData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: tooEarly,
                    seats: 2,
                    price: 10
                };

                // Act & Assert
                await expect(createSingleRide(rideData)).rejects.toThrow('futuro');
            });
        });

        describe('Requests (+5 minutos)', () => {
            it('debe aceptar request exactamente a +5 minutos', async () => {
                // Arrange
                await createTestUser('passengerMale');
                
                const exactTime = new Date();
                exactTime.setMinutes(exactTime.getMinutes() + 5);
                
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: exactTime,
                    seats: 1,
                    suggestedPrice: 10
                };

                // Act & Assert
                const result = await createSingleRequest(requestData);
                expect(result).toBeDefined();
            });

            it('debe rechazar request a +4 minutos', async () => {
                // Arrange
                await createTestUser('passengerMale');
                
                const tooEarly = new Date();
                tooEarly.setMinutes(tooEarly.getMinutes() + 4);
                
                const requestData = {
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: tooEarly,
                    seats: 1,
                    suggestedPrice: 10
                };

                // Act & Assert
                await expect(createSingleRequest(requestData)).rejects.toThrow('futuro');
            });
        });
    });

    describe('Validaciones Geográficas', () => {
        it('debe rechazar origen sin coordenadas', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: { name: 'Sin coordenadas', address: 'Dirección sin coords' },
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 10
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('coordenadas');
        });

        it('debe rechazar destino sin coordenadas', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: testData.locations.sol,
                destination: { name: 'Sin coordenadas', address: 'Dirección sin coords' },
                dateTime: futureDate(60),
                seats: 2,
                price: 10
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow('coordenadas');
        });

        it('debe aceptar coordenadas con latitude/longitude', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
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

            // Act & Assert
            const result = await createSingleRide(rideData);
            expect(result).toBeDefined();
        });

        it('debe aceptar coordenadas con valor cero', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: {
                    name: 'Origen coords cero',
                    coordinates: { lat: 0, lng: 0 }
                },
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 10
            };

            // Act & Assert
            const result = await createSingleRide(rideData);
            expect(result).toBeDefined();
        });
    });

    describe('Límites Monetarios', () => {
        it('debe aceptar precio máximo de 300€', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.chamartin,
                dateTime: futureDate(60),
                seats: 2,
                price: 300
            };

            // Act & Assert
            const result = await createSingleRide(rideData);
            expect(result).toBeDefined();
        });

        it('debe rechazar precio mayor a 300€', async () => {
            // Arrange
            await createTestUser('driverVerified');
            
            const rideData = {
                origin: testData.locations.sol,
                destination: testData.locations.chamartin,
                dateTime: futureDate(60),
                seats: 2,
                price: 300.01
            };

            // Act & Assert
            await expect(createSingleRide(rideData)).rejects.toThrow();
        });
    });
});
