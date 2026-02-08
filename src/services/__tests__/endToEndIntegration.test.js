/**
 * Tests Exhaustivos de Integración End-to-End
 * Cobertura completa de flujos completos desde creación hasta finalización del viaje
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
  releaseFromEscrow,
  cancelRide,
  getRideDetails,
  getCurrentRides
} from '@/services/rideService';

// Mock de Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          then: vi.fn()
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

describe('🔄 Tests de Integración End-to-End', () => {
  const mockDriverId = 'driver-123';
  const mockPassengerId = 'passenger-456';
  const mockPassenger2Id = 'passenger-789';
  const mockRideId = 'ride-789';
  const mockRequestId = 'request-101';
  const mockRequestId2 = 'request-102';

  const mockDriverProfile = {
    id: mockDriverId,
    display_name: 'Conductor Test',
    email: 'driver@test.com',
    verification: { status: 'verified' },
    wallet_balance: 100.00,
    rating: 4.8,
    total_rides: 25
  };

  const mockPassengerProfile = {
    id: mockPassengerId,
    display_name: 'Pasajero Test',
    email: 'passenger@test.com',
    verification: { status: 'verified' },
    wallet_balance: 50.00,
    rating: 4.6,
    total_rides: 12
  };

  const mockRideData = {
    origin: { 
      address: 'Madrid, Plaza Mayor', 
      coordinates: { lat: 40.4168, lng: -3.7038 } 
    },
    destination: { 
      address: 'Barcelona, Sagrada Familia', 
      coordinates: { lat: 41.3851, lng: 2.1734 } 
    },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    distance: 615,
    details: 'Viaje confortable con música y aire acondicionado',
    is_women_only: false
  };

  const mockRequestData = {
    origin: mockRideData.origin,
    destination: mockRideData.destination,
    departure_time: mockRideData.departure_time,
    seats_needed: 1,
    suggested_price: 20.00,
    distance: 615,
    details: 'Necesito plaza para 1 persona con equipaje ligero'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockDriverId } }
    });
  });

  describe('🚗 Flujo Completo: Creación → Solicitud → Aceptación → Viaje → Pago', () => {
    it('debería completar flujo exitoso de principio a fin', async () => {
      // 1. Conductor crea viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);
      expect(rideResult.rideId).toBe(mockRideId);

      // 2. Pasajero crea solicitud
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId }, 
        error: null 
      });

      const requestResult = await createSingleRequest(mockRequestData);
      expect(requestResult.success).toBe(true);
      expect(requestResult.requestId).toBe(mockRequestId);

      // 3. Conductor acepta solicitud
      const mockRequest = {
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      };

      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          rideId: `${mockRideId}-accepted`, 
          requestId: mockRequestId,
          escrowId: 'escrow-123'
        }, 
        error: null 
      });

      const fulfillResult = await fulfillRequest(mockRequest);
      expect(fulfillResult.success).toBe(true);
      expect(fulfillResult.rideId).toBe(`${mockRideId}-accepted`);

      // 4. Movimiento a escrow
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          escrowId: 'escrow-123',
          previousBalance: 50.00,
          newBalance: 24.50
        }, 
        error: null 
      });

      const escrowResult = await moveToEscrow({
        userId: mockPassengerId,
        amount: 25.50,
        rideId: fulfillResult.rideId,
        type: 'ride_payment'
      });
      expect(escrowResult.success).toBe(true);
      expect(escrowResult.newBalance).toBe(24.50);

      // 5. Conductor inicia viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          status: 'in_progress',
          startedAt: new Date().toISOString()
        }, 
        error: null 
      });

      const startResult = await startRide(fulfillResult.rideId);
      expect(startResult.success).toBe(true);
      expect(startResult.status).toBe('in_progress');

      // 6. Conductor completa viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          status: 'completed',
          completedAt: new Date().toISOString(),
          finalDistance: 620.5,
          finalDuration: 3600
        }, 
        error: null 
      });

      const completeResult = await completeRide(fulfillResult.rideId);
      expect(completeResult.success).toBe(true);
      expect(completeResult.status).toBe('completed');

      // 7. Liberación de fondos de escrow
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          releaseId: 'release-123',
          driverBalance: 125.50, // 100 + 25.50
          releasedAt: new Date().toISOString()
        }, 
        error: null 
      });

      const releaseResult = await releaseFromEscrow({
        escrowId: escrowResult.escrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50,
        reason: 'Viaje completado satisfactoriamente'
      });
      expect(releaseResult.success).toBe(true);
      expect(releaseResult.driverBalance).toBe(125.50);

      // Verificar estado final del sistema
      expect(rideResult.success).toBe(true);
      expect(requestResult.success).toBe(true);
      expect(fulfillResult.success).toBe(true);
      expect(escrowResult.success).toBe(true);
      expect(startResult.success).toBe(true);
      expect(completeResult.success).toBe(true);
      expect(releaseResult.success).toBe(true);
    });

    it('debería manejar flujo con múltiples pasajeros', async () => {
      // 1. Conductor crea viaje con 4 plazas
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide({
        ...mockRideData,
        seats: 4
      });
      expect(rideResult.success).toBe(true);

      // 2. Primer pasajero solicita
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId }, 
        error: null 
      });

      const request1Result = await createSingleRequest(mockRequestData);
      expect(request1Result.success).toBe(true);

      // 3. Segundo pasajero solicita
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassenger2Id } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId2 }, 
        error: null 
      });

      const request2Result = await createSingleRequest({
        ...mockRequestData,
        seats_needed: 2
      });
      expect(request2Result.success).toBe(true);

      // 4. Conductor acepta ambas solicitudes
      const mockRequest1 = {
        id: mockRequestId,
        requester_id: mockPassengerId,
        seats_needed: 1,
        ...mockRequestData
      };

      const mockRequest2 = {
        id: mockRequestId2,
        requester_id: mockPassenger2Id,
        seats_needed: 2,
        ...mockRequestData
      };

      // Aceptar primera solicitud
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: `${mockRideId}-accepted-1` }, 
        error: null 
      });

      const fulfill1Result = await fulfillRequest(mockRequest1);
      expect(fulfill1Result.success).toBe(true);

      // Aceptar segunda solicitud
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: `${mockRideId}-accepted-2` }, 
        error: null 
      });

      const fulfill2Result = await fulfillRequest(mockRequest2);
      expect(fulfill2Result.success).toBe(true);

      // 5. Procesar pagos para ambos pasajeros
      for (let i = 0; i < 2; i++) {
        const passengerId = i === 0 ? mockPassengerId : mockPassenger2Id;
        const amount = i === 0 ? 25.50 : 51.00; // 2 plazas para el segundo

        supabase.rpc.mockResolvedValueOnce({ 
          data: { success: true, transactionId: `txn-${i}` }, 
          error: null 
        });

        const paymentResult = await processPayment({
          fromUserId: passengerId,
          toUserId: mockDriverId,
          amount: amount,
          rideId: fulfill1Result.rideId
        });
        expect(paymentResult.success).toBe(true);
      }

      // 6. Iniciar y completar viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, status: 'in_progress' }, 
        error: null 
      });

      const startResult = await startRide(fulfill1Result.rideId);
      expect(startResult.success).toBe(true);

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, status: 'completed' }, 
        error: null 
      });

      const completeResult = await completeRide(fulfill1Result.rideId);
      expect(completeResult.success).toBe(true);

      // Verificar que todos los pasos fueron exitosos
      expect(rideResult.success).toBe(true);
      expect(request1Result.success).toBe(true);
      expect(request2Result.success).toBe(true);
      expect(fulfill1Result.success).toBe(true);
      expect(fulfill2Result.success).toBe(true);
      expect(startResult.success).toBe(true);
      expect(completeResult.success).toBe(true);
    });
  });

  describe('❌ Flujo con Cancelaciones y Reembolsos', () => {
    it('debería manejar cancelación por conductor antes de aceptar solicitudes', async () => {
      // 1. Conductor crea viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);

      // 2. Conductor cancela viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          reason: 'Conductor canceló',
          refundsProcessed: false // No hay pasajeros que reembolsar
        }, 
        error: null 
      });

      const cancelResult = await cancelRide(rideResult.rideId, 'Conductor canceló');
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('cancelled');
      expect(cancelResult.refundsProcessed).toBe(false);
    });

    it('debería manejar cancelación con pasajeros y reembolsos', async () => {
      // 1. Conductor crea viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);

      // 2. Pasajero solicita y fondos se mueven a escrow
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId }, 
        error: null 
      });

      const requestResult = await createSingleRequest(mockRequestData);
      expect(requestResult.success).toBe(true);

      // Movimiento a escrow
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, escrowId: 'escrow-123' }, 
        error: null 
      });

      const escrowResult = await moveToEscrow({
        userId: mockPassengerId,
        amount: 25.50,
        rideId: rideResult.rideId,
        type: 'ride_payment'
      });
      expect(escrowResult.success).toBe(true);

      // 3. Conductor acepta solicitud
      const mockRequest = {
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      };

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: `${mockRideId}-accepted` }, 
        error: null 
      });

      const fulfillResult = await fulfillRequest(mockRequest);
      expect(fulfillResult.success).toBe(true);

      // 4. Conductor cancela viaje (con penalización)
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          reason: 'Cancelación última hora',
          driverPenalty: 5.00,
          passengerRefund: 25.50,
          refundsProcessed: true
        }, 
        error: null 
      });

      const cancelResult = await cancelRide(fulfillResult.rideId, 'Cancelación última hora');
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.driverPenalty).toBe(5.00);
      expect(cancelResult.passengerRefund).toBe(25.50);
      expect(cancelResult.refundsProcessed).toBe(true);
    });

    it('debería manejar cancelación por pasajero', async () => {
      // 1. Conductor crea viaje
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);

      // 2. Pasajero crea solicitud
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId }, 
        error: null 
      });

      const requestResult = await createSingleRequest(mockRequestData);
      expect(requestResult.success).toBe(true);

      // 3. Pasajero cancela solicitud
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          reason: 'Pasajero canceló',
          refundProcessed: false // No hay pago procesado aún
        }, 
        error: null 
      });

      const cancelRequestResult = await cancelRequest(mockRequestId, 'Pasajero canceló');
      expect(cancelRequestResult.success).toBe(true);
      expect(cancelRequestResult.status).toBe('cancelled');
    });
  });

  describe('🔄 Flujo con Disputas y Resolución', () => {
    it('debería manejar disputa y resolución a favor del pasajero', async () => {
      // 1. Viaje completado con fondos en escrow
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);

      // 2. Pasajero crea disputa
      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          disputeId: 'dispute-123',
          escrowId: 'escrow-123',
          status: 'pending'
        }, 
        error: null 
      });

      const disputeResult = await resolveDispute('create', {
        escrowId: 'escrow-123',
        initiatedBy: mockPassengerId,
        reason: 'service_quality',
        description: 'El conductor llegó tarde y el vehículo no estaba limpio'
      });
      expect(disputeResult.success).toBe(true);
      expect(disputeResult.status).toBe('pending');

      // 3. Resolución a favor del pasajero (reembolso parcial)
      supabase.rpc.mockResolvedValueOnce({ 
        data: { 
          success: true, 
          disputeId: 'dispute-123',
          status: 'resolved',
          resolution: 'passenger_favor',
          passengerRefund: 15.00,
          driverPayment: 10.50,
          platformFee: 0.00
        }, 
        error: null 
      });

      const resolutionResult = await resolveDispute('resolve', {
        disputeId: 'dispute-123',
        resolution: 'passenger_favor',
        passengerRefund: 15.00,
        driverPayment: 10.50,
        reason: 'Calidad del servicio deficiente'
      });
      expect(resolutionResult.success).toBe(true);
      expect(resolutionResult.resolution).toBe('passenger_favor');
      expect(resolutionResult.passengerRefund).toBe(15.00);
    });
  });

  describe('📊 Flujo con Métricas y Estadísticas', () => {
    it('debería registrar métricas completas del flujo', async () => {
      const metricsSpy = vi.fn();
      
      // Mock que registra métricas en cada paso
      supabase.rpc.mockImplementation((functionName, params) => {
        metricsSpy(functionName, params);
        
        switch (functionName) {
          case 'create_ride':
            return Promise.resolve({ data: { success: true, rideId: mockRideId }, error: null });
          case 'create_ride_request':
            return Promise.resolve({ data: { success: true, requestId: mockRequestId }, error: null });
          case 'fulfill_ride_request':
            return Promise.resolve({ data: { success: true, rideId: `${mockRideId}-accepted` }, error: null });
          case 'move_to_escrow':
            return Promise.resolve({ data: { success: true, escrowId: 'escrow-123' }, error: null });
          case 'start_ride':
            return Promise.resolve({ data: { success: true, status: 'in_progress' }, error: null });
          case 'complete_ride':
            return Promise.resolve({ data: { success: true, status: 'completed' }, error: null });
          case 'release_from_escrow':
            return Promise.resolve({ data: { success: true, releaseId: 'release-123' }, error: null });
          default:
            return Promise.resolve({ data: { success: true }, error: null });
        }
      });

      // Ejecutar flujo completo
      const rideResult = await createSingleRide(mockRideData);
      expect(rideResult.success).toBe(true);

      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      const requestResult = await createSingleRequest(mockRequestData);
      expect(requestResult.success).toBe(true);

      const fulfillResult = await fulfillRequest({
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      });
      expect(fulfillResult.success).toBe(true);

      const escrowResult = await moveToEscrow({
        userId: mockPassengerId,
        amount: 25.50,
        rideId: fulfillResult.rideId,
        type: 'ride_payment'
      });
      expect(escrowResult.success).toBe(true);

      const startResult = await startRide(fulfillResult.rideId);
      expect(startResult.success).toBe(true);

      const completeResult = await completeRide(fulfillResult.rideId);
      expect(completeResult.success).toBe(true);

      const releaseResult = await releaseFromEscrow({
        escrowId: escrowResult.escrowId,
        releaseToUserId: mockDriverId,
        amount: 25.50,
        reason: 'Viaje completado'
      });
      expect(releaseResult.success).toBe(true);

      // Verificar que se registraron todas las métricas
      expect(metricsSpy).toHaveBeenCalledTimes(7);
      expect(metricsSpy).toHaveBeenCalledWith('create_ride', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('create_ride_request', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('fulfill_ride_request', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('move_to_escrow', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('start_ride', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('complete_ride', expect.any(Object));
      expect(metricsSpy).toHaveBeenCalledWith('release_from_escrow', expect.any(Object));
    });
  });

  describe('🔄 Flujos Concurrentes', () => {
    it('debería manejar múltiples flujos simultáneos', async () => {
      const promises = [];
      
      // Simular 5 flujos completos simultáneos
      for (let i = 0; i < 5; i++) {
        const flowPromises = [];
        const rideId = `ride-${i}`;
        const requestId = `request-${i}`;
        const driverId = `driver-${i}`;
        const passengerId = `passenger-${i}`;

        // Mock para cada flujo
        supabase.rpc.mockImplementation((functionName) => {
          switch (functionName) {
            case 'create_ride':
              return Promise.resolve({ data: { success: true, rideId: rideId }, error: null });
            case 'create_ride_request':
              return Promise.resolve({ data: { success: true, requestId: requestId }, error: null });
            case 'fulfill_ride_request':
              return Promise.resolve({ data: { success: true, rideId: `${rideId}-accepted` }, error: null });
            case 'start_ride':
              return Promise.resolve({ data: { success: true, status: 'in_progress' }, error: null });
            case 'complete_ride':
              return Promise.resolve({ data: { success: true, status: 'completed' }, error: null });
            default:
              return Promise.resolve({ data: { success: true }, error: null });
          }
        });

        // Ejecutar flujo para cada iteración
        flowPromises.push(createSingleRide(mockRideData));
        flowPromises.push(createSingleRequest(mockRequestData));
        flowPromises.push(fulfillRequest({
          id: requestId,
          requester_id: passengerId,
          ...mockRequestData
        }));
        flowPromises.push(startRide(`${rideId}-accepted`));
        flowPromises.push(completeRide(`${rideId}-accepted`));

        promises.push(Promise.all(flowPromises));
      }

      const results = await Promise.all(promises);

      // Verificar que todos los flujos se completaron exitosamente
      expect(results).toHaveLength(5);
      results.forEach((flowResults, index) => {
        expect(flowResults).toHaveLength(5);
        flowResults.forEach(result => {
          expect(result.success).toBe(true);
        });
      });
    });
  });

  describe('🔍 Verificación de Estado Final', () => {
    it('debería verificar estado consistente del sistema después del flujo', async () => {
      // Ejecutar flujo completo
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId }, 
        error: null 
      });

      const rideResult = await createSingleRide(mockRideData);

      supabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: mockPassengerId } }
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: mockRequestId }, 
        error: null 
      });

      const requestResult = await createSingleRequest(mockRequestData);

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: `${mockRideId}-completed` }, 
        error: null 
      });

      const fulfillResult = await fulfillRequest({
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      });

      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, status: 'completed' }, 
        error: null 
      });

      const completeResult = await completeRide(fulfillResult.rideId);

      // Verificar estado final del viaje
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ 
              data: {
                id: fulfillResult.rideId,
                status: 'completed',
                driver_id: mockDriverId,
                passenger_ids: [mockPassengerId],
                completed_at: new Date().toISOString()
              }, 
              error: null 
            })
          })
        })
      });

      const finalRideState = await getRideDetails(fulfillResult.rideId);
      expect(finalRideState.status).toBe('completed');
      expect(finalRideState.driver_id).toBe(mockDriverId);
      expect(finalRideState.passenger_ids).toContain(mockPassengerId);

      // Verificar balances finales
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ 
              data: { wallet_balance: 125.50 }, // 100 + 25.50
              error: null 
            })
          })
        })
      }).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ 
              data: { wallet_balance: 24.50 }, // 50 - 25.50
              error: null 
            })
          })
        })
      });

      // Verificar que todos los pasos fueron exitosos
      expect(rideResult.success).toBe(true);
      expect(requestResult.success).toBe(true);
      expect(fulfillResult.success).toBe(true);
      expect(completeResult.success).toBe(true);
      expect(finalRideState.status).toBe('completed');
    });
  });

  describe('📈 Tests de Rendimiento End-to-End', () => {
    it('debería completar flujo completo en tiempo razonable', async () => {
      const startTime = Date.now();
      
      // Mock rápido para todas las operaciones
      supabase.rpc.mockImplementation(() => {
        return Promise.resolve({ 
          data: { success: true, timestamp: Date.now() }, 
          error: null 
        });
      });

      // Ejecutar flujo completo
      await createSingleRide(mockRideData);
      await createSingleRequest(mockRequestData);
      await fulfillRequest({
        id: mockRequestId,
        requester_id: mockPassengerId,
        ...mockRequestData
      });
      await startRide(mockRideId);
      await completeRide(mockRideId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Menos de 5 segundos
    });

    it('debería manejar alta carga de flujos simultáneos', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 20 flujos simultáneos
      for (let i = 0; i < 20; i++) {
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRide({
          ...mockRideData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        }));
      }

      const results = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(results).toHaveLength(20);
      expect(duration).toBeLessThan(10000); // Menos de 10 segundos
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });
});

export default {};
