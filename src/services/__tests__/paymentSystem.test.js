/**
 * Tests Exhaustivos para Sistema de Cobros y Pagos
 * Cobertura completa de transacciones, wallets, procesamiento de pagos y validaciones
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { 
  processPayment,
  refundPayment,
  getWalletBalance,
  addFunds,
  withdrawFunds,
  getTransactionHistory,
  validatePayment,
  processBatchPayments
} from '@/services/paymentService';

// Mock de Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          then: vi.fn(),
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                then: vi.fn()
              }))
            }))
          })
        })),
        in: vi.fn(() => ({
          then: vi.fn()
        }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          then: vi.fn()
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn()
        }))
      }))
    })),
    auth: {
      getUser: vi.fn()
    }
  }
}));

describe('💳 Tests de Sistema de Cobros y Pagos', () => {
  const mockUserId = 'user-123';
  const mockDriverId = 'driver-456';
  const mockPassengerId = 'passenger-789';
  const mockRideId = 'ride-101';
  const mockTransactionId = 'txn-202';

  const mockWallet = {
    user_id: mockUserId,
    balance: 100.00,
    currency: 'EUR',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mockTransaction = {
    id: mockTransactionId,
    user_id: mockUserId,
    type: 'payment',
    amount: 25.50,
    currency: 'EUR',
    status: 'completed',
    ride_id: mockRideId,
    description: 'Pago por viaje Madrid-Barcelona',
    created_at: new Date().toISOString()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockUserId } }
    });
  });

  describe('✅ Procesamiento de Pagos (processPayment)', () => {
    it('debería procesar pago correctamente', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId,
        description: 'Pago por viaje'
      };

      const mockResult = {
        success: true,
        transactionId: mockTransactionId,
        status: 'completed',
        fromBalance: 74.50, // 100 - 25.50
        toBalance: 125.50,   // 100 + 25.50
        processedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processPayment(paymentData);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(mockTransactionId);
      expect(result.fromBalance).toBe(74.50);
      expect(result.toBalance).toBe(125.50);
      expect(supabase.rpc).toHaveBeenCalledWith('process_payment', expect.objectContaining({
        p_from_user_id: mockPassengerId,
        p_to_user_id: mockDriverId,
        p_amount: 25.50,
        p_ride_id: mockRideId
      }));
    });

    it('debería procesar pago con comisión', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId,
        commission: 2.55, // 10% de comisión
        description: 'Pago con comisión'
      };

      const mockResult = {
        success: true,
        transactionId: mockTransactionId,
        status: 'completed',
        grossAmount: 25.50,
        commission: 2.55,
        netAmount: 22.95,
        fromBalance: 74.50,
        toBalance: 122.95, // 100 + 22.95
        platformBalance: 2.55
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processPayment(paymentData);

      expect(result.success).toBe(true);
      expect(result.netAmount).toBe(22.95);
      expect(result.commission).toBe(2.55);
      expect(result.platformBalance).toBe(2.55);
    });

    it('debería procesar pago múltiple pasajeros', async () => {
      const paymentData = {
        fromUserIds: [mockPassengerId, 'passenger-2', 'passenger-3'],
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId,
        description: 'Pago múltiple'
      };

      const mockResult = {
        success: true,
        batchId: 'batch-123',
        transactions: [
          { userId: mockPassengerId, transactionId: 'txn-1', status: 'completed' },
          { userId: 'passenger-2', transactionId: 'txn-2', status: 'completed' },
          { userId: 'passenger-3', transactionId: 'txn-3', status: 'completed' }
        ],
        totalAmount: 76.50,
        driverBalance: 176.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processPayment(paymentData);

      expect(result.success).toBe(true);
      expect(result.transactions).toHaveLength(3);
      expect(result.totalAmount).toBe(76.50);
    });

    it('debería procesar pago con método específico', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId,
        paymentMethod: 'credit_card',
        description: 'Pago con tarjeta'
      };

      const mockResult = {
        success: true,
        transactionId: mockTransactionId,
        status: 'completed',
        paymentMethod: 'credit_card',
        paymentGateway: 'stripe',
        gatewayTransactionId: 'stripe_txn_123'
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processPayment(paymentData);

      expect(result.success).toBe(true);
      expect(result.paymentMethod).toBe('credit_card');
      expect(result.gatewayTransactionId).toBe('stripe_txn_123');
    });
  });

  describe('❌ Validaciones de Procesamiento de Pagos', () => {
    it('debería rechazar pago si usuario no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago si emisor no tiene saldo suficiente', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 150.00, // Más del saldo disponible
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Saldo insuficiente' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago con cantidad negativa', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: -25.50,
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El amount debe ser positivo' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago con cantidad cero', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 0,
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El amount debe ser mayor que cero' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago si usuarios son iguales', async () => {
      const paymentData = {
        fromUserId: mockUserId,
        toUserId: mockUserId, // Mismo usuario
        amount: 25.50,
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Emisor y receptor no pueden ser el mismo usuario' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago si excede límite diario', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 1000.00, // Excede límite diario
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Excede límite diario de transacciones' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería rechazar pago si usuarios no existen', async () => {
      const paymentData = {
        fromUserId: 'nonexistent-user',
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Usuario emisor no encontrado' } 
      });

      await expect(processPayment(paymentData)).rejects.toThrow();
    });
  });

  describe('✅ Reembolsos (refundPayment)', () => {
    it('debería procesar reembolso completo', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 25.50,
        reason: 'Cancelación de viaje',
        refundToUserId: mockPassengerId
      };

      const mockResult = {
        success: true,
        refundId: 'refund-123',
        status: 'completed',
        refundedAmount: 25.50,
        originalTransaction: mockTransactionId,
        refundedToBalance: 125.50, // 100 + 25.50
        processedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await refundPayment(refundData);

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('refund-123');
      expect(result.refundedAmount).toBe(25.50);
      expect(result.refundedToBalance).toBe(125.50);
    });

    it('debería procesar reembolso parcial', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 12.75, // 50% del original
        reason: 'Reembolso parcial',
        refundToUserId: mockPassengerId
      };

      const mockResult = {
        success: true,
        refundId: 'refund-partial',
        status: 'completed',
        refundedAmount: 12.75,
        originalAmount: 25.50,
        refundPercentage: 50,
        refundedToBalance: 112.75
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await refundPayment(refundData);

      expect(result.success).toBe(true);
      expect(result.refundedAmount).toBe(12.75);
      expect(result.refundPercentage).toBe(50);
    });

    it('debería procesar reembolso con penalización', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 20.00, // Menos del original por penalización
        reason: 'Cancelación última hora',
        refundToUserId: mockPassengerId,
        penaltyAmount: 5.50
      };

      const mockResult = {
        success: true,
        refundId: 'refund-penalty',
        status: 'completed',
        originalAmount: 25.50,
        refundedAmount: 20.00,
        penaltyAmount: 5.50,
        refundedToBalance: 120.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await refundPayment(refundData);

      expect(result.success).toBe(true);
      expect(result.penaltyAmount).toBe(5.50);
      expect(result.refundedAmount).toBe(20.00);
    });

    it('debería procesar reembolso múltiples pasajeros', async () => {
      const refundData = {
        rideId: mockRideId,
        refundAmounts: {
          [mockPassengerId]: 25.50,
          'passenger-2': 25.50,
          'passenger-3': 25.50
        },
        reason: 'Cancelación por conductor'
      };

      const mockResult = {
        success: true,
        batchRefundId: 'batch-refund-123',
        refunds: [
          { userId: mockPassengerId, refundId: 'refund-1', amount: 25.50 },
          { userId: 'passenger-2', refundId: 'refund-2', amount: 25.50 },
          { userId: 'passenger-3', refundId: 'refund-3', amount: 25.50 }
        ],
        totalRefunded: 76.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await refundPayment(refundData);

      expect(result.success).toBe(true);
      expect(result.refunds).toHaveLength(3);
      expect(result.totalRefunded).toBe(76.50);
    });
  });

  describe('❌ Validaciones de Reembolsos', () => {
    it('debería rechazar reembolso si transacción original no existe', async () => {
      const refundData = {
        originalTransactionId: 'nonexistent-txn',
        refundAmount: 25.50,
        reason: 'Test'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Transacción original no encontrada' } 
      });

      await expect(refundPayment(refundData)).rejects.toThrow();
    });

    it('debería rechazar reembolso si ya fue procesado', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 25.50,
        reason: 'Test'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Esta transacción ya fue reembolsada' } 
      });

      await expect(refundPayment(refundData)).rejects.toThrow();
    });

    it('debería rechazar reembolso si excede amount original', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 30.00, // Más que el original
        reason: 'Test'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El reembolso no puede exceder el amount original' } 
      });

      await expect(refundPayment(refundData)).rejects.toThrow();
    });

    it('debería rechazar reembolso si ha expirado el tiempo', async () => {
      const refundData = {
        originalTransactionId: mockTransactionId,
        refundAmount: 25.50,
        reason: 'Test'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Tiempo de reembolso expirado (máximo 30 días)' } 
      });

      await expect(refundPayment(refundData)).rejects.toThrow();
    });
  });

  describe('✅ Gestión de Wallets', () => {
    it('debería obtener balance de wallet', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockWallet, error: null })
          })
        })
      });

      const balance = await getWalletBalance(mockUserId);

      expect(balance).toBe(100.00);
    });

    it('debería añadir fondos a wallet', async () => {
      const addFundsData = {
        userId: mockUserId,
        amount: 50.00,
        method: 'credit_card',
        description: 'Recarga de saldo'
      };

      const mockResult = {
        success: true,
        transactionId: 'add-funds-123',
        previousBalance: 100.00,
        newBalance: 150.00,
        amountAdded: 50.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await addFunds(addFundsData);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(150.00);
      expect(result.amountAdded).toBe(50.00);
    });

    it('debería retirar fondos de wallet', async () => {
      const withdrawFundsData = {
        userId: mockUserId,
        amount: 30.00,
        method: 'bank_transfer',
        destinationAccount: 'ES1234567890123456789012345'
      };

      const mockResult = {
        success: true,
        transactionId: 'withdraw-123',
        previousBalance: 100.00,
        newBalance: 70.00,
        amountWithdrawn: 30.00,
        estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await withdrawFunds(withdrawFundsData);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(70.00);
      expect(result.amountWithdrawn).toBe(30.00);
    });

    it('debería obtener historial de transacciones', async () => {
      const mockTransactions = [
        mockTransaction,
        { ...mockTransaction, id: 'txn-2', amount: 15.00, type: 'refund' },
        { ...mockTransaction, id: 'txn-3', amount: 50.00, type: 'add_funds' }
      ];

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  then: vi.fn().mockResolvedValue({ data: mockTransactions, error: null })
                })
              })
            })
          })
        })
      });

      const history = await getTransactionHistory(mockUserId, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(history).toHaveLength(3);
      expect(history[0].type).toBe('payment');
      expect(history[1].type).toBe('refund');
      expect(history[2].type).toBe('add_funds');
    });
  });

  describe('❌ Validaciones de Wallet', () => {
    it('debería rechazar añadir fondos con método inválido', async () => {
      const addFundsData = {
        userId: mockUserId,
        amount: 50.00,
        method: 'invalid_method',
        description: 'Test'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Método de pago no válido' } 
      });

      await expect(addFunds(addFundsData)).rejects.toThrow();
    });

    it('debería rechazar retirar fondos si balance insuficiente', async () => {
      const withdrawFundsData = {
        userId: mockUserId,
        amount: 150.00, // Más del balance
        method: 'bank_transfer'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Balance insuficiente para retiro' } 
      });

      await expect(withdrawFunds(withdrawFundsData)).rejects.toThrow();
    });

    it('debería rechazar retirar fondos si excede límite diario', async () => {
      const withdrawFundsData = {
        userId: mockUserId,
        amount: 500.00, // Excede límite diario
        method: 'bank_transfer'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Excede límite diario de retiro' } 
      });

      await expect(withdrawFunds(withdrawFundsData)).rejects.toThrow();
    });

    it('debería rechazar añadir fondos con amount negativo', async () => {
      const addFundsData = {
        userId: mockUserId,
        amount: -10.00,
        method: 'credit_card'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El amount debe ser positivo' } 
      });

      await expect(addFunds(addFundsData)).rejects.toThrow();
    });
  });

  describe('✅ Validación de Pagos (validatePayment)', () => {
    it('debería validar pago correctamente', async () => {
      const validationData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId
      };

      const mockResult = {
        valid: true,
        canPay: true,
        currentBalance: 100.00,
        remainingBalance: 74.50,
        dailyLimit: 500.00,
        dailyUsed: 25.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePayment(validationData);

      expect(result.valid).toBe(true);
      expect(result.canPay).toBe(true);
      expect(result.remainingBalance).toBe(74.50);
    });

    it('debería detectar insuficiencia de fondos', async () => {
      const validationData = {
        userId: mockPassengerId,
        amount: 150.00, // Más del balance
        rideId: mockRideId
      };

      const mockResult = {
        valid: false,
        canPay: false,
        currentBalance: 100.00,
        required: 150.00,
        shortfall: 50.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePayment(validationData);

      expect(result.valid).toBe(false);
      expect(result.canPay).toBe(false);
      expect(result.shortfall).toBe(50.00);
    });

    it('debería detectar límite diario excedido', async () => {
      const validationData = {
        userId: mockPassengerId,
        amount: 100.00,
        rideId: mockRideId
      };

      const mockResult = {
        valid: false,
        canPay: false,
        dailyLimit: 500.00,
        dailyUsed: 450.00,
        remainingDaily: 50.00,
        required: 100.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePayment(validationData);

      expect(result.valid).toBe(false);
      expect(result.remainingDaily).toBe(50.00);
    });
  });

  describe('✅ Procesamiento Batch de Pagos', () => {
    it('debería procesar múltiples pagos en batch', async () => {
      const batchData = {
        payments: [
          { fromUserId: 'p1', toUserId: mockDriverId, amount: 25.50 },
          { fromUserId: 'p2', toUserId: mockDriverId, amount: 25.50 },
          { fromUserId: 'p3', toUserId: mockDriverId, amount: 25.50 }
        ],
        rideId: mockRideId
      };

      const mockResult = {
        success: true,
        batchId: 'batch-123',
        processed: 3,
        failed: 0,
        totalAmount: 76.50,
        transactions: [
          { paymentIndex: 0, success: true, transactionId: 'txn-1' },
          { paymentIndex: 1, success: true, transactionId: 'txn-2' },
          { paymentIndex: 2, success: true, transactionId: 'txn-3' }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processBatchPayments(batchData);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.totalAmount).toBe(76.50);
    });

    it('debería manejar pagos fallidos en batch', async () => {
      const batchData = {
        payments: [
          { fromUserId: 'p1', toUserId: mockDriverId, amount: 25.50 },
          { fromUserId: 'p2', toUserId: mockDriverId, amount: 25.50 },
          { fromUserId: 'p3', toUserId: mockDriverId, amount: 25.50 }
        ],
        rideId: mockRideId
      };

      const mockResult = {
        success: true,
        batchId: 'batch-124',
        processed: 2,
        failed: 1,
        totalAmount: 51.00,
        transactions: [
          { paymentIndex: 0, success: true, transactionId: 'txn-1' },
          { paymentIndex: 1, success: false, error: 'Saldo insuficiente' },
          { paymentIndex: 2, success: true, transactionId: 'txn-3' }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processBatchPayments(batchData);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.totalAmount).toBe(51.00);
    });
  });

  describe('🔄 Tests de Concurrencia', () => {
    it('debería manejar pagos simultáneos sin conflicto', async () => {
      const promises = [];
      
      // Simular 10 pagos simultáneos de diferentes usuarios
      for (let i = 0; i < 10; i++) {
        const paymentData = {
          fromUserId: `user-${i}`,
          toUserId: mockDriverId,
          amount: 25.50,
          rideId: `ride-${i}`
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, transactionId: `txn-${i}` }, 
          error: null 
        });
        
        promises.push(processPayment(paymentData));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('debería prevenir doble cargo del mismo pago', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      // Primer pago exitoso
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, transactionId: 'txn-unique' }, 
        error: null 
      });

      // Segundo pago rechazado por duplicado
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Pago duplicado detectado' } 
      });

      const result1 = await processPayment(paymentData);
      const result2 = await processPayment(paymentData);

      expect(result1.success).toBe(true);
      await expect(result2).rejects.toThrow();
    });

    it('debería manejar actualizaciones concurrentes de balance', async () => {
      const promises = [];
      
      // Simular 5 operaciones simultáneas sobre el mismo usuario
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) {
          // Operaciones de añadir fondos
          supabase.rpc.mockResolvedValue({ 
            data: { success: true, newBalance: 100 + (i + 1) * 10 }, 
            error: null 
          });
          promises.push(addFunds({ userId: mockUserId, amount: 10, method: 'credit_card' }));
        } else {
          // Operaciones de pago
          supabase.rpc.mockResolvedValue({ 
            data: { success: true, newBalance: 100 - (i + 1) * 5 }, 
            error: null 
          });
          promises.push(processPayment({
            fromUserId: mockUserId,
            toUserId: 'other-user',
            amount: 5,
            rideId: `ride-${i}`
          }));
        }
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('🔧 Manejo de Errores', () => {
    it('debería manejar error de conexión en procesamiento de pago', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      await expect(processPayment(paymentData)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar error de gateway de pago', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error en gateway de pago: Tarjeta rechazada' } 
      });

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId,
        paymentMethod: 'credit_card'
      };

      await expect(processPayment(paymentData)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en pagos' } 
      });

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      await expect(processPayment(paymentData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Payment Service]'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería procesar pago simple en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { success: true, transactionId: 'txn-perf' }, 
        error: null 
      });

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      await processPayment(paymentData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(2000); // Menos de 2 segundos
    });

    it('debería procesar batch de pagos eficientemente', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 50 pagos en batch
      for (let i = 0; i < 50; i++) {
        const batchData = {
          payments: [
            { fromUserId: `p${i}-1`, toUserId: `d${i}`, amount: 25.50 },
            { fromUserId: `p${i}-2`, toUserId: `d${i}`, amount: 25.50 }
          ],
          rideId: `ride-${i}`
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, batchId: `batch-${i}`, processed: 2, failed: 0 }, 
          error: null 
        });
        
        promises.push(processBatchPayments(batchData));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(8000); // Menos de 8 segundos para 100 pagos
    });
  });
});

export default {};
