/**
 * Tests Exhaustivos para Sistema de Escrow y Retenciones
 * Cobertura completa de retenciones, liberación de fondos, disputas y gestión de escrow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { 
  moveToEscrow,
  releaseFromEscrow,
  getEscrowBalance,
  processEscrowReleases,
  resolveDispute,
  getEscrowTransactions,
  holdEscrowFunds,
  validateEscrowRelease,
  getEscrowStatistics
} from '@/services/escrowService';

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
          }))
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

describe('🔒 Tests de Sistema de Escrow y Retenciones', () => {
  const mockUserId = 'user-123';
  const mockDriverId = 'driver-456';
  const mockPassengerId = 'passenger-789';
  const mockRideId = 'ride-101';
  const mockEscrowId = 'escrow-202';
  const mockDisputeId = 'dispute-303';

  const mockWallet = {
    user_id: mockUserId,
    balance: 100.00,
    escrow_balance: 25.50,
    currency: 'EUR',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mockEscrowTransaction = {
    id: mockEscrowId,
    user_id: mockUserId,
    amount: 25.50,
    type: 'ride_payment',
    status: 'held',
    ride_id: mockRideId,
    release_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString()
  };

  const mockDispute = {
    id: mockDisputeId,
    escrow_id: mockEscrowId,
    initiated_by: mockPassengerId,
    reason: 'service_quality',
    description: 'El conductor llegó tarde y el vehículo no estaba limpio',
    status: 'pending',
    evidence: ['photo1.jpg', 'photo2.jpg'],
    created_at: new Date().toISOString()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockUserId } }
    });
  });

  describe('✅ Movimiento a Escrow (moveToEscrow)', () => {
    it('debería mover fondos a escrow correctamente', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment',
        releaseDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };

      const mockResult = {
        success: true,
        escrowId: mockEscrowId,
        previousBalance: 100.00,
        newBalance: 74.50,
        escrowBalance: 25.50,
        heldAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await moveToEscrow(escrowData);

      expect(result.success).toBe(true);
      expect(result.escrowId).toBe(mockEscrowId);
      expect(result.newBalance).toBe(74.50);
      expect(result.escrowBalance).toBe(25.50);
      expect(supabase.rpc).toHaveBeenCalledWith('move_to_escrow', expect.objectContaining({
        p_user_id: mockPassengerId,
        p_amount: 25.50,
        p_ride_id: mockRideId,
        p_type: 'ride_payment'
      }));
    });

    it('debería mover fondos con fecha de liberación automática', async () => {
      const releaseDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 horas
      const escrowData = {
        userId: mockPassengerId,
        amount: 30.00,
        rideId: mockRideId,
        type: 'ride_payment',
        releaseDate: releaseDate.toISOString(),
        autoRelease: true
      };

      const mockResult = {
        success: true,
        escrowId: mockEscrowId,
        releaseDate: releaseDate.toISOString(),
        autoRelease: true,
        status: 'held'
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await moveToEscrow(escrowData);

      expect(result.success).toBe(true);
      expect(result.autoRelease).toBe(true);
      expect(new Date(result.releaseDate)).toEqual(releaseDate);
    });

    it('debería mover fondos con condiciones específicas', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment',
        conditions: {
          ride_completed: true,
          no_disputes: true,
          passenger_confirmed: true
        }
      };

      const mockResult = {
        success: true,
        escrowId: mockEscrowId,
        conditions: escrowData.conditions,
        status: 'held_pending_conditions'
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await moveToEscrow(escrowData);

      expect(result.success).toBe(true);
      expect(result.conditions).toEqual(escrowData.conditions);
    });

    it('debería manejar múltiples retenciones para el mismo viaje', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment',
        splitEscrow: [
          { amount: 20.00, recipient: mockDriverId, type: 'driver_payment' },
          { amount: 5.50, recipient: 'platform', type: 'platform_fee' }
        ]
      };

      const mockResult = {
        success: true,
        escrowId: mockEscrowId,
        splits: [
          { escrowId: 'escrow-driver', amount: 20.00, recipient: mockDriverId },
          { escrowId: 'escrow-platform', amount: 5.50, recipient: 'platform' }
        ],
        totalHeld: 25.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await moveToEscrow(escrowData);

      expect(result.success).toBe(true);
      expect(result.splits).toHaveLength(2);
      expect(result.totalHeld).toBe(25.50);
    });
  });

  describe('❌ Validaciones de Movimiento a Escrow', () => {
    it('debería rechazar si usuario no tiene saldo suficiente', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 150.00, // Más del balance
        rideId: mockRideId,
        type: 'ride_payment'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Saldo insuficiente para retención en escrow' } 
      });

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
    });

    it('debería rechazar si amount es negativo', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: -25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El amount de retención debe ser positivo' } 
      });

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
    });

    it('debería rechazar si fecha de liberación es inválida', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment',
        releaseDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // En el pasado
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La fecha de liberación debe ser futura' } 
      });

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
    });

    it('debería rechazar si usuario no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
    });

    it('debería rechazar si excede límite de retención', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 1000.00, // Excede límite
        rideId: mockRideId,
        type: 'ride_payment'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Excede límite máximo de retención en escrow' } 
      });

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
    });
  });

  describe('✅ Liberación de Escrow (releaseFromEscrow)', () => {
    it('debería liberar fondos de escrow correctamente', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50,
        reason: 'Viaje completado satisfactoriamente'
      };

      const mockResult = {
        success: true,
        releaseId: 'release-123',
        previousEscrowBalance: 25.50,
        newEscrowBalance: 0.00,
        recipientBalance: 125.50, // 100 + 25.50
        releasedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await releaseFromEscrow(releaseData);

      expect(result.success).toBe(true);
      expect(result.newEscrowBalance).toBe(0.00);
      expect(result.recipientBalance).toBe(125.50);
      expect(supabase.rpc).toHaveBeenCalledWith('release_from_escrow', expect.objectContaining({
        p_escrow_id: mockEscrowId,
        p_release_to_user_id: mockDriverId,
        p_amount: 25.50
      }));
    });

    it('debería liberar fondos parcialmente', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 20.00, // Liberación parcial
        reason: 'Liberación parcial por disputa resuelta'
      };

      const mockResult = {
        success: true,
        releaseId: 'release-partial',
        previousEscrowBalance: 25.50,
        newEscrowBalance: 5.50, // 25.50 - 20.00
        recipientBalance: 120.00,
        releasedAmount: 20.00,
        remainingEscrow: 5.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await releaseFromEscrow(releaseData);

      expect(result.success).toBe(true);
      expect(result.releasedAmount).toBe(20.00);
      expect(result.remainingEscrow).toBe(5.50);
    });

    it('debería liberar fondos con penalización', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 20.00, // Menos del original por penalización
        reason: 'Liberación con penalización',
        penaltyAmount: 5.50,
        penaltyReason: 'Llegada tarde'
      };

      const mockResult = {
        success: true,
        releaseId: 'release-penalty',
        originalAmount: 25.50,
        releasedAmount: 20.00,
        penaltyAmount: 5.50,
        penaltyReason: 'Llegada tarde',
        recipientBalance: 120.00,
        platformPenaltyBalance: 5.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await releaseFromEscrow(releaseData);

      expect(result.success).toBe(true);
      expect(result.penaltyAmount).toBe(5.50);
      expect(result.platformPenaltyBalance).toBe(5.50);
    });

    it('debería liberar fondos a múltiples destinatarios', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releases: [
          { userId: mockDriverId, amount: 20.00, reason: 'Pago conductor' },
          { userId: 'platform', amount: 5.50, reason: 'Comisión plataforma' }
        ]
      };

      const mockResult = {
        success: true,
        batchReleaseId: 'batch-release-123',
        releases: [
          { userId: mockDriverId, amount: 20.00, releaseId: 'release-1' },
          { userId: 'platform', amount: 5.50, releaseId: 'release-2' }
        ],
        totalReleased: 25.50,
        escrowBalance: 0.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await releaseFromEscrow(releaseData);

      expect(result.success).toBe(true);
      expect(result.releases).toHaveLength(2);
      expect(result.totalReleased).toBe(25.50);
    });
  });

  describe('❌ Validaciones de Liberación de Escrow', () => {
    it('debería rechazar liberación si escrow no existe', async () => {
      const releaseData = {
        escrowId: 'nonexistent-escrow',
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Retención en escrow no encontrada' } 
      });

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });

    it('debería rechazar liberación si ya fue liberada', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Los fondos ya fueron liberados' } 
      });

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });

    it('debería rechazar liberación si hay disputa activa', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'No se puede liberar fondos con disputa activa' } 
      });

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });

    it('debería rechazar liberación si excede amount retenido', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 30.00 // Más de lo retenido
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El amount de liberación excede los fondos retenidos' } 
      });

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });

    it('debería rechazar liberación si condiciones no cumplidas', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Condiciones para liberación no cumplidas' } 
      });

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });
  });

  describe('✅ Gestión de Disputas (resolveDispute)', () => {
    it('debería crear disputa correctamente', async () => {
      const disputeData = {
        escrowId: mockEscrowId,
        initiatedBy: mockPassengerId,
        reason: 'service_quality',
        description: 'El servicio no cumplió las expectativas',
        evidence: ['photo1.jpg', 'screenshot1.png'],
        requestedResolution: 'partial_refund'
      };

      const mockResult = {
        success: true,
        disputeId: mockDisputeId,
        escrowId: mockEscrowId,
        status: 'pending',
        initiatedAt: new Date().toISOString(),
        escrowFrozen: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await resolveDispute('create', disputeData);

      expect(result.success).toBe(true);
      expect(result.disputeId).toBe(mockDisputeId);
      expect(result.escrowFrozen).toBe(true);
    });

    it('debería resolver disputa a favor del pasajero', async () => {
      const resolutionData = {
        disputeId: mockDisputeId,
        resolution: 'passenger_favor',
        refundAmount: 15.00, // Reembolso parcial
        driverPenalty: 10.50,
        reason: 'Calidad del servicio deficiente'
      };

      const mockResult = {
        success: true,
        disputeId: mockDisputeId,
        status: 'resolved',
        resolution: 'passenger_favor',
        actions: [
          { type: 'refund', userId: mockPassengerId, amount: 15.00 },
          { type: 'penalty', userId: mockDriverId, amount: 10.50 }
        ],
        resolvedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await resolveDispute('resolve', resolutionData);

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('passenger_favor');
      expect(result.actions).toHaveLength(2);
    });

    it('debería resolver disputa a favor del conductor', async () => {
      const resolutionData = {
        disputeId: mockDisputeId,
        resolution: 'driver_favor',
        reason: 'Pasajero no presentó evidencia válida',
        fullRelease: true
      };

      const mockResult = {
        success: true,
        disputeId: mockDisputeId,
        status: 'resolved',
        resolution: 'driver_favor',
        actions: [
          { type: 'full_release', userId: mockDriverId, amount: 25.50 }
        ],
        resolvedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await resolveDispute('resolve', resolutionData);

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('driver_favor');
      expect(result.actions[0].type).toBe('full_release');
    });

    it('debería resolver disputa con compensación parcial', async () => {
      const resolutionData = {
        disputeId: mockDisputeId,
        resolution: 'compromise',
        passengerRefund: 12.75,
        driverPayment: 12.75,
        platformFee: 0.00, // La plataforma absorbe la comisión
        reason: 'Compromiso entre ambas partes'
      };

      const mockResult = {
        success: true,
        disputeId: mockDisputeId,
        status: 'resolved',
        resolution: 'compromise',
        actions: [
          { type: 'refund', userId: mockPassengerId, amount: 12.75 },
          { type: 'payment', userId: mockDriverId, amount: 12.75 }
        ],
        fairSplit: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await resolveDispute('resolve', resolutionData);

      expect(result.success).toBe(true);
      expect(result.fairSplit).toBe(true);
      expect(result.actions).toHaveLength(2);
    });
  });

  describe('✅ Procesamiento Automático de Escrow', () => {
    it('debería procesar liberaciones automáticas por fecha', async () => {
      const mockResult = {
        success: true,
        processed: 15,
        failed: 2,
        totalAmount: 382.50,
        releases: [
          { escrowId: 'escrow-1', amount: 25.50, released: true },
          { escrowId: 'escrow-2', amount: 30.00, released: true }
        ],
        failures: [
          { escrowId: 'escrow-3', error: 'Disputa activa' },
          { escrowId: 'escrow-4', error: 'Usuario no encontrado' }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await processEscrowReleases();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(15);
      expect(result.failed).toBe(2);
      expect(result.totalAmount).toBe(382.50);
    });

    it('debería validar condiciones de liberación automática', async () => {
      const validationData = {
        escrowId: mockEscrowId,
        autoRelease: true,
        conditions: {
          ride_completed: true,
          no_disputes: true,
          time_elapsed: true
        }
      };

      const mockResult = {
        valid: true,
        canRelease: true,
        conditionsMet: validationData.conditions,
        releaseAmount: 25.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateEscrowRelease(validationData);

      expect(result.valid).toBe(true);
      expect(result.canRelease).toBe(true);
      expect(result.conditionsMet).toEqual(validationData.conditions);
    });

    it('debería rechazar liberación automática si hay disputa', async () => {
      const validationData = {
        escrowId: mockEscrowId,
        autoRelease: true
      };

      const mockResult = {
        valid: false,
        canRelease: false,
        reason: 'Disputa activa',
        disputeId: mockDisputeId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateEscrowRelease(validationData);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Disputa activa');
    });
  });

  describe('✅ Consultas y Reportes de Escrow', () => {
    it('debería obtener balance de escrow', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockWallet, error: null })
          })
        })
      });

      const balance = await getEscrowBalance(mockUserId);

      expect(balance).toBe(25.50);
    });

    it('debería obtener historial de transacciones de escrow', async () => {
      const mockTransactions = [
        mockEscrowTransaction,
        { ...mockEscrowTransaction, id: 'escrow-2', amount: 30.00, status: 'released' },
        { ...mockEscrowTransaction, id: 'escrow-3', amount: 15.00, status: 'disputed' }
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

      const history = await getEscrowTransactions(mockUserId, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(history).toHaveLength(3);
      expect(history[0].status).toBe('held');
      expect(history[1].status).toBe('released');
      expect(history[2].status).toBe('disputed');
    });

    it('debería obtener estadísticas de escrow', async () => {
      const mockStats = {
        totalHeld: 1250.75,
        totalReleased: 8750.50,
        totalDisputed: 125.00,
        activeDisputes: 3,
        pendingReleases: 8,
        averageHoldTime: 18.5, // horas
        successRate: 94.5 // porcentaje
      };

      supabase.rpc.mockResolvedValue({ data: mockStats, error: null });

      const stats = await getEscrowStatistics();

      expect(stats.totalHeld).toBe(1250.75);
      expect(stats.totalReleased).toBe(8750.50);
      expect(stats.successRate).toBe(94.5);
    });
  });

  describe('🔄 Tests de Concurrencia en Escrow', () => {
    it('debería manejar múltiples retenciones simultáneas', async () => {
      const promises = [];
      
      // Simular 10 retenciones simultáneas
      for (let i = 0; i < 10; i++) {
        const escrowData = {
          userId: `user-${i}`,
          amount: 25.50,
          rideId: `ride-${i}`,
          type: 'ride_payment'
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, escrowId: `escrow-${i}` }, 
          error: null 
        });
        
        promises.push(moveToEscrow(escrowData));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('debería prevenir doble liberación de fondos', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      // Primera liberación exitosa
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, releaseId: 'release-unique' }, 
        error: null 
      });

      // Segunda liberación rechazada
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Los fondos ya fueron liberados' } 
      });

      const result1 = await releaseFromEscrow(releaseData);
      const result2 = await releaseFromEscrow(releaseData);

      expect(result1.success).toBe(true);
      await expect(result2).rejects.toThrow();
    });

    it('debería manejar disputas concurrentes sobre mismo escrow', async () => {
      const disputeData = {
        escrowId: mockEscrowId,
        initiatedBy: mockPassengerId,
        reason: 'service_quality'
      };

      // Primera disputa creada exitosamente
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, disputeId: 'dispute-1' }, 
        error: null 
      });

      // Segunda disputa rechazada por duplicado
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Ya existe una disputa activa para esta retención' } 
      });

      const result1 = await resolveDispute('create', disputeData);
      const result2 = await resolveDispute('create', disputeData);

      expect(result1.success).toBe(true);
      await expect(result2).rejects.toThrow();
    });
  });

  describe('🔧 Manejo de Errores en Escrow', () => {
    it('debería manejar error de conexión en movimiento a escrow', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      await expect(moveToEscrow(escrowData)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar error de validación en liberación', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de validación: Condiciones no cumplidas' } 
      });

      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      await expect(releaseFromEscrow(releaseData)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en escrow' } 
      });

      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      await expect(moveToEscrow(escrowData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Escrow Service]'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento de Escrow', () => {
    it('debería procesar retención en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { success: true, escrowId: 'escrow-perf' }, 
        error: null 
      });

      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      await moveToEscrow(escrowData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1500); // Menos de 1.5 segundos
    });

    it('debería procesar batch de liberaciones eficientemente', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 50 liberaciones simultáneas
      for (let i = 0; i < 50; i++) {
        const releaseData = {
          escrowId: `escrow-${i}`,
          releaseToUserId: `driver-${i}`,
          amount: 25.50
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, releaseId: `release-${i}` }, 
          error: null 
        });
        
        promises.push(releaseFromEscrow(releaseData));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(6000); // Menos de 6 segundos para 50 liberaciones
    });
  });
});

export default {};
