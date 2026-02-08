/**
 * Integration Test: Visibility and Review Integrity
 * Rules Applied: Rule 1, Rule 4, Rule 7, Rule 10
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAvailableRides, searchRides } from '../rideService';
import { submitReviewSecure } from '../ratingService';
import { supabase } from '@/lib/supabase';

// Mock de Supabase para simular respuestas de DB sin tocar producción (Regla 5)
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      uid: vi.fn()
    },
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

describe('Sistema de Visibilidad y Valoraciones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEBE filtrar viajes propios del conductor en el Dashboard (Regla 10 - Fix Visibilidad)', async () => {
    const mockUserId = 'driver-123';
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: mockUserId } } });
    
    // Simulamos que la RPC get_available_rides_v2 filtra correctamente en DB
    // Pero el test valida que el servicio maneja la respuesta
    const mockRides = [
      { id: 'ride-1', driver_id: 'other-user', status: 'scheduled' },
      { id: 'ride-2', driver_id: mockUserId, status: 'scheduled' } // Este no debería mostrarse al conductor
    ];

    supabase.rpc.mockImplementation((fn) => {
      if (fn === 'get_available_rides_v2') {
        return { data: mockRides.filter(r => r.driver_id !== mockUserId), error: null };
      }
    });

    const rides = await getAvailableRides();
    
    expect(rides).toHaveLength(1);
    expect(rides[0].driver_id).not.toBe(mockUserId);
  });

  it('DEBE usar los nombres de columna correctos en reviews para evitar el error "author_id" (Regla 10 - Fix Esquema)', async () => {
    const reviewData = {
      rideId: 'ride-999',
      revieweeId: 'user-target',
      rating: 5,
      comment: 'Excelente viaje'
    };

    // Simulamos éxito de la RPC que usa los nombres correctos
    supabase.rpc.mockResolvedValue({ 
      data: { success: true, review_id: 'new-review-id' }, 
      error: null 
    });

    const result = await submitReviewSecure(reviewData);

    // Verificamos que se llamó a la RPC con los parámetros del nuevo esquema (p_reviewee_id)
    expect(supabase.rpc).toHaveBeenCalledWith('submit_review_secure', expect.objectContaining({
      p_reviewee_id: reviewData.revieweeId,
      p_rating: reviewData.rating
    }));
    
    expect(result.success).toBe(true);
  });

  it('DEBE fallar si el rating está fuera de rango (Regla 7 - Errores de primera clase)', async () => {
    const invalidReview = {
      rideId: 'ride-1',
      revieweeId: 'user-2',
      rating: 6, // Invalido
      comment: 'Muy mal'
    };

    // La RPC devolverá error de check constraint
    supabase.rpc.mockResolvedValue({ 
      data: null, 
      error: 'El rating debe estar entre 1 y 5' 
    });

    await expect(submitReviewSecure(invalidReview)).rejects.toThrow('El rating debe estar entre 1 y 5');
  });
});
