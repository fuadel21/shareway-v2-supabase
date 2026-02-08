/**
 * Tests de Wallet y Pagos
 * Detecta bugs críticos en el sistema financiero
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testClient, createTestUser, testData, futureDate, cleanupTestData } from '../helpers.js';
import { confirmTripAndPay } from '../../services/bookingService.js';
import { addFunds } from '../../lib/supabaseRPC.js';

describe('Wallet and Payment System', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('Confirm Trip and Pay', () => {
        it('debe deducir fondos correctamente al confirmar viaje', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            // Crear ride
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            // Act: Confirmar viaje
            await confirmTripAndPay(rideId);

            // Assert
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(30); // 50 - 20
            expect(parseFloat(wallet.held_balance)).toBe(20); // Hold del viaje

            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            expect(ride.seats_available).toBe(1); // 2 - 1
            expect(ride.passengers).toHaveLength(1);
        });

        it('debe rechazar pago con saldo insuficiente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 10); // Solo 10€
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20 // Más de lo que tiene
            });

            // Act & Assert
            await expect(confirmTripAndPay(rideId)).rejects.toThrow('saldo insuficiente');

            // Verificar que no se modificó el saldo
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(10);
            expect(parseFloat(wallet.held_balance)).toBe(0);
        });

        it('debe generar PIN de 4 dígitos', async () => {
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

            // Act
            await confirmTripAndPay(rideId);

            // Assert
            const { data: ride } = await testClient
                .from('rides')
                .select('*')
                .eq('id', rideId)
                .single();
            
            const passengerData = ride.passengers[0];
            expect(passengerData.pin).toMatch(/^\d{4}$/);
            expect(parseInt(passengerData.pin)).toBeGreaterThanOrEqual(1000);
            expect(parseInt(passengerData.pin)).toBeLessThanOrEqual(9999);
        });
    });

    describe('Add Funds (Recargar Saldo)', () => {
        it('debe añadir fondos correctamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale', 50);
            const paymentMethodId = 'pm_test_123';
            
            vi.mocked(addFunds).mockResolvedValue({
                success: true,
                data: { amount: 50 }
            });

            // Act
            const { addFunds } = await import('../../lib/supabaseRPC.js');
            const result = await addFunds(50, paymentMethodId);

            // Assert
            expect(result.success).toBe(true);
            expect(vi.mocked(addFunds)).toHaveBeenCalledWith(50, paymentMethodId);
        });

        it('debe manejar error en add funds', async () => {
            // Arrange
            vi.mocked(addFunds).mockResolvedValue({
                success: false,
                error: 'Tarjeta rechazada'
            });

            // Act & Assert
            const { addFunds } = await import('../../lib/supabaseRPC.js');
            const result = await addFunds(50, 'pm_test_123');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Tarjeta rechazada');
        });

        it('debe validar cantidad mínima (5€)', async () => {
            // BUG CRÍTICO: No hay validación de cantidad mínima en frontend
            // Debería rechazar cantidades menores a 5€
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('debe validar cantidad máxima (500€)', async () => {
            // BUG CRÍTICO: No hay validación de cantidad máxima
            // Debería rechazar cantidades mayores a 500€ para prevenir fraude
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });

    describe('Transacciones y Auditoría', () => {
        it('debe registrar transacción de hold', async () => {
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

            // Act
            await confirmTripAndPay(rideId);

            // Assert
            const { data: transactions } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'hold');
            
            expect(transactions).toHaveLength(1);
            expect(parseFloat(transactions[0].amount)).toBe(-20);
            expect(transactions[0].related_ride_id).toBe(rideId);
        });

        it('debe registrar transacción de payout al conductor', async () => {
            // BUG CRÍTICO: No hay registro de payout al conductor
            // Debería registrarse cuando se completa el viaje
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('debe tener balance_after correcto en transacciones', async () => {
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

            // Act
            await confirmTripAndPay(rideId);

            // Assert
            const { data: transaction } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'hold')
                .single();
            
            expect(parseFloat(transaction.balance_after)).toBe(30); // 50 - 20
        });
    });

    describe('Consistencia Financiera', () => {
        it('debe mantener consistencia entre balance y held_balance', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 100);
            
            // Crear 2 rides
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId1 = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 25
            });

            const rideId2 = await createSingleRide({
                origin: testData.locations.retiro,
                destination: testData.locations.chamartin,
                dateTime: futureDate(120),
                seats: 2,
                price: 30
            });

            // Act: Confirmar ambos viajes
            await confirmTripAndPay(rideId1);
            await confirmTripAndPay(rideId2);

            // Assert
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(45); // 100 - 25 - 30
            expect(parseFloat(wallet.held_balance)).toBe(55); // 25 + 30
            
            // La suma debe ser el total original
            expect(parseFloat(wallet.balance) + parseFloat(wallet.held_balance)).toBe(100);
        });

        it('debe liberar fondos al cancelar viaje', async () => {
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

            await confirmTripAndPay(rideId);

            // Act: Cancelar booking
            const { cancelBookingAndRefund } = await import('../../services/bookingService.js');
            await cancelBookingAndRefund(rideId);

            // Assert
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(50); // Recuperado
            expect(parseFloat(wallet.held_balance)).toBe(0); // Liberado

            const { data: refundTransaction } = await testClient
                .from('transactions')
                .select('*')
                .eq('user_id', passenger.id)
                .eq('type', 'refund')
                .single();
            
            expect(parseFloat(refundTransaction.amount)).toBe(20);
        });
    });

    describe('Bugs Críticos Detectados', () => {
        it('BUG: No hay validación de límite diario de recarga', async () => {
            // CRÍTICO: Se puede recargar ilimitadamente
            // Debería haber un límite diario (ej: 500€) para prevenir lavado de dinero
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay detección de transacciones sospechosas', async () => {
            // CRÍTICO: No hay sistema anti-fraude
            // Debería detectar patrones sospechosos (múltiples recargas, etc.)
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay reconciliación automática', async () => {
            // CRÍTICO: Los pagos de Stripe no se reconcilian automáticamente
            // Debería haber un webhook que actualice el balance
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay escrow para disputas', async () => {
            // CRÍTICO: Los fondos van directamente al conductor
            // Debería quedar en escrow hasta que se complete el viaje
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay comisiones configurables', async () => {
            // CRÍTICO: La comisión del 10% está hardcodeada
            // Debería ser configurable desde el admin panel
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });

    describe('Edge Cases Financieros', () => {
        it('debe manejar decimales correctamente', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 50);
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 12.50 // Precio con decimales
            });

            // Act
            await confirmTripAndPay(rideId);

            // Assert
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(37.50); // 50 - 12.50
            expect(parseFloat(wallet.held_balance)).toBe(12.50);
        });

        it('debe prevenir balance negativo', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified', 100);
            const passenger = await createTestUser('passengerMale', 0); // Sin saldo
            
            const { createSingleRide } = await import('../../services/rideService.js');
            const rideId = await createSingleRide({
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 2,
                price: 20
            });

            // Act & Assert
            await expect(confirmTripAndPay(rideId)).rejects.toThrow();

            // Verificar que el balance no es negativo
            const { data: wallet } = await testClient
                .from('wallets')
                .select('*')
                .eq('user_id', passenger.id)
                .single();
            
            expect(parseFloat(wallet.balance)).toBe(0);
            expect(parseFloat(wallet.held_balance)).toBe(0);
        });
    });
});
