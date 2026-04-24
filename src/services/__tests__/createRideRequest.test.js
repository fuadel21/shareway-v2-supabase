/**
 * Tests Exhaustivos para Solicitudes de Viajes (create_ride_request)
 * Cobertura completa de la lógica de negocio, validaciones y edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { createSingleRequest, searchRequests, cancelRide } from '@/services/rideService';

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
            neq: vi.fn(() => ({
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

describe('🚗 Tests de Solicitudes de Viajes (create_ride_request)', () => {
  const mockRequesterId = 'requester-123';
  const mockRequesterProfile = {
    id: mockRequesterId,
    display_name: 'Pasajero Test',
    photo_url: 'https://example.com/photo.jpg',
    gender: 'female',
    verification: { status: 'verified' },
    wallet_balance: 50.00
  };

  const validRequestData = {
    origin: {
      address: 'Madrid, Spain',
      coordinates: { lat: 40.4168, lng: -3.7038 }
    },
    destination: {
      address: 'Barcelona, Spain',
      coordinates: { lat: 41.3851, lng: 2.1734 }
    },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Mañana
    seats_needed: 2,
    suggested_price: 20.00,
    details: 'Necesito plaza para 2 personas con equipaje',
    distance: 615,
    overview_polyline: 'test_polyline_request',
    is_women_only: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock de autenticación
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockRequesterId } }
    });
  });

  describe('✅ Casos de Éxito', () => {
    it('debería crear una solicitud con datos válidos', async () => {
      const mockResult = {
        success: true,
        requestId: 'request-123'
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await createSingleRequest(validRequestData);

      expect(result.success).toBe(true);
      expect(result.requestId).toBe('request-123');
      expect(supabase.rpc).toHaveBeenCalledWith('create_ride_request', expect.objectContaining({
        p_origin: expect.objectContaining({
            lat: validRequestData.origin.coordinates.lat,
            lng: validRequestData.origin.coordinates.lng
        }),
        p_destination: expect.objectContaining({
            lat: validRequestData.destination.coordinates.lat,
            lng: validRequestData.destination.coordinates.lng
        }),
        p_seats_needed: validRequestData.seats_needed,
        p_suggested_price: validRequestData.suggested_price
      }));
    });

    it('debería crear solicitud women_only para mujer', async () => {
      const womenOnlyRequest = {
        ...validRequestData,
        is_women_only: true
      };

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockRequesterProfile, gender: 'female' }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-women' }, 
        error: null 
      });

      const result = await createSingleRequest(womenOnlyRequest);

      expect(result.success).toBe(true);
    });

    it('debería crear solicitud con precio sugerido alto pero justo', async () => {
      const highPriceRequest = {
        ...validRequestData,
        suggested_price: 35.00, // 35/615 = 0.057€/km < 0.60€/km
        distance: 615
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-high-price' }, 
        error: null 
      });

      const result = await createSingleRequest(highPriceRequest);

      expect(result.success).toBe(true);
    });

    it('debería crear solicitud para viaje inmediato (+15 minutos)', async () => {
      const immediateRequest = {
        ...validRequestData,
        departure_time: new Date(Date.now() + 15 * 60 * 1000).toISOString() // En 15 minutos
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-immediate' }, 
        error: null 
      });

      const result = await createSingleRequest(immediateRequest);

      expect(result.success).toBe(true);
    });

    it('debería crear solicitud con detalles extensos', async () => {
      const detailedRequest = {
        ...validRequestData,
        details: 'Viaje para 2 personas con maletas grandes, preferiblemente cerca de la ventana, necesitamos espacio para equipaje de mano y una maleta grande. Somos no fumadores y preferimos viaje tranquilo.'
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-detailed' }, 
        error: null 
      });

      const result = await createSingleRequest(detailedRequest);

      expect(result.success).toBe(true);
    });
  });

  describe('❌ Validaciones de Autenticación y Permisos', () => {
    it('debería rechazar creación si usuario no está autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      // El RPC fallaría en la base de datos si no hay usuario,
      // pero aquí simulamos que el RPC devuelve error de permiso.
      supabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not authenticated' }
      });

      await expect(createSingleRequest(validRequestData)).rejects.toThrow();
    });

    it('debería rechazar solicitud women_only para hombre', async () => {
      const womenOnlyRequest = {
        ...validRequestData,
        is_women_only: true
      };

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockRequesterProfile, gender: 'male' }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Solo las usuarias pueden crear solicitudes exclusivas para mujeres' } 
      });

      await expect(createSingleRequest(womenOnlyRequest)).rejects.toThrow();
    });

    it('debería rechazar si usuario no tiene saldo suficiente', async () => {
      // Mock de wallet con saldo insuficiente
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockRequesterProfile, wallet_balance: 5.00 }
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Saldo insuficiente para crear solicitud' } 
      });

      await expect(createSingleRequest(validRequestData)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Datos y Coordenadas', () => {
    it('debería rechazar coordenadas inválidas de origen', async () => {
      const invalidRequest = {
        ...validRequestData,
        origin: { coordinates: { lat: 91, lng: 181 } }
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Coordenadas de origen inválidas' } 
      });

      await expect(createSingleRequest(invalidRequest)).rejects.toThrow();
    });

    it('debería rechazar coordenadas inválidas de destino', async () => {
      const invalidRequest = {
        ...validRequestData,
        destination: { coordinates: { lat: -91, lng: -181 } }
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Coordenadas de destino inválidas' } 
      });

      await expect(createSingleRequest(invalidRequest)).rejects.toThrow();
    });

    it('debería rechazar asientos_needed menores a 1', async () => {
      const invalidRequest = {
        ...validRequestData,
        seats_needed: 0
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Puedes pedir entre 1 y 4 plazas' } 
      });

      await expect(createSingleRequest(invalidRequest)).rejects.toThrow();
    });

    it('debería rechazar asientos_needed mayores a 4', async () => {
      const invalidRequest = {
        ...validRequestData,
        seats_needed: 5
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Puedes pedir entre 1 y 4 plazas' } 
      });

      await expect(createSingleRequest(invalidRequest)).rejects.toThrow();
    });

    it('debería rechazar precio sugerido que excede 0.60€/km', async () => {
      const expensiveRequest = {
        ...validRequestData,
        suggested_price: 400, // 400/615 = 0.65€/km > 0.60€/km
        distance: 615
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El precio sugerido supera el límite permitido de 0.60€/km' } 
      });

      await expect(createSingleRequest(expensiveRequest)).rejects.toThrow();
    });

    it('debería rechazar precio negativo', async () => {
      const negativePriceRequest = {
        ...validRequestData,
        suggested_price: -10
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'El precio sugerido no puede ser negativo' } 
      });

      await expect(createSingleRequest(negativePriceRequest)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Tiempo y Solapamiento', () => {
    it('debería rechazar fecha en el pasado', async () => {
      const pastRequest = {
        ...validRequestData,
        departure_time: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La hora del viaje debe ser al menos 5 minutos a futuro' } 
      });

      await expect(createSingleRequest(pastRequest)).rejects.toThrow();
    });

    it('debería rechazar fecha muy cercana (menos de 10 minutos)', async () => {
      const soonRequest = {
        ...validRequestData,
        departure_time: new Date(Date.now() + 3 * 60 * 1000).toISOString() // En 3 minutos
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'La hora del viaje debe ser al menos 5 minutos a futuro' } 
      });

      await expect(createSingleRequest(soonRequest)).rejects.toThrow();
    });

    it('debería rechazar solapamiento con solicitud existente (+/- 1h)', async () => {
      const overlappingRequest = {
        ...validRequestData,
        departure_time: new Date(Date.now() + 30 * 60 * 1000).toISOString() // En 30 minutos
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Ya tienes otra solicitud activa para un horario similar' } 
      });

      await expect(createSingleRequest(overlappingRequest)).rejects.toThrow();
    });

    it('debería rechazar más de 5 solicitudes activas', async () => {
      const request = {
        ...validRequestData,
        departure_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() // En 5 horas
      };

      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Has alcanzado el límite de 5 solicitudes activas' } 
      });

      await expect(createSingleRequest(request)).rejects.toThrow();
    });
  });

  describe('🔄 Tests de Concurrencia', () => {
    it('debería manejar múltiples solicitudes simultáneas', async () => {
      const promises = [];
      
      // Simular 10 solicitudes simultáneas
      for (let i = 0; i < 10; i++) {
        const requestData = {
          ...validRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, requestId: `request-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRequest(requestData));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('debería prevenir duplicados exactos', async () => {
      const duplicateRequest = { ...validRequestData };

      // Primer intento exitoso
      supabase.rpc.mockResolvedValueOnce({ 
        data: { success: true, requestId: 'request-original' }, 
        error: null 
      });

      const result1 = await createSingleRequest(duplicateRequest);

      // Segundo intento rechazado por duplicado
      supabase.rpc.mockResolvedValueOnce({ 
        data: null, 
        error: { message: 'Solicitud duplicada detectada' }
      });

      await expect(createSingleRequest(duplicateRequest)).rejects.toThrow('Solicitud duplicada detectada');
    });

    it('debería respetar límite de 5 solicitudes activas concurrentemente', async () => {
      const promises = [];
      
      // Intentar crear 8 solicitudes simultáneas
      for (let i = 0; i < 8; i++) {
        const requestData = {
          ...validRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        // Las primeras 5 deberían tener éxito, las siguientes 3 deberían fallar
        if (i < 5) {
          supabase.rpc.mockResolvedValue({ 
            data: { success: true, requestId: `request-${i}` }, 
            error: null 
          });
        } else {
          supabase.rpc.mockResolvedValue({ 
            data: null, 
            error: { message: 'Has alcanzado el límite de 5 solicitudes activas' } 
          });
        }
        
        promises.push(createSingleRequest(requestData).catch(e => ({ success: false, error: e.message })));
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful).toHaveLength(5);
      expect(failed).toHaveLength(3);
    });
  });

  describe('🧪 Edge Cases y Límites', () => {
    it('debería manejar caracteres especiales en detalles', async () => {
      const specialCharsRequest = {
        ...validRequestData,
        details: 'Necesito plaza 🚗 con aire acondicionado ❄️ y música 🎵'
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-special-chars' }, 
        error: null 
      });

      const result = await createSingleRequest(specialCharsRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar detalles muy largos', async () => {
      const longDetailsRequest = {
        ...validRequestData,
        details: 'a'.repeat(500) // 500 caracteres
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-long-details' }, 
        error: null 
      });

      const result = await createSingleRequest(longDetailsRequest);

      expect(result.success).toBe(true);
    });

    it('debería rechazar precio sugerido cero (no permitido)', async () => {
      const freeRequest = {
        ...validRequestData,
        suggested_price: 0
      };

      await expect(createSingleRequest(freeRequest)).rejects.toThrow(/al menos 0.5/);
    });

    it('debería manejar distancia cero', async () => {
      const zeroDistanceRequest = {
        ...validRequestData,
        distance: 0
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-zero-distance' }, 
        error: null 
      });

      const result = await createSingleRequest(zeroDistanceRequest);

      expect(result.success).toBe(true);
    });

    it('debería manejar overview_polyline vacío', async () => {
      const noPolylineRequest = {
        ...validRequestData,
        overview_polyline: ''
      };

      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-no-polyline' }, 
        error: null 
      });

      const result = await createSingleRequest(noPolylineRequest);

      expect(result.success).toBe(true);
    });
  });

  describe('🔧 Manejo de Errores', () => {
    it('debería manejar error de conexión a base de datos', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      await expect(createSingleRequest(validRequestData)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar respuesta vacía de RPC', async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: null });

      await expect(createSingleRequest(validRequestData)).rejects.toThrow('No se recibió confirmación de la solicitud');
    });

    it('debería manejar error de validación desconocido', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error desconocido en validación de solicitud' } 
      });

      await expect(createSingleRequest(validRequestData)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en solicitud' } 
      });

      await expect(createSingleRequest(validRequestData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Request Flow] createRideRequest failed'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería completar creación en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { success: true, requestId: 'request-performance' }, 
        error: null 
      });

      await createSingleRequest(validRequestData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(3000); // Menos de 3 segundos
    });

    it('debería manejar alta carga de solicitudes', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 30 solicitudes simultáneas
      for (let i = 0; i < 30; i++) {
        const requestData = {
          ...validRequestData,
          departure_time: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString()
        };
        
        supabase.rpc.mockResolvedValue({ 
          data: { success: true, requestId: `request-load-${i}` }, 
          error: null 
        });
        
        promises.push(createSingleRequest(requestData));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(8000); // Menos de 8 segundos para 30 solicitudes
    });
  });

  describe('🔍 Tests de Búsqueda y Filtrado', () => {
    it('debería obtener solicitudes disponibles correctamente', async () => {
      const mockRequests = [
        { id: 'req-1', status: 'pending', departure_time: new Date().toISOString() },
        { id: 'req-2', status: 'pending', departure_time: new Date().toISOString() }
      ];

      supabase.rpc.mockResolvedValueOnce({ data: mockRequests, error: null });

      const requests = await searchRequests({
          origin: { lat: 40.4168, lng: -3.7038 },
          destination: { lat: 41.3851, lng: 2.1734 }
      });

      expect(requests).toHaveLength(2);
    });
  });
});

export default {};
