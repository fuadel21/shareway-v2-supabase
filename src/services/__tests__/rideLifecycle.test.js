/**
 * Tests Exhaustivos para Viajes en Curso (Ride Lifecycle)
 * Cobertura completa del ciclo de vida de viajes: inicio, progreso, finalización, cancelación
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { 
  startRide, 
  completeRide, 
  cancelRide, 
  updateRideStatus,
  getCurrentRides,
  getRideDetails,
  updateRideLocation,
  emergencyStopRide
} from '@/services/rideService';

// Mock de Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          then: vi.fn(),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              then: vi.fn()
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

describe('🚗 Tests de Viajes en Curso (Ride Lifecycle)', () => {
  const mockDriverId = 'driver-123';
  const mockPassengerId = 'passenger-456';
  const mockRideId = 'ride-789';

  const mockRide = {
    id: mockRideId,
    driver_id: mockDriverId,
    status: 'scheduled',
    departure_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    seats_total: 4,
    seats_available: 2,
    passenger_ids: [mockPassengerId],
    price: 25.50,
    distance: 615,
    created_at: new Date().toISOString()
  };

  const mockDriverProfile = {
    id: mockDriverId,
    display_name: 'Conductor Test',
    photo_url: 'https://example.com/driver.jpg',
    verification: { status: 'verified' },
    wallet_balance: 100.00
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockDriverId } }
    });
  });

  describe('✅ Inicio de Viaje (startRide)', () => {
    it('debería iniciar viaje correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'in_progress',
        startedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await startRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('in_progress');
      expect(supabase.rpc).toHaveBeenCalledWith('start_ride', {
        p_ride_id: mockRideId,
        p_driver_id: mockDriverId
      });
    });

    it('debería iniciar viaje con ubicación actual', async () => {
      const currentLocation = { lat: 40.4168, lng: -3.7038 };
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'in_progress',
        currentLocation: currentLocation
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await startRide(mockRideId, currentLocation);

      expect(result.success).toBe(true);
      expect(result.currentLocation).toEqual(currentLocation);
    });

    it('debería registrar hora de inicio real', async () => {
      const startTime = new Date();
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'in_progress',
        startedAt: startTime.toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await startRide(mockRideId);

      expect(result.success).toBe(true);
      expect(new Date(result.startedAt)).toBeInstanceOf(Date);
    });
  });

  describe('❌ Validaciones de Inicio de Viaje', () => {
    it('debería rechazar inicio si conductor no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si viaje no existe', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Viaje no encontrado' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si conductor no es el dueño', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Solo el conductor puede iniciar el viaje' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si viaje ya está en curso', async () => {
      const inProgressRide = { ...mockRide, status: 'in_progress' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya está en curso' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si viaje ya fue completado', async () => {
      const completedRide = { ...mockRide, status: 'completed' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya fue completado' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si viaje fue cancelado', async () => {
      const cancelledRide = { ...mockRide, status: 'cancelled' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje fue cancelado' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si es demasiado temprano', async () => {
      const earlyRide = {
        ...mockRide,
        departure_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // En 2 horas
      };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Es demasiado temprano para iniciar el viaje' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar inicio si es demasiado tarde', async () => {
      const lateRide = {
        ...mockRide,
        departure_time: new Date(Date.now() - 30 * 60 * 1000).toISOString() // Hace 30 minutos
      };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya ha pasado su hora de inicio' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
    });
  });

  describe('✅ Finalización de Viaje (completeRide)', () => {
    it('debería completar viaje correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'completed',
        completedAt: new Date().toISOString(),
        finalDistance: 620.5,
        finalDuration: 3600 // 1 hora en segundos
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await completeRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.finalDistance).toBe(620.5);
    });

    it('debería completar viaje y procesar pagos', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'completed',
        paymentsProcessed: true,
        driverBalance: 125.50, // 100 + 25.50
        passengerBalances: {
          [mockPassengerId]: 24.50 // 50 - 25.50
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await completeRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.paymentsProcessed).toBe(true);
      expect(result.driverBalance).toBe(125.50);
    });

    it('debería completar viaje y liberar fondos de escrow', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'completed',
        escrowReleased: true,
        escrowAmount: 25.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await completeRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.escrowReleased).toBe(true);
      expect(result.escrowAmount).toBe(25.50);
    });

    it('debería registrar métricas del viaje', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'completed',
        metrics: {
          actualDistance: 618.2,
          actualDuration: 3450,
          averageSpeed: 64.5,
          fuelConsumption: 8.2,
          co2Saved: 45.6
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await completeRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.metrics.actualDistance).toBe(618.2);
      expect(result.metrics.co2Saved).toBe(45.6);
    });
  });

  describe('❌ Validaciones de Finalización de Viaje', () => {
    it('debería rechazar finalización si viaje no está en curso', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Solo se pueden completar viajes en curso' } 
      });

      await expect(completeRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar finalización si conductor no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      await expect(completeRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar finalización si no es el conductor', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Solo el conductor puede completar el viaje' } 
      });

      await expect(completeRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar finalización si ya fue completado', async () => {
      const completedRide = { ...mockRide, status: 'completed' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya fue completado' } 
      });

      await expect(completeRide(mockRideId)).rejects.toThrow();
    });
  });

  describe('✅ Cancelación de Viaje (cancelRide)', () => {
    it('debería cancelar viaje programado correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        reason: 'Conductor canceló',
        refundsProcessed: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await cancelRide(mockRideId, 'Conductor canceló');

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
      expect(result.refundsProcessed).toBe(true);
    });

    it('debería cancelar viaje y procesar reembolsos', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'cancelled',
        refundsProcessed: true,
        refundAmounts: {
          [mockPassengerId]: 25.50
        },
        driverPenalty: 5.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await cancelRide(mockRideId, 'Cancelación por emergencia');

      expect(result.success).toBe(true);
      expect(result.refundAmounts[mockPassengerId]).toBe(25.50);
      expect(result.driverPenalty).toBe(5.00);
    });

    it('debería cancelar viaje y liberar escrow', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'cancelled',
        escrowReleased: true,
        escrowRefunded: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await cancelRide(mockRideId);

      expect(result.success).toBe(true);
      expect(result.escrowReleased).toBe(true);
      expect(result.escrowRefunded).toBe(true);
    });

    it('debería cancelar viaje con penalización si es última hora', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'cancelled',
        lastMinuteCancellation: true,
        driverPenalty: 10.00,
        passengerCompensation: 5.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await cancelRide(mockRideId, 'Cancelación última hora');

      expect(result.success).toBe(true);
      expect(result.lastMinuteCancellation).toBe(true);
      expect(result.driverPenalty).toBe(10.00);
    });
  });

  describe('❌ Validaciones de Cancelación de Viaje', () => {
    it('debería rechazar cancelación si viaje ya está en curso', async () => {
      const inProgressRide = { ...mockRide, status: 'in_progress' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'No se puede cancelar un viaje en curso' } 
      });

      await expect(cancelRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar cancelación si viaje ya fue completado', async () => {
      const completedRide = { ...mockRide, status: 'completed' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'No se puede cancelar un viaje completado' } 
      });

      await expect(cancelRide(mockRideId)).rejects.toThrow();
    });

    it('debería rechazar cancelación si ya fue cancelado', async () => {
      const cancelledRide = { ...mockRide, status: 'cancelled' };
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya fue cancelado' } 
      });

      await expect(cancelRide(mockRideId)).rejects.toThrow();
    });
  });

  describe('✅ Actualización de Estado (updateRideStatus)', () => {
    it('debería actualizar estado correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        previousStatus: 'scheduled',
        newStatus: 'active',
        updatedAt: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideStatus(mockRideId, 'active');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('active');
      expect(result.previousStatus).toBe('scheduled');
    });

    it('debería actualizar estado con metadata', async () => {
      const metadata = {
        location: { lat: 40.4168, lng: -3.7038 },
        speed: 65.5,
        estimatedArrival: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        newStatus: 'active',
        metadata: metadata
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideStatus(mockRideId, 'active', metadata);

      expect(result.success).toBe(true);
      expect(result.metadata).toEqual(metadata);
    });

    it('debería registrar cambios de estado', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        statusHistory: [
          { status: 'scheduled', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
          { status: 'active', timestamp: new Date().toISOString() }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideStatus(mockRideId, 'active');

      expect(result.success).toBe(true);
      expect(result.statusHistory).toHaveLength(2);
    });
  });

  describe('✅ Actualización de Ubicación (updateRideLocation)', () => {
    it('debería actualizar ubicación del viaje', async () => {
      const newLocation = { lat: 40.4200, lng: -3.7100 };
      const mockResult = {
        success: true,
        rideId: mockRideId,
        location: newLocation,
        timestamp: new Date().toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideLocation(mockRideId, newLocation);

      expect(result.success).toBe(true);
      expect(result.location).toEqual(newLocation);
    });

    it('debería actualizar ubicación con velocidad y heading', async () => {
      const locationData = {
        lat: 40.4200,
        lng: -3.7100,
        speed: 65.5,
        heading: 90.0,
        accuracy: 5.0
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        location: locationData
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideLocation(mockRideId, locationData);

      expect(result.success).toBe(true);
      expect(result.location.speed).toBe(65.5);
      expect(result.location.heading).toBe(90.0);
    });

    it('debería calcular distancia recorrida', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        location: { lat: 40.4200, lng: -3.7100 },
        distanceSinceLastUpdate: 0.5,
        totalDistance: 125.3
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateRideLocation(mockRideId, { lat: 40.4200, lng: -3.7100 });

      expect(result.success).toBe(true);
      expect(result.distanceSinceLastUpdate).toBe(0.5);
      expect(result.totalDistance).toBe(125.3);
    });
  });

  describe('✅ Parada de Emergencia (emergencyStopRide)', () => {
    it('debería realizar parada de emergencia', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'emergency_stopped',
        stoppedAt: new Date().toISOString(),
        reason: 'Accidente',
        emergencyNotified: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await emergencyStopRide(mockRideId, 'Accidente');

      expect(result.success).toBe(true);
      expect(result.status).toBe('emergency_stopped');
      expect(result.emergencyNotified).toBe(true);
    });

    it('debería notificar a pasajeros y servicios', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'emergency_stopped',
        notificationsSent: {
          passengers: true,
          emergencyServices: true,
          support: true
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await emergencyStopRide(mockRideId, 'Emergencia médica');

      expect(result.success).toBe(true);
      expect(result.notificationsSent.passengers).toBe(true);
      expect(result.notificationsSent.emergencyServices).toBe(true);
    });

    it('debería procesar reembolsos automáticamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        status: 'emergency_stopped',
        refundsProcessed: true,
        refundAmounts: {
          [mockPassengerId]: 25.50
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await emergencyStopRide(mockRideId, 'Problema mecánico');

      expect(result.success).toBe(true);
      expect(result.refundsProcessed).toBe(true);
      expect(result.refundAmounts[mockPassengerId]).toBe(25.50);
    });
  });

  describe('📊 Tests de Consulta y Estado', () => {
    it('debería obtener viajes actuales del conductor', async () => {
      const mockRides = [
        { ...mockRide, status: 'in_progress' },
        { ...mockRide, id: 'ride-2', status: 'scheduled' }
      ];

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              then: vi.fn().mockResolvedValue({ data: mockRides, error: null })
            })
          })
        })
      });

      const rides = await getCurrentRides(mockDriverId);

      expect(rides).toHaveLength(2);
      expect(rides[0].status).toBe('in_progress');
    });

    it('debería obtener detalles completos del viaje', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockRide, error: null })
          })
        })
      });

      const ride = await getRideDetails(mockRideId);

      expect(ride.id).toBe(mockRideId);
      expect(ride.status).toBe('scheduled');
      expect(ride.passenger_ids).toContain(mockPassengerId);
    });

    it('debería obtener historial de estados del viaje', async () => {
      const statusHistory = [
        { status: 'scheduled', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
        { status: 'active', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        { status: 'in_progress', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
      ];

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn().mockResolvedValue({ data: statusHistory, error: null })
            })
          })
        })
      });

      const history = await getRideStatusHistory(mockRideId);

      expect(history).toHaveLength(3);
      expect(history[0].status).toBe('scheduled');
      expect(history[2].status).toBe('in_progress');
    });
  });

  describe('🔄 Tests de Concurrencia', () => {
    it('debería manejar múltiples actualizaciones de ubicación simultáneas', async () => {
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
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('debería prevenir doble inicio del mismo viaje', async () => {
      // Primer inicio exitoso
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, status: 'in_progress' }, 
        error: null 
      });

      // Segundo inicio rechazado
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'El viaje ya está en curso' } 
      });

      const result1 = await startRide(mockRideId);
      const result2 = await startRide(mockRideId);

      expect(result1.success).toBe(true);
      await expect(result2).rejects.toThrow();
    });

    it('debería manejar intentos simultáneos de cancelación', async () => {
      const promises = [];
      
      // 3 intentos simultáneos de cancelación
      for (let i = 0; i < 3; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, status: 'cancelled' }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'El viaje ya fue cancelado' } 
          });
        }
        
        promises.push(cancelRide(mockRideId).catch(e => ({ success: false, error: e.message })));
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });

  describe('🔧 Manejo de Errores', () => {
    it('debería manejar error de conexión durante actualización de ubicación', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      await expect(updateRideLocation(mockRideId, { lat: 40.4168, lng: -3.7038 }))
        .rejects.toThrow('Connection timeout');
    });

    it('debería manejar error de validación en cambio de estado', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Estado no válido para este viaje' } 
      });

      await expect(updateRideStatus(mockRideId, 'invalid_status'))
        .rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en lifecycle' } 
      });

      await expect(startRide(mockRideId)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Ride Lifecycle]'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería completar actualización de ubicación en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { success: true, location: { lat: 40.4168, lng: -3.7038 } }, 
        error: null 
      });

      await updateRideLocation(mockRideId, { lat: 40.4168, lng: -3.7038 });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // Menos de 1 segundo
    });

    it('debería manejar alta frecuencia de actualizaciones', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 100 actualizaciones de ubicación en 10 segundos
      for (let i = 0; i < 100; i++) {
        const location = {
          lat: 40.4168 + (i * 0.0001),
          lng: -3.7038 + (i * 0.0001)
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, location: location }, 
          error: null 
        });
        
        promises.push(updateRideLocation(mockRideId, location));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(5000); // Menos de 5 segundos para 100 actualizaciones
    });
  });
});

export default {};
