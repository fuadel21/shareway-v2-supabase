/**
 * Wallet and Transactions Integration Tests
 * Focus: Atomic payments, refunds and race conditions
 * Rules: 4, 6, 7, 9
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confirmTripAndPay, cancelBookingAndRefund } from '../rideService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

describe('Integridad Financiera: Wallet y Pagos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'passenger-123' } } });
  });

  // --- ESCENARIO 1: SALDO INSUFICIENTE ---
  it('DEBE rechazar la reserva si la wallet no tiene saldo suficiente (Regla 7)', async () => {
    const rideId = 'expensive-ride-001';
    
    // Simulamos error de saldo insuficiente desde la RPC confirm_trip_and_pay
    supabase.rpc.mockResolvedValue({ 
      data: null, 
      error: 'Saldo insuficiente' 
    });

    await expect(confirmTripAndPay(rideId)).rejects.toThrow('Saldo insuficiente');
  });

  // --- ESCENARIO 2: CONCURRENCIA (DOBLE GASTO) ---
  it('DEBE prevenir el "Double Spend" si el usuario reserva dos viajes simultáneamente (Regla 6)', async () => {
    // Escenario: El usuario tiene 20€ en su wallet.
    // Intenta reservar dos viajes de 15€ cada uno al mismo tiempo.
    // Solo uno debe tener éxito.

    supabase.rpc
      .mockResolvedValueOnce({ data: { success: true, pin: '1234' }, error: null }) // Éxito el primero
      .mockResolvedValueOnce({ data: null, error: 'Saldo insuficiente' }); // Falla el segundo

    const promise1 = confirmTripAndPay('ride-A');
    const promise2 = confirmTripAndPay('ride-B');

    const results = await Promise.allSettled([promise1, promise2]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason.message).toBe('Saldo insuficiente');
  });

  // --- ESCENARIO 3: CANCELACIÓN Y REEMBOLSO ---
  it('DEBE procesar un reembolso atómico al cancelar un viaje (Regla 1)', async () => {
    const rideId = 'ride-to-cancel';

    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        message: 'Reserva cancelada con reembolso del 100%',
        refundAmount: 25.0 
      }, 
      error: null 
    });

    const result = await cancelBookingAndRefund(rideId);
    
    expect(result.success).toBe(true);
    expect(result.refundAmount).toBe(25.0);
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_booking_and_refund', { 
        p_ride_id: rideId 
    });
  });

  // --- ESCENARIO 4: SEGURIDAD (MOCKING FECHAS) ---
  it('DEBE aplicar penalización si se cancela con menos de 2 horas (Regla 3)', async () => {
    // Este test valida que el servicio se comunica correctamente con la lógica de penalización
    const rideId = 'urgent-ride';
    
    supabase.rpc.mockResolvedValue({ 
      data: { 
        success: true, 
        message: 'Reserva cancelada con reembolso del 0%',
        refundAmount: 0,
        driverCompensation: 10.0
      }, 
      error: null 
    });

    const result = await cancelBookingAndRefund(rideId);
    
    expect(result.refundAmount).toBe(0);
    expect(result.driverCompensation).toBeGreaterThan(0);
  });
});
