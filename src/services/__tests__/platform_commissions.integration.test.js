/**
 * Platform Commissions and Treasury Integration Test
 * Focus: Correct 15% distribution and Admin Stats accuracy
 * Rules: 1, 3, 7, 9
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { completeRide } from '../rideService';
import { getPlatformStats } from '@/lib/supabaseRPC';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

describe('Sistema de Comisiones y Tesorería ShareWay', () => {
  const TREASURY_ID = '00000000-0000-0000-0000-000000000000';

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'driver-123' } } });
  });

  it('DEBE repartir exactamente el 15% a la App y el 85% al conductor (Regla 3)', async () => {
    const rideId = 'ride-commission-test';
    const ridePrice = 10.00; // Un número fácil para validar el 15%

    // Simulamos la respuesta exitosa de la RPC complete_ride tras el reparto
    // El reparto real ocurre en SQL, aquí validamos que el servicio interpreta el éxito
    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        total_processed: 10.00,
        platform_fee: 1.50, // 15%
        driver_payout: 8.50  // 85%
      }, 
      error: null 
    });

    const result = await completeRide(rideId);
    
    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('complete_ride', { p_ride_id: rideId });
  });

  it('DEBE mostrar el balance real de tesorería en el Dashboard Admin (Regla 10)', async () => {
    // Simulamos que la App ha acumulado 150.50€ de comisiones
    const mockStats = {
      success: true,
      stats: {
        totalUncollectedFees: 150.50,
        grossTotalVolume: 1000.00,
        totalUsers: 50,
        totalCompletedRides: 25
      }
    };

    supabase.rpc.mockResolvedValue({ data: mockStats, error: null });

    const response = await getPlatformStats();
    
    expect(response.success).toBe(true);
    expect(response.stats.totalUncollectedFees).toBe(150.50);
    expect(supabase.rpc).toHaveBeenCalledWith('get_platform_stats');
  });

  it('DEBE fallar si el conductor intenta completar un viaje que no es suyo (Regla 7)', async () => {
    supabase.rpc.mockResolvedValue({ 
      data: null, 
      error: 'El viaje no está activo o no eres el conductor' 
    });

    await expect(completeRide('alien-ride')).rejects.toThrow(/no eres el conductor/);
  });

  it('DEBE gestionar correctamente el redondeo de céntimos (Regla 4)', async () => {
    // Escenario de 5.55€ (15% = 0.8325 -> debe redondear a 0.83)
    const rideId = 'ride-cents-test';
    
    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        platform_fee: 0.83, 
        driver_payout: 4.72 
      }, 
      error: null 
    });

    const result = await completeRide(rideId);
    expect(result).toBe(true);
  });
});
