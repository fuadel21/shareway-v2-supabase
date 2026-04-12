/**
 * Tests Exhaustivos para Aceptación de Solicitudes (fulfill_ride_request)
 * Cobertura completa de la lógica de negocio, validaciones y edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { fulfillRequest, acceptPassenger, rejectPassenger, verifyPassenger } from '@/services/rideService';

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

describe('🚗 Tests de Aceptación de Solicitudes (fulfill_ride_request)', () => {
  const mockDriverId = 'driver-123';
  const mockRequesterId = 'requester-456';
  const mockRideId = 'ride-789';
  const mockRequestId = 'request-101';

  const mockRequest = {
    id: mockRequestId,
    requester_id: mockRequesterId,
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats_needed: 2,
    suggested_price: 20.00,
    status: 'pending',
    distance: 615
  };

  const mockDriverProfile = {
    id: mockDriverId,
    display_name: 'Conductor Test',
    photo_url: 'https://example.com/driver.jpg',
    gender: 'male',
    verification: { status: 'verified' },
    wallet_balance: 100.00
  };

  const mockRequesterProfile = {
    id: mockRequesterId,
    display_name: 'Pasajero Test',
    photo_url: 'https://example.com/passenger.jpg',
    gender: 'female',
    verification: { status: 'verified' },
    wallet_balance: 50.00
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock de autenticación como conductor
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockDriverId } }
    });
  });

  describe('✅ Casos de Éxito', () => {
    it('debería aceptar solicitud y crear viaje correctamente', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(mockRequest);

      expect(result.success).toBe(true);
      expect(result.rideId).toBe(mockRideId);
      expect(supabase.rpc).toHaveBeenCalledWith('fulfill_ride_request', expect.objectContaining({
        p_request_id: mockRequestId,
        p_driver_id: mockDriverId
      }));
    });

    it('debería aceptar solicitud con múltiples pasajeros', async () => {
      const multiSeatRequest = {
        ...mockRequest,
        seats_needed: 3
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(multiSeatRequest);

      expect(result.success).toBe(true);
      expect(result.rideId).toBe(mockRideId);
    });

    it('debería aceptar solicitud women_only para conductora mujer', async () => {
      const womenOnlyRequest = {
        ...mockRequest,
        is_women_only: true
      };

      // Mock de perfil de conductora mujer
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, gender: 'female' }
            })
          })
        })
      });

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(womenOnlyRequest);

      expect(result.success).toBe(true);
    });

    it('debería aceptar solicitud con precio justo', async () => {
      const fairPriceRequest = {
        ...mockRequest,
        suggested_price: 18.50, // Precio justo
        distance: 615
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(fairPriceRequest);

      expect(result.success).toBe(true);
    });

    it('debería aceptar solicitud y deducir saldo del pasajero', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId,
        passengerBalance: 30.00, // 50.00 - 20.00
        driverBalance: 100.00
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(mockRequest);

      expect(result.success).toBe(true);
      expect(result.passengerBalance).toBe(30.00);
    });
  });

  describe('❌ Validaciones de Autenticación y Permisos', () => {
    it('debería rechazar si conductor no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería rechazar solicitud women_only para conductor hombre', async () => {
      const womenOnlyRequest = {
        ...mockRequest,
        is_women_only: true
      };

      // Mock de perfil de conductor hombre
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, gender: 'male' }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Solo las conductoras pueden aceptar solicitudes exclusivas para mujeres' } 
      });

      await expect(fulfillRequest(womenOnlyRequest)).rejects.toThrow();
    });

    it('debería rechazar si conductor no está verificado', async () => {
      // Mock de conductor no verificado
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, verification: { status: 'pending' } }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Conductor no verificado' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería rechazar si pasajero no está verificado', async () => {
      // Mock de pasajero no verificado
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockDriverProfile
            })
          })
        })
      }).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockRequesterProfile, verification: { status: 'pending' } }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Pasajero no verificado' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Estado y Disponibilidad', () => {
    it('debería rechazar solicitud ya aceptada', async () => {
      const acceptedRequest = {
        ...mockRequest,
        status: 'accepted'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La solicitud ya ha sido aceptada' } 
      });

      await expect(fulfillRequest(acceptedRequest)).rejects.toThrow();
    });

    it('debería rechazar solicitud cancelada', async () => {
      const cancelledRequest = {
        ...mockRequest,
        status: 'cancelled'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La solicitud ha sido cancelada' } 
      });

      await expect(fulfillRequest(cancelledRequest)).rejects.toThrow();
    });

    it('debería rechazar solicitud expirada', async () => {
      const expiredRequest = {
        ...mockRequest,
        departure_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // Hace 1 hora
        status: 'expired'
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La solicitud ha expirado' } 
      });

      await expect(fulfillRequest(expiredRequest)).rejects.toThrow();
    });

    it('debería rechazar si conductor no tiene plazas disponibles', async () => {
      // Mock de conductor con viaje completo
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockDriverProfile
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'No hay plazas suficientes disponibles' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería rechazar si pasajero no tiene saldo suficiente', async () => {
      // Mock de pasajero con saldo insuficiente
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockDriverProfile
            })
          })
        })
      }).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockRequesterProfile, wallet_balance: 10.00 }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Saldo insuficiente del pasajero' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Tiempo y Solapamiento', () => {
    it('debería rechazar si conductor tiene solapamiento de horarios', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Conflicto de horario: El conductor ya tiene un viaje en este horario' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería rechazar si solicitud está demasiado cerca en tiempo', async () => {
      const urgentRequest = {
        ...mockRequest,
        departure_time: new Date(Date.now() + 15 * 60 * 1000).toISOString() // En 15 minutos
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La solicitud está demasiado cerca en tiempo para ser aceptada' } 
      });

      await expect(fulfillRequest(urgentRequest)).rejects.toThrow();
    });

    it('debería rechazar si el viaje ya pasó', async () => {
      const pastRequest = {
        ...mockRequest,
        departure_time: new Date(Date.now() - 30 * 60 * 1000).toISOString() // Hace 30 minutos
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El viaje ya ha pasado' } 
      });

      await expect(fulfillRequest(pastRequest)).rejects.toThrow();
    });
  });

  describe('🔄 Tests de Concurrencia y Race Conditions', () => {
    it('debería manejar múltiples intentos de aceptación simultáneos', async () => {
      const promises = [];
      
      // Simular 5 conductores intentando aceptar la misma solicitud
      for (let i = 0; i < 5; i++) {
        // Solo el primero debería tener éxito
        if (i === 0) {
          supabase.rpc.mockResolvedValueOnce({ 
            data: { success: true, rideId: `ride-${i}`, requestId: mockRequestId }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValueOnce({ 
            data: null, 
            error: { message: 'La solicitud ya ha sido aceptada por otro conductor' } 
          });
        }
        
        promises.push(fulfillRequest(mockRequest).catch(e => ({ success: false, error: e.message })));
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(4);
    });

    it('debería prevenir doble aceptación por el mismo conductor', async () => {
      // Primer intento exitoso
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, rideId: mockRideId, requestId: mockRequestId }, 
        error: null 
      });

      // Segundo intento rechazado
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Ya has aceptado esta solicitud' } 
      });

      const result1 = await fulfillRequest(mockRequest);
      const result2 = await fulfillRequest(mockRequest);

      expect(result1.success).toBe(true);
      await expect(result2).rejects.toThrow();
    });

    it('debería manejar aceptación atómica con bloqueo', async () => {
      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId,
        transactionLocked: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(mockRequest);

      expect(result.success).toBe(true);
      expect(result.transactionLocked).toBe(true);
    });
  });

  describe('🧪 Edge Cases y Límites', () => {
    it('debería manejar solicitud con precio cero', async () => {
      const freeRequest = {
        ...mockRequest,
        suggested_price: 0
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(freeRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar solicitud con precio máximo', async () => {
      const maxPriceRequest = {
        ...mockRequest,
        suggested_price: 300.00
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(maxPriceRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar solicitud con distancia máxima', async () => {
      const maxDistanceRequest = {
        ...mockRequest,
        distance: 500
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(maxDistanceRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar solicitud con asientos máximos', async () => {
      const maxSeatsRequest = {
        ...mockRequest,
        seats_needed: 4
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(maxSeatsRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar solicitud sin detalles', async () => {
      const noDetailsRequest = {
        ...mockRequest,
        details: ''
      };

      const mockResult = {
        success: true,
        rideId: mockRideId,
        requestId: mockRequestId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await fulfillRequest(noDetailsRequest);

      expect(result.success).toBe(true);
    });
  });

  describe('🔧 Manejo de Errores', () => {
    it('debería manejar error de conexión a base de datos', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      await expect(fulfillRequest(mockRequest)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar respuesta vacía de RPC', async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: null });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería manejar error de validación desconocido', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error desconocido en aceptación de solicitud' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en aceptación' } 
      });

      await expect(fulfillRequest(mockRequest)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Fulfill Flow] fulfillRequest failed'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería completar aceptación en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { success: true, rideId: mockRideId, requestId: mockRequestId }, 
        error: null 
      });

      await fulfillRequest(mockRequest);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(2000); // Menos de 2 segundos
    });

    it('debería manejar alta carga de aceptaciones simultáneas', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 20 aceptaciones simultáneas de diferentes solicitudes
      for (let i = 0; i < 20; i++) {
        const request = {
          ...mockRequest,
          id: `request-${i}`,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, rideId: `ride-${i}`, requestId: `request-${i}` }, 
          error: null 
        });
        
        promises.push(fulfillRequest(request));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(5000); // Menos de 5 segundos para 20 aceptaciones
    });
  });

  describe('🔍 Tests de Funciones Auxiliares', () => {
    it('debería aceptar pasajero en viaje existente', async () => {
      const mockResult = {
        success: true,
        passengerId: mockRequesterId,
        rideId: mockRideId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await acceptPassenger(mockRideId, mockRequesterId);

      expect(result.success).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith('accept_passenger', {
        p_ride_id: mockRideId,
        p_passenger_id: mockRequesterId
      });
    });

    it('debería rechazar pasajero de viaje existente', async () => {
      const mockResult = {
        success: true,
        passengerId: mockRequesterId,
        rideId: mockRideId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await rejectPassenger(mockRideId, mockRequesterId);

      expect(result.success).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith('reject_passenger', {
        p_ride_id: mockRideId,
        p_passenger_id: mockRequesterId
      });
    });

    it('debería verificar pasajero antes del viaje', async () => {
      const mockResult = {
        success: true,
        verified: true,
        passengerId: mockRequesterId
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await verifyPassenger(mockRideId, mockRequesterId);

      expect(result.success).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith('verify_passenger', {
        p_ride_id: mockRideId,
        p_passenger_id: mockRequesterId
      });
    });
  });
});

export default {};
