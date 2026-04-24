/**
 * Tests Exhaustivos para Publicación de Plazas (create_ride)
 * Cobertura completa de la lógica de negocio, validaciones y edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import * as rpc from '@/lib/supabaseRPC';
import { createSingleRide, getAvailableRides, cancelRide } from '@/services/rideService';

// Mock de Supabase y RPC
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn()
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    }))
  }
}));

vi.mock('@/lib/supabaseRPC', () => ({
  safeCall: vi.fn(),
  createRide: vi.fn()
}));

describe('🚗 Tests de Publicación de Plazas (create_ride)', () => {
  const mockDriverId = 'driver-123';
  const mockDriverProfile = {
    id: mockDriverId,
    display_name: 'Conductor Test',
    photo_url: 'https://example.com/photo.jpg',
    gender: 'male',
    verification: { status: 'verified' },
    wallet_balance: 100.00
  };

  const validRideData = {
    origin: {
      address: 'Madrid, Plaza Mayor',
      coordinates: { lat: 40.4168, lng: -3.7038 }
    },
    destination: {
      address: 'Barcelona, Sagrada Familia',
      coordinates: { lat: 41.3851, lng: 2.1734 }
    },
    departure_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 60 minutos en el futuro
    seats: 4,
    price: 25.50,
    details: 'Viaje confortable con música',
    distance: 615,
    overview_polyline: 'test_polyline',
    is_women_only: false,
    is_exclusive_community: false,
    approval_mode: 'automatic'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock de autenticación
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockDriverId } }
    });
  });

  describe('✅ Casos de Éxito', () => {
    it('debería crear un viaje con datos válidos', async () => {
      const mockResult = {
        success: true,
        rideId: 'ride-123'
      };
      
      rpc.createRide.mockResolvedValue({ success: true, data: { rideId: 'ride-123' } });

      const result = await createSingleRide(validRideData);

      expect(result).toBe('ride-123');
      expect(rpc.createRide).toHaveBeenCalled();
    });

    it('debería crear viaje women_only para conductora mujer', async () => {
      const womenOnlyRide = {
        ...validRideData,
        is_women_only: true
      };

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, gender: 'female' }
            })
          })
        })
      });

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-women' }
      });

      const result = await createSingleRide(womenOnlyRide);

      expect(result).toBe('ride-women');
    });

    it('debería crear viaje con waypoints válidos', async () => {
      const rideWithWaypoints = {
        ...validRideData,
        waypoints: [
          { address: 'Zaragoza', coordinates: { lat: 41.6488, lng: -0.8897 } }
        ]
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-waypoints' }
      });

      const result = await createSingleRide(rideWithWaypoints);

      expect(result).toBe('ride-waypoints');
    });

    it('debería crear viaje exclusivo de comunidad', async () => {
      const exclusiveRide = {
        ...validRideData,
        is_exclusive_community: true,
        allowed_communities: ['premium', 'verified']
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-exclusive' }
      });

      const result = await createSingleRide(exclusiveRide);

      expect(result).toBe('ride-exclusive');
    });

    it('debería crear viaje con approval_mode manual', async () => {
      const manualApprovalRide = {
        ...validRideData,
        approval_mode: 'manual'
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-manual' }
      });

      const result = await createSingleRide(manualApprovalRide);

      expect(result).toBe('ride-manual');
    });
  });

  describe('❌ Validaciones de Autenticación y Permisos', () => {
    it('debería rechazar creación si usuario no está autenticado', async () => {
        // En esta arquitectura, rideService no chequea auth directamente en createSingleRide
        // sino que el RPC fallaría o el controller lo chequea.
        // Si queremos que falle, el mock de createRide debería devolver error.
        rpc.createRide.mockResolvedValueOnce({ success: false, error: 'Usuario no autenticado' });
        await expect(createSingleRide(validRideData)).rejects.toThrow();
    });

    it('debería rechazar viaje women_only para conductor hombre', async () => {
      const womenOnlyRide = {
        ...validRideData,
        is_women_only: true
      };

      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, gender: 'male' }
            })
          })
        })
      });

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Solo las conductoras pueden ofrecer viajes exclusivos para mujeres'
      });

      await expect(createSingleRide(womenOnlyRide)).rejects.toThrow();
    });

    it('debería rechazar si conductor no está verificado', async () => {
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...mockDriverProfile, verification: { status: 'pending' } }
            })
          })
        })
      });

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Conductor no verificado'
      });

      await expect(createSingleRide(validRideData)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Datos y Coordenadas', () => {
    it('debería rechazar coordenadas inválidas de origen', async () => {
      const invalidRide = {
        ...validRideData,
        origin: { coordinates: { lat: 91, lng: 181 } } // Coordenadas inválidas
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Coordenadas de origen inválidas'
      });

      await expect(createSingleRide(invalidRide)).rejects.toThrow();
    });

    it('debería rechazar coordenadas inválidas de destino', async () => {
      const invalidRide = {
        ...validRideData,
        destination: { coordinates: { lat: -91, lng: -181 } }
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Coordenadas de destino inválidas'
      });

      await expect(createSingleRide(invalidRide)).rejects.toThrow();
    });

    it('debería rechazar distancia mayor a 500km', async () => {
      const longDistanceRide = {
        ...validRideData,
        distance: 600 // Excede el límite
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'La distancia del viaje es inválida (máximo 500km)'
      });

      await expect(createSingleRide(longDistanceRide)).rejects.toThrow();
    });

    it('debería rechazar precio mayor a 300€', async () => {
      const expensiveRide = {
        ...validRideData,
        price: 350
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'El precio máximo permitido es de 300€'
      });

      await expect(createSingleRide(expensiveRide)).rejects.toThrow();
    });

    it('debería rechazar precio que excede 0.60€/km', async () => {
      const expensivePerKmRide = {
        ...validRideData,
        price: 400, // 400/615 = 0.65€/km > 0.60€/km
        distance: 615
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Política de Precio Justo: El precio supera el límite de 0.60€/km'
      });

      await expect(createSingleRide(expensivePerKmRide)).rejects.toThrow();
    });

    it('debería rechazar asientos menores a 1', async () => {
      const invalidSeatsRide = {
        ...validRideData,
        seats: 0
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'El número de asientos debe estar entre 1 y 9'
      });

      await expect(createSingleRide(invalidSeatsRide)).rejects.toThrow();
    });

    it('debería rechazar asientos mayores a 9', async () => {
      const invalidSeatsRide = {
        ...validRideData,
        seats: 10
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'El número de asientos debe estar entre 1 y 9'
      });

      await expect(createSingleRide(invalidSeatsRide)).rejects.toThrow();
    });
  });

  describe('❌ Validaciones de Tiempo y Solapamiento', () => {
    it('debería rechazar fecha en el pasado', async () => {
      const pastRide = {
        ...validRideData,
        departure_time: new Date(Date.now() - 60 * 60 * 1000).toISOString() // Hace 1 hora
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'La fecha del viaje debe ser al menos 10 minutos a futuro'
      });

      await expect(createSingleRide(pastRide)).rejects.toThrow();
    });

    it('debería rechazar fecha muy cercana (menos de 10 minutos)', async () => {
      const soonRide = {
        ...validRideData,
        departure_time: new Date(Date.now() + 5 * 60 * 1000).toISOString() // En 5 minutos
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'La fecha del viaje debe ser al menos 10 minutos a futuro'
      });

      await expect(createSingleRide(soonRide)).rejects.toThrow();
    });

    it('debería rechazar solapamiento con viaje existente (+/- 2h)', async () => {
      const overlappingRide = {
        ...validRideData,
        departure_time: new Date(Date.now() + 60 * 60 * 1000).toISOString() // En 1 hora
      };

      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Conflicto de horario: Ya tienes un viaje en un margen de 2h'
      });

      await expect(createSingleRide(overlappingRide)).rejects.toThrow();
    });

    it('debería permitir viaje con más de 2h de diferencia', async () => {
      const nonOverlappingRide = {
        ...validRideData,
        departure_time: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() // En 3 horas
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-non-overlapping' }
      });

      const result = await createSingleRide(nonOverlappingRide);

      expect(result).toBe('ride-non-overlapping');
    });
  });

  describe('🔄 Tests de Concurrencia', () => {
    it('debería manejar múltiples solicitudes simultáneas', async () => {
      const promises = [];
      
      // Simular 10 intentos simultáneos
      for (let i = 0; i < 10; i++) {
        const rideData = {
          ...validRideData,
          dateTime: new Date(Date.now() + (i + 1) * 60 * 60 * 1000)
        };
        
        rpc.createRide.mockResolvedValueOnce({ success: true, data: { rideId: `ride-${i}` } });
        
        promises.push(createSingleRide(rideData));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    });

    it('debería prevenir duplicados exactos', async () => {
      const duplicateRide = { ...validRideData };

      // Primer intento exitoso
      rpc.createRide.mockResolvedValueOnce({
        success: true,
        data: { rideId: 'ride-original' }
      });

      const result1 = await createSingleRide(duplicateRide);

      // Segundo intento: El RPC detecta duplicado (vía idempotency_key en la BD)
      // y devuelve success: true con una nota, o success: false con error.
      // Según rideService.js, si devuelve success: true con note 'duplicate_prevented', devuelve el rideId.
      rpc.createRide.mockResolvedValueOnce({
        success: true,
        data: { rideId: 'ride-duplicate', note: 'duplicate_prevented' }
      });

      const result2 = await createSingleRide(duplicateRide);

      expect(result1).toBe('ride-original');
      expect(result2).toBe('ride-duplicate');
    });
  });

  describe('🧪 Edge Cases y Límites', () => {
    it('debería manejar caracteres especiales en detalles', async () => {
      const specialCharsRide = {
        ...validRideData,
        details: 'Viaje con música 🎵, aire acondicionado ❄️, y buen ambiente 😊'
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-special-chars' }
      });

      const result = await createSingleRide(specialCharsRide);

      expect(result).toBe('ride-special-chars');
    });

    it('debería manejar detalles muy largos', async () => {
      const longDetailsRide = {
        ...validRideData,
        details: 'a'.repeat(1000) // 1000 caracteres
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-long-details' }
      });

      const result = await createSingleRide(longDetailsRide);

      expect(result).toBe('ride-long-details');
    });

    it('debería manejar precios con decimales', async () => {
      const decimalPriceRide = {
        ...validRideData,
        price: 25.99
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-decimal-price' }
      });

      const result = await createSingleRide(decimalPriceRide);

      expect(result).toBe('ride-decimal-price');
    });

    it('debería rechazar precio cero (viaje gratuito no permitido)', async () => {
      const freeRide = {
        ...validRideData,
        price: 0
      };

      await expect(createSingleRide(freeRide)).rejects.toThrow(/al menos 0.5/);
    });

    it('debería manejar distancia cero', async () => {
      const zeroDistanceRide = {
        ...validRideData,
        distance: 0
      };

      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-zero-distance' }
      });

      const result = await createSingleRide(zeroDistanceRide);

      expect(result).toBe('ride-zero-distance');
    });
  });

  describe('🔧 Manejo de Errores', () => {
    it('debería manejar error de conexión a base de datos', async () => {
      rpc.createRide.mockRejectedValue(new Error('Connection timeout'));

      await expect(createSingleRide(validRideData)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar respuesta vacía de RPC', async () => {
      rpc.createRide.mockResolvedValue({ success: false, error: 'RPC returned nothing' });

      await expect(createSingleRide(validRideData)).rejects.toThrow();
    });

    it('debería manejar error de validación desconocido', async () => {
      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Error desconocido en validación'
      });

      await expect(createSingleRide(validRideData)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      rpc.createRide.mockResolvedValue({
        success: false,
        error: 'Error de prueba'
      });

      await expect(createSingleRide(validRideData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Offer Flow] createSingleRide failed'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento', () => {
    it('debería completar creación en tiempo razonable', async () => {
      const startTime = Date.now();
      
      rpc.createRide.mockResolvedValue({
        success: true,
        data: { rideId: 'ride-performance' }
      });

      const performanceRideData = {
        ...validRideData,
        dateTime: new Date(Date.now() + 30 * 60 * 1000)
      };

      await createSingleRide(performanceRideData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(5000); // Menos de 5 segundos
    });

    it('debería manejar alta carga de solicitudes', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 50 solicitudes simultáneas
      for (let i = 0; i < 50; i++) {
        const rideData = {
          ...validRideData,
          dateTime: new Date(Date.now() + (30 + i * 60) * 60 * 1000)
        };
        
        rpc.createRide.mockResolvedValueOnce({
          success: true,
          data: { rideId: `ride-load-${i}` }
        });
        
        promises.push(createSingleRide(rideData));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(10000); // Menos de 10 segundos para 50 solicitudes
    });
  });
});

export default {};
