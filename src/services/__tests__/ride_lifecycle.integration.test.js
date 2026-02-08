/**
 * Ride Lifecycle Integration Tests
 * Focus: Publish, Request, and Concurrency (Atomic Operations)
 * Rules: 1, 3, 6, 7, 10
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSingleRide, createRideRequest, fulfillRequest } from '../rideService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn()
    }))
  }
}));

describe('Ciclo de Vida del Viaje: Publicación y Reserva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
  });

  // --- ESCENARIO 1: PUBLICAR PLAZAS ---
  describe('Flujo de Publicación (Offer)', () => {
    it('DEBE crear un viaje correctamente con datos válidos', async () => {
      const validRide = {
        origin: { lat: 40.41, lng: -3.70, address: 'Madrid' },
        destination: { lat: 41.38, lng: 2.17, address: 'Barcelona' },
        dateTime: new Date(Date.now() + 86400000), // Mañana
        seats: 4,
        price: 25,
        distance: 600000,
        overview_polyline: 'abc'
      };

      supabase.rpc.mockResolvedValue({ data: { rideId: 'new-ride-123' }, error: null });

      const rideId = await createSingleRide(validRide);
      
      expect(rideId).toBe('new-ride-123');
      expect(supabase.rpc).toHaveBeenCalledWith('create_ride', expect.objectContaining({
        p_seats: 4,
        p_price: 25
      }));
    });

    it('DEBE rechazar publicaciones con fecha pasada (Regla 3 - Lógica de Negocio)', async () => {
      const pastRide = {
        dateTime: new Date(Date.now() - 10000), // Hace 10 seg
        seats: 4,
        price: 25
      };

      await expect(createSingleRide(pastRide)).rejects.toThrow(/debe programarse con al menos 10 minutos/);
    });
  });

  // --- ESCENARIO 2: SOLICITAR Y ACEPTAR (FULFILL) ---
  describe('Flujo de Solicitud (Request & Fulfill)', () => {
    it('DEBE permitir a un pasajero crear una solicitud de viaje', async () => {
      const requestData = {
        origin: { lat: 40, lng: -3 },
        destination: { lat: 41, lng: 2 },
        dateTime: new Date(Date.now() + 3600000),
        seats: 1,
        price: 15
      };

      supabase.rpc.mockResolvedValue({ data: { requestId: 'req-abc' }, error: null });

      const result = await createRideRequest(requestData);
      expect(result.requestId).toBe('req-abc');
    });

    it('DEBE fallar atómicamente si el pasajero no tiene saldo suficiente (Regla 7)', async () => {
      const request = { id: 'req-1', suggested_price: 50 };
      
      // Simulamos error de la base de datos (RPC fulfill_ride_request)
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: 'El pasajero no tiene saldo suficiente para este viaje.' 
      });

      await expect(fulfillRequest(request)).rejects.toThrow('El pasajero no tiene saldo suficiente');
    });
  });

  // --- ESCENARIO 3: CONCURRENCIA (Regla 6) ---
  describe('Pruebas de Concurrencia y Atomicidad', () => {
    it('DEBE prevenir que dos conductores acepten la misma solicitud simultáneamente', async () => {
      const request = { id: 'req-exclusive', suggested_price: 20 };

      // Simulamos que la primera llamada llega y bloquea, la segunda falla
      supabase.rpc
        .mockResolvedValueOnce({ data: { rideId: 'ride-winner' }, error: null })
        .mockResolvedValueOnce({ data: null, error: 'Esta solicitud ya no está disponible' });

      // Ejecutamos ambas en "paralelo"
      const promise1 = fulfillRequest(request);
      const promise2 = fulfillRequest(request);

      const results = await Promise.allSettled([promise1, promise2]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason.message).toContain('ya fue aceptada por otro conductor');
    });
  });
});
