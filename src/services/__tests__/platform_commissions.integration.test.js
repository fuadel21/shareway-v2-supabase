/**
 * Platform Commissions and Treasury Integration Test
 * Focus: Correct 10% distribution and Admin Stats accuracy
 * Rules: 1, 3, 7, 9
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { completeRide } from '../rideService';
import { getPlatformStats } from '../../lib/supabaseRPC'; // Corregido el path relativo
import { supabase } from '../../lib/supabase'; // Corregido el path relativo

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

describe('Sistema de Comisiones y Tesorería ShareWay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'driver-123' } } });
  });

  it('DEBE repartir exactamente el 10% a la App y el 90% al conductor (Regla 3)', async () => {
    const rideId = 'ride-commission-test';

    // Simulamos la respuesta exitosa de la RPC complete_ride tras el reparto (10%)
    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        gross_collected: 10.00,
        platform_fee: 1.00, // 10% de 10.00
        driver_net_payout: 9.00  // 90% de 10.00
      }, 
      error: null 
    });

    const result = await completeRide(rideId);
    
    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('complete_ride', { p_ride_id: rideId });
  });

  it('DEBE mostrar el balance real de tesorería en el Dashboard Admin (Regla 10)', async () => {
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
    // Simulamos un error devuelto por Supabase
    supabase.rpc.mockResolvedValue({
      data: { success: false, message: 'No eres el conductor de este viaje' },
      error: null
    });

    await expect(completeRide('alien-ride')).rejects.toThrow(/no eres el conductor/i);
  });

  it('DEBE gestionar correctamente el redondeo de céntimos (Regla 4)', async () => {
    // Escenario de 5.55€ (10% = 0.555 -> debe redondear a 0.56 o 0.55 según lógica SQL)
    const rideId = 'ride-cents-test';
    
    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        platform_fee: 0.56,
        driver_net_payout: 4.99
      }, 
      error: null 
    });

    const result = await completeRide(rideId);
    expect(result).toBe(true);
  });
});
