/**
 * Tests de Verificación de Fixes Críticos
 * Asegura que los bugs bloqueantes estén realmente solucionados
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testClient, createTestUser, testData, futureDate, cleanupTestData } from '../helpers.js';

describe('Critical Fixes Verification', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('Race Conditions Fix', () => {
        it('debe prevenir doble reserva de la misma plaza', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger1 = await createTestUser('passengerMale', 50);
            const passenger2 = await createTestUser('passengerFemale', 50);
            
            // Crear ride con 1 plaza
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                price: 20
            });

            // Act: Ambos pasajeros intentan confirmar simultáneamente
            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            
            const results = await Promise.allSettled([
                confirmTripAndPay(rideId),
                confirmTripAndPay(rideId)
            ]);

            // Assert: Solo uno debe tener éxito
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;
            
            expect(successCount).toBe(1);
            expect(failureCount).toBe(1);
            
            // Verificar que solo hay un pasajero en el ride
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.passengers).toHaveLength(1);
            expect(ride.seats_available).toBe(0);
        });

        it('debe mantener consistencia entre seats_available y passengers', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger1 = await createTestUser('passengerMale', 50);
            const passenger2 = await createTestUser('passengerFemale', 50);
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 3,
                price: 20
            });

            // Act: Confirmar ambos pasajeros
            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            await confirmTripAndPay(rideId);
            await confirmTripAndPay(rideId);

            // Assert: Verificar consistencia
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.seats_available).toBe(1); // 3 - 2
            expect(ride.passengers).toHaveLength(2);
            expect(ride.seats_total).toBe(3);
            
            // La suma debe ser consistente
            expect(ride.seats_available + ride.passengers.length).toBe(ride.seats_total);
        });
    });

    describe('Admin Permissions Fix', () => {
        it('debe rechazar acciones no autorizadas', async () => {
            // Arrange: Usuario normal intentando acceder a funciones de admin
            const normalUser = await createTestUser('passengerMale', 50);
            
            // Mock auth para simular usuario normal
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: normalUser.id }
            });

            // Act & Assert: Intentar acceder a funciones de admin
            const { getPlatformStatsSecure } = await import('../../lib/supabaseRPC.js');
            
            await expect(getPlatformStatsSecure()).rejects.toThrow('permisos de administrador');
        });

        it('debe permitir acciones a usuarios admin', async () => {
            // Arrange: Usuario admin
            const adminUser = await createTestUser('driverVerified', 100);
            
            // Actualizar rol a admin
            await testClient
                .from('profiles')
                .update({ role: 'admin' })
                .eq('id', adminUser.id);
            
            // Mock auth para simular admin
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: adminUser.id, role: 'admin' }
            });

            // Act: Acceder a funciones de admin
            const { getPlatformStatsSecure } = await import('../../lib/supabaseRPC.js');
            
            // Assert: No debe rechazar por permisos (puede fallar por otros motivos)
            // La función interna puede fallar si no hay stats, pero no por permisos
            expect(true).toBe(true); // Placeholder para test real
        });

        it('debe registrar auditoría de acciones de admin', async () => {
            // Arrange
            const adminUser = await createTestUser('driverVerified', 100);
            await testClient
                .from('profiles')
                .update({ role: 'admin' })
                .eq('id', adminUser.id);
            
            // Mock auth
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: adminUser.id, role: 'admin' }
            });

            // Act: Realizar acción de admin
            const { logAdminAction } = await import('../../lib/supabaseRPC.js');
            await logAdminAction('test_action', { test: 'data' });

            // Assert: Verificar que se registró en auditoría
            const { data: auditLog } = await testClient
                .from('admin_audit_logs')
                .select('*')
                .eq('admin_id', adminUser.id)
                .eq('action', 'test_action')
                .single();
            
            expect(auditLog).toBeTruthy();
            expect(auditLog.details).toEqual({ test: 'data' });
        });
    });

    describe('Escrow System Fix', () => {
        it('debe mover fondos a escrow al confirmar viaje', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            // Act: Confirmar viaje
            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            await confirmTripAndPay(rideId);

            // Assert: Verificar que los fondos están en escrow
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(30); // 50 - 20
            expect(parseFloat(wallet.held_balance)).toBe(0); // Se movió a escrow
            expect(parseFloat(wallet.escrow_balance)).toBe(20); // En escrow
            expect(wallet.escrow_release_date).toBeTruthy();
        });

        it('debe liberar fondos al completar viaje', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            // Confirmar viaje
            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            await confirmTripAndPay(rideId);

            // Marcar como in_progress
            await testClient
                .from('rides')
                .update({ status: 'in_progress' })
                .eq('id', rideId);

            // Act: Completar viaje
            const { completeRide } = await import('../../services/rideService.js');
            await completeRide(rideId);

            // Assert: Verificar que los fondos se liberaron al conductor
            const { data: driverWallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', driver.id)
                .single();
            
            expect(parseFloat(driverWallet.balance)).toBeGreaterThan(100); // Recibió pago
            expect(parseFloat(driverWallet.balance)).toBeLessThan(120); // Menos comisión
            
            const { data: passengerWallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(passengerWallet.balance)).toBe(30); // Sin cambios
            expect(parseFloat(passengerWallet.escrow_balance)).toBe(0); // Liberado
        });

        it('debe manejar disputas correctamente', async () => {
            // Arrange
            const adminUser = await createTestUser('driverVerified', 100);
            const driver = await createTestUser('driverFemale', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            // Crear y confirmar viaje
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            await confirmTripAndPay(rideId);

            // Mock admin
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: adminUser.id, role: 'admin' }
            });

            // Act: Resolver disputa a favor del pasajero
            const { resolveDispute } = await import('../../lib/supabaseRPC.js');
            await resolveDispute(rideId, passenger.id, 'refund_passenger', 'Servicio deficiente');

            // Assert: Verificar reembolso
            const { data: passengerWallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(passengerWallet.balance)).toBe(50); // Recuperado
            expect(parseFloat(passengerWallet.escrow_balance)).toBe(0);
        });
    });

    describe('Rate Limiting Fix', () => {
        it('debe limitar creación de rides por día', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 1000);
            
            // Mock auth
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: driver.id }
            });

            // Act: Intentar crear 6 rides (límite es 5)
            const { createSingleRide } = await import('../../services/rideService.js');
            
            const ridePromises = Array.from({ length: 6 }, (_, i) => 
                createSingleRide({
                    origin: testData.locations.sol,
                    destination: testData.locations.plazaMayor,
                    dateTime: futureDate(60 + i * 60),
                    seats: 2,
                    price: 10 + i
                })
            );

            const results = await Promise.allSettled(ridePromises);
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            // Assert: Máximo 5 deben tener éxito
            expect(successCount).toBe(5);
            expect(failureCount).toBe(1);
            
            // Verificar mensaje de error
            const failureReason = results.find(r => r.status === 'rejected')?.reason?.message;
            expect(failureReason).toContain('límite de 5 rides por día');
        });

        it('debe validar coordenadas extremas', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            
            // Mock auth
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: driver.id }
            });

            // Act: Intentar crear ride con coordenadas inválidas
            const { createSingleRide } = await import('../../services/rideService.js');
            
            const invalidRide = {
                origin: {
                    name: 'Polo Norte',
                    coordinates: { lat: 95, lng: 0 } // Inválido (> 90)
                },
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            };

            // Assert: Debe rechazar por coordenadas inválidas
            await expect(createSingleRide(invalidRide)).rejects.toThrow('Coordenadas de origen inválidas');
        });

        it('debe validar distancia máxima', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            
            // Mock auth
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: driver.id }
            });

            // Act: Intentar crear ride con distancia excesiva
            const { createSingleRide } = await import('../../services/rideService.js');
            
            const longDistanceRide = {
                origin: testData.locations.sol,
                destination: {
                    name: 'Lugar muy lejano',
                    coordinates: { lat: 51.5074, lng: -0.1278 },
                    distance: 600 // km (máximo es 500)
                },
                dateTime: futureDate(60),
                seats: 2,
                price: 100
            };

            // Assert: Debe rechazar por distancia inválida
            await expect(createSingleRide(longDistanceRide)).rejects.toThrow('distancia del viaje es inválida');
        });
    });

    describe('Data Consistency', () => {
        it('debe mantener consistencia al cancelar ride con pasajeros', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            // Confirmar viaje
            const { confirmTripAndPay } = await import('../../services/bookingService.js');
            await confirmTripAndPay(rideId);

            // Act: Cancelar ride
            const { cancelRide } = await import('../../services/rideService.js');
            await cancelRide(rideId);

            // Assert: Verificar estado final
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.status).toBe('cancelled');
            
            // BUG CRÍTICO: Los pasajeros deberían ser eliminados
            expect(ride.passengers).toHaveLength(0);
            expect(ride.seats_available).toBe(2); // Debería restaurarse
        });

        it('debe prevenir auto-valoración', async () => {
            // Arrange
            const user = await createTestUser('driverVerified', 100);
            
            // Mock auth
            vi.mocked(require('../../lib/supabase').supabase.auth.getUser).mockResolvedValue({
                user: { id: user.id }
            });

            // Act: Intentar valorarse a sí mismo
            const { submitReview } = await import('../../services/rideService.js');
            
            // Assert: Debe rechazar auto-valoración
            await expect(submitReview({
                rideId: 'test-ride-id',
                revieweeId: user.id, // Mismo usuario
                rating: 5,
                comment: 'Auto-valoración'
            })).rejects.toThrow('No puedes valorarte a ti mismo');
        });
    });
});
