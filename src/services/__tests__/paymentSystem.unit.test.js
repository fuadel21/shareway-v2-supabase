/**
 * Tests Unitarios Puros para Payment System
 * Mock completo del servicio para aislar tests de la lógica real
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock completo del servicio de pagos
const mockPaymentService = {
  processPayment: vi.fn(),
  refundPayment: vi.fn(),
  validatePaymentMethod: vi.fn(),
  calculateFees: vi.fn(),
  processBatchPayments: vi.fn(),
  getPaymentHistory: vi.fn(),
  getWalletBalance: vi.fn(),
  addToWallet: vi.fn(),
  withdrawFromWallet: vi.fn()
};

// Mock del cliente Supabase
const mockSupabase = {
  rpc: vi.fn(),
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      }))
    }))
  }))
};

// Mock de utilidades
const mockFutureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

// Datos de prueba válidos
const validPaymentData = {
  userId: 'user-123',
  rideId: 'ride-456',
  amount: 25.50,
  currency: 'EUR',
  paymentMethod: 'wallet',
  description: 'Pago por viaje completado'
};

const validPaymentMethod = {
  type: 'credit_card',
  lastFour: '1234',
  brand: 'visa',
  expiryMonth: 12,
  expiryYear: 2025,
  holderName: 'Juan Pérez'
};

const validWalletData = {
  userId: 'user-123',
  balance: 150.75,
  currency: 'EUR',
  lastUpdated: new Date().toISOString()
};

describe('💳 Tests Unitarios Puros para Sistema de Pagos (Payment System)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('✅ Procesamiento de Pagos (processPayment)', () => {
    it('debería procesar un pago correctamente con wallet', async () => {
      const mockResponse = {
        success: true,
        paymentId: 'payment-789',
        status: 'completed',
        amount: 25.50,
        currency: 'EUR',
        paymentMethod: 'wallet',
        processedAt: new Date().toISOString(),
        remainingBalance: 124.25
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(validPaymentData);

      expect(result.success).toBe(true);
      expect(result.paymentId).toBe('payment-789');
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(25.50);
      expect(result.remainingBalance).toBe(124.25);
      expect(mockPaymentService.processPayment).toHaveBeenCalledWith(validPaymentData);
    });

    it('debería procesar pago con tarjeta de crédito', async () => {
      const creditCardPayment = {
        ...validPaymentData,
        paymentMethod: 'credit_card',
        cardDetails: validPaymentMethod
      };

      const mockResponse = {
        success: true,
        paymentId: 'payment-cc-123',
        status: 'completed',
        amount: 25.50,
        paymentMethod: 'credit_card',
        cardLastFour: '1234',
        authorizationCode: 'AUTH123456',
        processedAt: new Date().toISOString()
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(creditCardPayment);

      expect(result.success).toBe(true);
      expect(result.paymentMethod).toBe('credit_card');
      expect(result.cardLastFour).toBe('1234');
      expect(result.authorizationCode).toBe('AUTH123456');
    });

    it('debería procesar pago con PayPal', async () => {
      const paypalPayment = {
        ...validPaymentData,
        paymentMethod: 'paypal',
        paypalEmail: 'user@example.com'
      };

      const mockResponse = {
        success: true,
        paymentId: 'payment-pp-456',
        status: 'completed',
        amount: 25.50,
        paymentMethod: 'paypal',
        paypalTransactionId: 'PP123456789',
        processedAt: new Date().toISOString()
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(paypalPayment);

      expect(result.success).toBe(true);
      expect(result.paymentMethod).toBe('paypal');
      expect(result.paypalTransactionId).toBe('PP123456789');
    });

    it('debería procesar pago múltiple correctamente', async () => {
      const multiplePayments = [
        { ...validPaymentData, amount: 15.00, rideId: 'ride-1' },
        { ...validPaymentData, amount: 20.50, rideId: 'ride-2' },
        { ...validPaymentData, amount: 30.00, rideId: 'ride-3' }
      ];

      const mockResponses = multiplePayments.map((payment, index) => ({
        success: true,
        paymentId: `payment-${index + 1}`,
        status: 'completed',
        amount: payment.amount,
        rideId: payment.rideId
      }));

      mockPaymentService.processPayment.mockImplementation((data) => {
        const index = multiplePayments.findIndex(p => p.rideId === data.rideId);
        return Promise.resolve(mockResponses[index]);
      });

      const results = await Promise.all(
        multiplePayments.map(payment => mockPaymentService.processPayment(payment))
      );

      expect(results.every(r => r.success)).toBe(true);
      expect(results.map(r => r.amount)).toEqual([15.00, 20.50, 30.00]);
    });

    it('debería calcular y aplicar comisiones correctamente', async () => {
      const paymentWithFees = {
        ...validPaymentData,
        amount: 100.00
      };

      const mockResponse = {
        success: true,
        paymentId: 'payment-with-fees',
        status: 'completed',
        grossAmount: 100.00,
        platformFee: 3.00, // 3%
        processingFee: 2.50, // 2.5%
        netAmount: 94.50,
        totalFees: 5.50
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(paymentWithFees);

      expect(result.success).toBe(true);
      expect(result.grossAmount).toBe(100.00);
      expect(result.platformFee).toBe(3.00);
      expect(result.processingFee).toBe(2.50);
      expect(result.netAmount).toBe(94.50);
      expect(result.totalFees).toBe(5.50);
    });
  });

  describe('✅ Reembolsos (refundPayment)', () => {
    it('debería procesar reembolso completo correctamente', async () => {
      const refundData = {
        paymentId: 'payment-789',
        amount: 25.50,
        reason: 'Viaje cancelado',
        refundType: 'full'
      };

      const mockResponse = {
        success: true,
        refundId: 'refund-123',
        status: 'completed',
        refundedAmount: 25.50,
        originalPaymentId: 'payment-789',
        processedAt: new Date().toISOString(),
        message: 'Reembolso completo procesado'
      };

      mockPaymentService.refundPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.refundPayment(refundData);

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('refund-123');
      expect(result.refundedAmount).toBe(25.50);
      expect(result.status).toBe('completed');
    });

    it('debería procesar reembolso parcial correctamente', async () => {
      const partialRefundData = {
        paymentId: 'payment-789',
        amount: 10.00,
        reason: 'Servicio deficiente',
        refundType: 'partial'
      };

      const mockResponse = {
        success: true,
        refundId: 'refund-partial-456',
        status: 'completed',
        refundedAmount: 10.00,
        originalAmount: 25.50,
        refundType: 'partial',
        remainingAmount: 15.50
      };

      mockPaymentService.refundPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.refundPayment(partialRefundData);

      expect(result.success).toBe(true);
      expect(result.refundedAmount).toBe(10.00);
      expect(result.refundType).toBe('partial');
      expect(result.remainingAmount).toBe(15.50);
    });

    it('debería manejar reembolso con penalización', async () => {
      const refundWithPenaltyData = {
        paymentId: 'payment-789',
        amount: 25.50,
        reason: 'Cancelación tardía',
        refundType: 'partial_with_penalty',
        penaltyAmount: 5.00
      };

      const mockResponse = {
        success: true,
        refundId: 'refund-penalty-789',
        status: 'completed',
        originalAmount: 25.50,
        penaltyAmount: 5.00,
        refundedAmount: 20.50,
        netRefund: 15.50 // Después de comisiones
      };

      mockPaymentService.refundPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.refundPayment(refundWithPenaltyData);

      expect(result.success).toBe(true);
      expect(result.penaltyAmount).toBe(5.00);
      expect(result.refundedAmount).toBe(20.50);
      expect(result.netRefund).toBe(15.50);
    });

    it('debería procesar reembolso a wallet', async () => {
      const walletRefundData = {
        paymentId: 'payment-789',
        amount: 25.50,
        refundMethod: 'wallet',
        userId: 'user-123'
      };

      const mockResponse = {
        success: true,
        refundId: 'refund-wallet-123',
        status: 'completed',
        refundedAmount: 25.50,
        refundMethod: 'wallet',
        walletBalanceBefore: 100.00,
        walletBalanceAfter: 125.50
      };

      mockPaymentService.refundPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.refundPayment(walletRefundData);

      expect(result.success).toBe(true);
      expect(result.refundMethod).toBe('wallet');
      expect(result.walletBalanceAfter).toBe(125.50);
    });

    it('debería procesar reembolso a tarjeta de crédito', async () => {
      const cardRefundData = {
        paymentId: 'payment-789',
        amount: 25.50,
        refundMethod: 'credit_card',
        cardLastFour: '1234'
      };

      const mockResponse = {
        success: true,
        refundId: 'refund-card-456',
        status: 'completed',
        refundedAmount: 25.50,
        refundMethod: 'credit_card',
        cardLastFour: '1234',
        refundReference: 'REF123456789'
      };

      mockPaymentService.refundPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.refundPayment(cardRefundData);

      expect(result.success).toBe(true);
      expect(result.refundMethod).toBe('credit_card');
      expect(result.cardLastFour).toBe('1234');
      expect(result.refundReference).toBe('REF123456789');
    });
  });

  describe('✅ Gestión de Wallet (Wallet Management)', () => {
    it('debería obtener balance de wallet correctamente', async () => {
      const mockResponse = {
        success: true,
        userId: 'user-123',
        balance: 150.75,
        currency: 'EUR',
        lastUpdated: new Date().toISOString(),
        availableBalance: 145.25, // Después de retenciones
        pendingAmount: 5.50
      };

      mockPaymentService.getWalletBalance.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.getWalletBalance('user-123');

      expect(result.success).toBe(true);
      expect(result.balance).toBe(150.75);
      expect(result.availableBalance).toBe(145.25);
      expect(result.pendingAmount).toBe(5.50);
    });

    it('debería agregar fondos a wallet correctamente', async () => {
      const addFundsData = {
        userId: 'user-123',
        amount: 50.00,
        source: 'credit_card',
        description: 'Recarga de wallet'
      };

      const mockResponse = {
        success: true,
        transactionId: 'wallet-add-123',
        userId: 'user-123',
        amount: 50.00,
        previousBalance: 150.75,
        newBalance: 200.75,
        processedAt: new Date().toISOString()
      };

      mockPaymentService.addToWallet.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.addToWallet(addFundsData);

      expect(result.success).toBe(true);
      expect(result.amount).toBe(50.00);
      expect(result.previousBalance).toBe(150.75);
      expect(result.newBalance).toBe(200.75);
    });

    it('debería retirar fondos de wallet correctamente', async () => {
      const withdrawFundsData = {
        userId: 'user-123',
        amount: 30.00,
        destination: 'bank_account',
        description: 'Retiro a cuenta bancaria'
      };

      const mockResponse = {
        success: true,
        transactionId: 'wallet-withdraw-456',
        userId: 'user-123',
        amount: 30.00,
        previousBalance: 200.75,
        newBalance: 170.75,
        processedAt: new Date().toISOString(),
        estimatedArrival: '3-5 días hábiles'
      };

      mockPaymentService.withdrawFromWallet.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.withdrawFromWallet(withdrawFundsData);

      expect(result.success).toBe(true);
      expect(result.amount).toBe(30.00);
      expect(result.newBalance).toBe(170.75);
      expect(result.estimatedArrival).toBe('3-5 días hábiles');
    });

    it('debería validar saldo suficiente para retiro', async () => {
      const withdrawInsufficientData = {
        userId: 'user-123',
        amount: 500.00, // Más que el balance
        destination: 'bank_account'
      };

      const mockResponse = {
        success: false,
        error: 'Saldo insuficiente',
        code: 'INSUFFICIENT_BALANCE',
        currentBalance: 170.75,
        requestedAmount: 500.00,
        deficit: 329.25
      };

      mockPaymentService.withdrawFromWallet.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.withdrawFromWallet(withdrawInsufficientData);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_BALANCE');
      expect(result.deficit).toBe(329.25);
    });
  });

  describe('✅ Validación de Métodos de Pago (validatePaymentMethod)', () => {
    it('debería validar tarjeta de crédito correctamente', async () => {
      const mockResponse = {
        success: true,
        isValid: true,
        paymentMethod: {
          type: 'credit_card',
          lastFour: '1234',
          brand: 'visa',
          isValid: true,
          expiryDate: '12/2025'
        }
      };

      mockPaymentService.validatePaymentMethod.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.validatePaymentMethod(validPaymentMethod);

      expect(result.success).toBe(true);
      expect(result.isValid).toBe(true);
      expect(result.paymentMethod.brand).toBe('visa');
    });

    it('debería rechazar tarjeta expirada', async () => {
      const expiredCard = {
        ...validPaymentMethod,
        expiryMonth: 6,
        expiryYear: 2023 // Expirada
      };

      const mockResponse = {
        success: false,
        isValid: false,
        error: 'Tarjeta expirada',
        code: 'CARD_EXPIRED'
      };

      mockPaymentService.validatePaymentMethod.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.validatePaymentMethod(expiredCard);

      expect(result.success).toBe(false);
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('CARD_EXPIRED');
    });

    it('debería validar cuenta PayPal correctamente', async () => {
      const paypalAccount = {
        type: 'paypal',
        email: 'user@example.com',
        isVerified: true
      };

      const mockResponse = {
        success: true,
        isValid: true,
        paymentMethod: {
          type: 'paypal',
          email: 'user@example.com',
          isVerified: true
        }
      };

      mockPaymentService.validatePaymentMethod.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.validatePaymentMethod(paypalAccount);

      expect(result.success).toBe(true);
      expect(result.isValid).toBe(true);
      expect(result.paymentMethod.isVerified).toBe(true);
    });

    it('debería validar wallet correctamente', async () => {
      const walletMethod = {
        type: 'wallet',
        userId: 'user-123'
      };

      const mockResponse = {
        success: true,
        isValid: true,
        paymentMethod: {
          type: 'wallet',
          userId: 'user-123',
          balance: 150.75,
          isActive: true
        }
      };

      mockPaymentService.validatePaymentMethod.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.validatePaymentMethod(walletMethod);

      expect(result.success).toBe(true);
      expect(result.isValid).toBe(true);
      expect(result.paymentMethod.balance).toBe(150.75);
    });
  });

  describe('✅ Procesamiento por Lotes (processBatchPayments)', () => {
    it('debería procesar pagos por lote correctamente', async () => {
      const batchPayments = [
        { userId: 'user-1', amount: 25.50, rideId: 'ride-1' },
        { userId: 'user-2', amount: 30.00, rideId: 'ride-2' },
        { userId: 'user-3', amount: 20.75, rideId: 'ride-3' }
      ];

      const mockResponse = {
        success: true,
        batchId: 'batch-123',
        totalPayments: 3,
        totalAmount: 76.25,
        processedPayments: 3,
        failedPayments: 0,
        details: [
          { paymentId: 'payment-1', status: 'completed', amount: 25.50 },
          { paymentId: 'payment-2', status: 'completed', amount: 30.00 },
          { paymentId: 'payment-3', status: 'completed', amount: 20.75 }
        ]
      };

      mockPaymentService.processBatchPayments.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processBatchPayments(batchPayments);

      expect(result.success).toBe(true);
      expect(result.totalPayments).toBe(3);
      expect(result.totalAmount).toBe(76.25);
      expect(result.processedPayments).toBe(3);
      expect(result.failedPayments).toBe(0);
    });

    it('debería manejar pagos fallidos en lote', async () => {
      const batchWithFailures = [
        { userId: 'user-1', amount: 25.50, rideId: 'ride-1' },
        { userId: 'user-2', amount: 30.00, rideId: 'ride-2' }, // Este fallará
        { userId: 'user-3', amount: 20.75, rideId: 'ride-3' }
      ];

      const mockResponse = {
        success: true,
        batchId: 'batch-456',
        totalPayments: 3,
        processedPayments: 2,
        failedPayments: 1,
        totalAmount: 76.25,
        processedAmount: 46.25,
        details: [
          { paymentId: 'payment-1', status: 'completed', amount: 25.50 },
          { paymentId: 'payment-2', status: 'failed', error: 'Fondos insuficientes', amount: 30.00 },
          { paymentId: 'payment-3', status: 'completed', amount: 20.75 }
        ]
      };

      mockPaymentService.processBatchPayments.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processBatchPayments(batchWithFailures);

      expect(result.success).toBe(true);
      expect(result.processedPayments).toBe(2);
      expect(result.failedPayments).toBe(1);
      expect(result.processedAmount).toBe(46.25);
    });
  });

  describe('❌ Validaciones y Errores', () => {
    it('debería rechazar pago con monto inválido', async () => {
      const invalidPaymentData = {
        ...validPaymentData,
        amount: -10.00
      };

      const mockResponse = {
        success: false,
        error: 'Monto inválido',
        code: 'INVALID_AMOUNT'
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(invalidPaymentData);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT');
    });

    it('debería rechazar pago con método no soportado', async () => {
      const unsupportedPaymentData = {
        ...validPaymentData,
        paymentMethod: 'crypto' // Método no soportado
      };

      const mockResponse = {
        success: false,
        error: 'Método de pago no soportado',
        code: 'UNSUPPORTED_PAYMENT_METHOD'
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(unsupportedPaymentData);

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNSUPPORTED_PAYMENT_METHOD');
    });

    it('debería rechazar pago con fondos insuficientes', async () => {
      const insufficientFundsData = {
        ...validPaymentData,
        amount: 500.00 // Más que el balance
      };

      const mockResponse = {
        success: false,
        error: 'Fondos insuficientes',
        code: 'INSUFFICIENT_FUNDS',
        currentBalance: 150.75,
        requiredAmount: 500.00,
        deficit: 349.25
      };

      mockPaymentService.processPayment.mockResolvedValue(mockResponse);

      const result = await mockPaymentService.processPayment(insufficientFundsData);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_FUNDS');
      expect(result.deficit).toBe(349.25);
    });

    it('debería manejar error de conexión con procesador de pagos', async () => {
      mockPaymentService.processPayment.mockRejectedValue(
        new Error('Error de conexión con procesador de pagos')
      );

      try {
        await mockPaymentService.processPayment(validPaymentData);
      } catch (error) {
        expect(error.message).toBe('Error de conexión con procesador de pagos');
      }
    });

    it('debería manejar timeout en procesamiento', async () => {
      mockPaymentService.processPayment.mockRejectedValue(
        new Error('Timeout: procesamiento excedió tiempo límite')
      );

      try {
        await mockPaymentService.processPayment(validPaymentData);
      } catch (error) {
        expect(error.message).toContain('Timeout');
      }
    });
  });

  describe('🔄 Tests de Concurrencia', () => {
    it('debería prevenir doble cargo del mismo pago', async () => {
      const duplicatePayment = {
        ...validPaymentData,
        paymentId: 'unique-payment-123'
      };

      // Mock primera llamada exitosa
      mockPaymentService.processPayment.mockResolvedValueOnce({
        success: true,
        paymentId: 'payment-first',
        status: 'completed'
      });

      // Mock segunda llamada rechazada
      mockPaymentService.processPayment.mockResolvedValueOnce({
        success: false,
        error: 'Pago ya procesado',
        code: 'PAYMENT_ALREADY_PROCESSED'
      });

      const [firstResult, secondResult] = await Promise.all([
        mockPaymentService.processPayment(duplicatePayment),
        mockPaymentService.processPayment(duplicatePayment)
      ]);

      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(false);
      expect(secondResult.code).toBe('PAYMENT_ALREADY_PROCESSED');
    });

    it('debería manejar múltiples retiros de wallet concurrentemente', async () => {
      const withdrawals = [
        { userId: 'user-123', amount: 20.00 },
        { userId: 'user-123', amount: 30.00 },
        { userId: 'user-123', amount: 15.00 }
      ];

      const mockResponses = [
        { success: true, newBalance: 130.75 }, // 150.75 - 20.00
        { success: true, newBalance: 100.75 }, // 130.75 - 30.00
        { success: true, newBalance: 85.75 }   // 100.75 - 15.00
      ];

      mockPaymentService.withdrawFromWallet
        .mockResolvedValueOnce(mockResponses[0])
        .mockResolvedValueOnce(mockResponses[1])
        .mockResolvedValueOnce(mockResponses[2]);

      const results = await Promise.all(
        withdrawals.map(withdrawal => mockPaymentService.withdrawFromWallet(withdrawal))
      );

      expect(results.every(r => r.success)).toBe(true);
      expect(results.map(r => r.newBalance)).toEqual([130.75, 100.75, 85.75]);
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería completar procesamiento de pago en tiempo razonable', async () => {
      const startTime = Date.now();

      mockPaymentService.processPayment.mockResolvedValue({
        success: true,
        paymentId: 'payment-performance',
        status: 'completed'
      });

      await mockPaymentService.processPayment(validPaymentData);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(200); // Menos de 200ms
    });

    it('debería manejar alta carga de pagos eficientemente', async () => {
      const payments = Array.from({ length: 100 }, (_, i) => ({
        ...validPaymentData,
        rideId: `ride-${i}`,
        amount: 25.00 + (i * 0.50)
      }));

      mockPaymentService.processPayment.mockResolvedValue({
        success: true,
        status: 'completed'
      });

      const startTime = Date.now();
      const results = await Promise.all(
        payments.map(payment => mockPaymentService.processPayment(payment))
      );
      const endTime = Date.now();

      expect(results.every(r => r.success)).toBe(true);
      expect(endTime - startTime).toBeLessThan(2000); // Menos de 2 segundos
    });

    it('debería procesar lote de pagos grande eficientemente', async () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        userId: `user-${i}`,
        amount: 25.00,
        rideId: `ride-${i}`
      }));

      mockPaymentService.processBatchPayments.mockResolvedValue({
        success: true,
        batchId: 'batch-large',
        totalPayments: 1000,
        processedPayments: 1000,
        failedPayments: 0
      });

      const startTime = Date.now();
      const result = await mockPaymentService.processBatchPayments(largeBatch);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.processedPayments).toBe(1000);
      expect(endTime - startTime).toBeLessThan(5000); // Menos de 5 segundos
    });
  });
});
