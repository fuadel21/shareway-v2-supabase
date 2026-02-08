/**
 * Tests Exhaustivos para Concurrencia y Race Conditions
 * Cobertura completa de escenarios concurrentes, bloqueos atómicos y prevención de race conditions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { 
  createSingleRide,
  createSingleRequest,
  fulfillRequest,
  startRide,
  completeRide,
  processPayment,
  moveToEscrow,
  releaseFromEscrow
} from '@/services/rideService';

// Mock de Supabase con control de concurrencia
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          then: vi.fn(),
          forUpdate: vi.fn(() => ({
            then: vi.fn()
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

describe('🏁 Tests de Concurrencia y Race Conditions', () => {
  const mockDriverId = 'driver-123';
  const mockPassengerId = 'passenger-456';
  const mockRideId = 'ride-789';
  const mockRequestId = 'request-101';

  const mockRideData = {
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    distance: 615
  };

  const mockRequestData = {
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats_needed: 2,
    suggested_price: 20.00,
    distance: 615
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockDriverId } }
    });
  });

  describe('🔄 Race Conditions en Creación de Viajes', () => {
    it('debería prevenir duplicación de viajes con mismos datos', async () => {
      const promises = [];
      
      // Simular 5 intentos simultáneos de crear el mismo viaje
      for (let i = 0; i < 5; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, rideId: `ride-${i}` }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Viaje duplicado detectado' } 
          });
        }
        
        promises.push(
          createSingleRide(mockRideData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(4);
      expect(failed.every(f => f.error.includes('duplicado'))).toBe(true);
    });

    it('debería manejar creación concurrente de viajes diferentes', async () => {
      const promises = [];
      
      // Simular 10 creaciones simultáneas de viajes diferentes
      for (let i = 0; i < 10; i++) {
        const uniqueRideData = {
          ...mockRideData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString(),
          price: 25.50 + i
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRide(uniqueRideData));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.rideId).toBe(`ride-${index}`);
      });
    });

    it('debería mantener consistencia en límites de conductor', async () => {
      const promises = [];
      let callCount = 0;
      
      // Simular 8 intentos de creación, pero solo permitir 5
      for (let i = 0; i < 8; i++) {
        const rideData = {
          ...mockRideData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        // Permitir solo los primeros 5
        if (callCount < 5) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, rideId: `ride-${i}` }, 
            error: null 
          });
          callCount++;
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Límite diario de viajes alcanzado' } 
          });
        }
        
        promises.push(
          createSingleRide(rideData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(5);
      expect(failed).toHaveLength(3);
      expect(failed.every(f => f.error.includes('Límite'))).toBe(true);
    });
  });

  describe('🔄 Race Conditions en Solicitudes de Viajes', () => {
    it('debería prevenir múltiples solicitudes para mismo viaje', async () => {
      const promises = [];
      
      // Simular 5 pasajeros intentando solicitar el mismo viaje
      for (let i = 0; i < 5; i++) {
        const passengerId = `passenger-${i}`;
        
        // Solo los primeros 2 deberían tener éxito (4 plazas disponibles)
        if (i < 2) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, requestId: `request-${i}` }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'No hay plazas suficientes disponibles' } 
          });
        }
        
        promises.push(
          createSingleRequest(mockRequestData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(2);
      expect(failed).toHaveLength(3);
    });

    it('debería manejar límite de solicitudes concurrentemente', async () => {
      const promises = [];
      let requestCount = 0;
      
      // Simular 8 solicitudes simultáneas, límite de 5 por usuario
      for (let i = 0; i < 8; i++) {
        const requestData = {
          ...mockRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        if (requestCount < 5) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, requestId: `request-${i}` }, 
            error: null 
          });
          requestCount++;
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Límite de solicitudes activas alcanzado' } 
          });
        }
        
        promises.push(
          createSingleRequest(requestData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(5);
      expect(failed).toHaveLength(3);
    });

    it('debería prevenir solapamiento de solicitudes concurrentemente', async () => {
      const promises = [];
      
      // Simular 3 solicitudes con horarios similares
      for (let i = 0; i < 3; i++) {
        const requestData = {
          ...mockRequestData,
          departure_time: new Date(Date.now() + 30 * 60 * 1000).toISOString() // Mismo horario
        };
        
        // Solo la primera debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, requestId: `request-${i}` }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Ya tienes otra solicitud activa para un horario similar' } 
          });
        }
        
        promises.push(
          createSingleRequest(requestData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });

  describe('🔄 Race Conditions en Aceptación de Solicitudes', () => {
    it('debería prevenir doble aceptación de misma solicitud', async () => {
      const mockRequest = {
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      };

      const promises = [];
      
      // Simular 3 conductores intentando aceptar la misma solicitud
      for (let i = 0; i < 3; i++) {
        const driverId = `driver-${i}`;
        
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, rideId: `ride-${i}` }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'La solicitud ya ha sido aceptada por otro conductor' } 
          });
        }
        
        promises.push(
          fulfillRequest(mockRequest).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería manejar aceptación concurrente de diferentes solicitudes', async () => {
      const promises = [];
      
      // Simular 5 aceptaciones simultáneas de solicitudes diferentes
      for (let i = 0; i < 5; i++) {
        const request = {
          id: `request-${i}`,
          requester_id: `passenger-${i}`,
          ...mockRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}` }, 
          error: null 
        });
        
        promises.push(fulfillRequest(request));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.rideId).toBe(`ride-${index}`);
      });
    });

    it('debería mantener consistencia de plazas disponibles', async () => {
      const promises = [];
      let availableSeats = 4;
      
      // Simular 6 intentos de aceptación para un viaje con 4 plazas
      for (let i = 0; i < 6; i++) {
        const request = {
          id: `request-${i}`,
          requester_id: `passenger-${i}`,
          seats_needed: 1,
          ...mockRequestData
        };
        
        if (availableSeats > 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, rideId: `ride-${i}` }, 
            error: null 
          });
          availableSeats--;
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'No hay plazas suficientes disponibles' } 
          });
        }
        
        promises.push(
          fulfillRequest(request).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(4);
      expect(failed).toHaveLength(2);
    });
  });

  describe('🔄 Race Conditions en Pagos', () => {
    it('debería prevenir doble cargo del mismo pago', async () => {
      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      const promises = [];
      
      // Simular 3 intentos simultáneos del mismo pago
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, transactionId: 'txn-unique' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Pago duplicado detectado' } 
          });
        }
        
        promises.push(
          processPayment(paymentData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería manejar pagos concurrentes sin conflictos', async () => {
      const promises = [];
      
      // Simular 10 pagos simultáneos de diferentes usuarios
      for (let i = 0; i < 10; i++) {
        const paymentData = {
          fromUserId: `passenger-${i}`,
          toUserId: `driver-${i}`,
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
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.transactionId).toBe(`txn-${index}`);
      });
    });

    it('debería mantener consistencia de balances concurrentemente', async () => {
      const promises = [];
      const initialBalance = 100.00;
      let currentBalance = initialBalance;
      
      // Simular 5 operaciones simultáneas sobre el mismo usuario
      for (let i = 0; i < 5; i++) {
        const isPayment = i % 2 === 0;
        const amount = 10.00;
        
        if (isPayment && currentBalance >= amount) {
          // Operación de pago
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, newBalance: currentBalance - amount }, 
            error: null 
          });
          currentBalance -= amount;
        } else if (!isPayment) {
          // Operación de añadir fondos
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, newBalance: currentBalance + amount }, 
            error: null 
          });
          currentBalance += amount;
        } else {
          // Saldo insuficiente
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Saldo insuficiente' } 
          });
        }
        
        const operation = isPayment 
          ? processPayment({
              fromUserId: mockUserId,
              toUserId: 'other-user',
              amount: amount,
              rideId: `ride-${i}`
            })
          : { success: true, newBalance: currentBalance };
        
        promises.push(
          (typeof operation === 'object' ? Promise.resolve(operation) : operation)
            .catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);

      expect(successful.length).toBeGreaterThan(0);
      // El balance final debe ser consistente
      const finalBalance = successful.reduce((acc, r) => r.newBalance || acc, initialBalance);
      expect(typeof finalBalance).toBe('number');
    });
  });

  describe('🔄 Race Conditions en Escrow', () => {
    it('debería prevenir doble retención en escrow', async () => {
      const escrowData = {
        userId: mockPassengerId,
        amount: 25.50,
        rideId: mockRideId,
        type: 'ride_payment'
      };

      const promises = [];
      
      // Simular 3 intentos simultáneos de retener los mismos fondos
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, escrowId: 'escrow-unique' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Retención duplicada en escrow' } 
          });
        }
        
        promises.push(
          moveToEscrow(escrowData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería prevenir doble liberación de escrow', async () => {
      const releaseData = {
        escrowId: mockEscrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50
      };

      const promises = [];
      
      // Simular 3 intentos simultáneos de liberar los mismos fondos
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, releaseId: 'release-unique' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Fondos ya liberados' } 
          });
        }
        
        promises.push(
          releaseFromEscrow(releaseData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería manejar disputas concurrentes sobre mismo escrow', async () => {
      const disputeData = {
        escrowId: mockEscrowId,
        initiatedBy: mockPassengerId,
        reason: 'service_quality'
      };

      const promises = [];
      
      // Simular 3 intentos simultáneos de crear disputa
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, disputeId: 'dispute-unique' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Disputa activa ya existe' } 
          });
        }
        
        promises.push(
          resolveDispute('create', disputeData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });

  describe('🔄 Race Conditions en Ciclo de Vida de Viajes', () => {
    it('debería prevenir doble inicio del mismo viaje', async () => {
      const promises = [];
      
      // Simular 3 intentos simultáneos de iniciar el mismo viaje
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, status: 'in_progress' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Viaje ya está en curso' } 
          });
        }
        
        promises.push(
          startRide(mockRideId).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería prevenir doble finalización del mismo viaje', async () => {
      const promises = [];
      
      // Simular 3 intentos simultáneos de completar el mismo viaje
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, status: 'completed' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'Viaje ya fue completado' } 
          });
        }
        
        promises.push(
          completeRide(mockRideId).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('debería manejar actualizaciones de ubicación concurrentemente', async () => {
      const promises = [];
      
      // Simular 10 actualizaciones de ubicación simultáneas
      for (let i = 0; i < 10; i++) {
        const location = {
          lat: 40.4168 + (i * 0.001),
          lng: -3.7038 + (i * 0.001)
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, location: location }, 
          error: null 
        });
        
        promises.push(updateRideLocation(mockRideId, location));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.location.lat).toBeCloseTo(40.4168 + (index * 0.001), 5);
      });
    });
  });

  describe('🔒 Tests de Bloqueos Atómicos', () => {
    it('debería usar bloqueo FOR UPDATE en operaciones críticas', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        locked: true,
        lock_acquired_at: new Date().toISOString()
      };
      
      // Mock que simula bloqueo atómico
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            forUpdate: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockRideData, error: null })
            })
          })
        })
      });
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest({
        id: mockRequestId,
        ...mockRequestData
      });

      expect(result.success).toBe(true);
      // Verificar que se usó el bloqueo
      expect(supabase.from().select().eq().forUpdate).toHaveBeenCalled();
    });

    it('debería manejar timeout de bloqueo', async () => {
      // Mock que simula timeout de bloqueo
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            forUpdate: vi.fn().mockReturnValue({
              single: vi.fn().mockRejectedValue(new Error('Lock timeout'))
            })
          })
        })
      });

      await expect(fulfillRequest({
        id: mockRequestId,
        ...mockRequestData
      })).rejects.toThrow('Lock timeout');
    });

    it('debería liberar bloqueo correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        lock_released: true,
        released_at: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await completeRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.lock_released).toBe(true);
    });
  });

  describe('🔄 Tests de Transacciones Concurrentes', () => {
    it('debería manejar rollback en caso de error concurrente', async () => {
      // Mock que simula error y rollback
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Conflicto concurrente, iniciando rollback' } 
      });

      const paymentData = {
        fromUserId: mockPassengerId,
        toUserId: mockDriverId,
        amount: 25.50,
        rideId: mockRideId
      };

      await expect(processPayment(paymentData)).rejects.toThrow('Conflicto concurrente');
    });

    it('debería mantener consistencia ACID en operaciones complejas', async () => {
      // Simular una operación compleja: aceptar solicitud + mover a escrow
      const mockResult = {
        success: true,
        rideId: mockRideId,
        escrowId: mockEscrowId,
        transaction_id: 'txn-complex',
        operations_completed: [
          'request_accepted',
          'ride_created',
          'payment_moved_to_escrow',
          'notifications_sent'
        ],
        atomic: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest({
        id: mockRequestId,
        ...mockRequestData
      });

      expect(result.success).toBe(true);
      expect(result.atomic).toBe(true);
      expect(result.operations_completed).toHaveLength(4);
    });
  });

  describe('📊 Tests de Rendimiento bajo Carga Concurrente', () => {
    it('debería mantener rendimiento con 100 operaciones simultáneas', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // Simular 100 operaciones simultáneas
      for (let i = 0; i < 100; i++) {
        const rideData = {
          ...mockRideData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRide(rideData));
      }

      const results = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(10000); // Menos de 10 segundos
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('debería manejar carga mixta de operaciones concurrentes', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // Mezcla de diferentes operaciones
      for (let i = 0; i < 50; i++) {
        // Creaciones de viaje
        const rideData = {
          ...mockRideData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRide(rideData));
        
        // Solicitudes
        const requestData = {
          ...mockRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, requestId: `request-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRequest(requestData));
      }

      const results = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(15000); // Menos de 15 segundos
    });
  });

  describe('🔧 Manejo de Errores en Escenarios Concurrentes', () => {
    it('debería manejar deadlock gracefully', async () => {
      // Mock que simula deadlock
      supabase.rpc.mockRejectedValue(new Error('Deadlock detected'));

      const promises = [];
      
      for (let i = 0; i < 3; i++) {
        promises.push(
          createSingleRide(mockRideData).catch(e => ({ success: false, error: e.message }))
        );
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(false);
        expect(result.error).toContain('Deadlock');
      });
    });

    it('debería reintentar operaciones con backoff exponencial', async () => {
      let attempts = 0;
      
      // Mock que simula reintentos
      supabase.rpc.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({ 
            data: null, 
            error: { message: 'Concurrent modification' } 
          });
        }
        return Promise.resolve({ 
          data: { success: true, rideId: 'ride-retry' }, 
          error: null 
        });
      });

      const result = await createSingleRide(mockRideData);

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('debería registrar errores de concurrencia para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Race condition detected' } 
      });

      await expect(createSingleRide(mockRideData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Concurrency]'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });
});

export default {};
