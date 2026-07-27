import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: {},
}));

import { safeCall } from '../supabaseRPC';

describe('safeCall RPC business contract', () => {
  it('reports a direct JSON business failure as unsuccessful', async () => {
    const result = await safeCall(
      () => Promise.resolve({
        data: { success: false, error: 'Saldo insuficiente' },
        error: null,
      }),
      'confirm_trip_and_pay',
      0,
    );

    expect(result).toEqual({
      data: { success: false, error: 'Saldo insuficiente' },
      error: 'Saldo insuficiente',
      success: false,
    });
  });

  it('recognizes a single-row RPC result containing success=false', async () => {
    const result = await safeCall(
      () => Promise.resolve({
        data: [{ success: false, message: 'Reserva ya cancelada' }],
        error: null,
      }),
      'cancel_booking_and_refund',
      0,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Reserva ya cancelada');
  });

  it('preserves successful data responses', async () => {
    const payload = { success: true, ride_id: 'ride-1' };
    const result = await safeCall(
      () => Promise.resolve({ data: payload, error: null }),
      'complete_ride',
      0,
    );

    expect(result).toEqual({
      data: payload,
      error: null,
      success: true,
    });
  });

  it('does not treat ordinary query rows as business failures', async () => {
    const rows = [{ id: 'row-1', status: 'pending' }];
    const result = await safeCall(
      () => Promise.resolve({ data: rows, error: null }),
      'get_payout_requests',
      0,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(rows);
  });

  it('reports malformed transport responses as failures', async () => {
    const result = await safeCall(
      () => Promise.resolve(null),
      'complete_ride',
      0,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Respuesta inválida del servidor');
  });
});
