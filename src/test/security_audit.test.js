import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

describe('🛡️ Test de Integridad y Seguridad ShareWay v2', () => {
  const PASS = 'ShareWayTest2026!';
  const DRIVER_EMAIL = 'driver.elite@shareway.test';

  beforeAll(async () => {
    // Necesitamos estar autenticados para que auth.uid() no sea null en los RPCs
    await supabase.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
  });

  it('1. Debe bloquear saldos negativos (Integrity Shield)', async () => {
    const { error } = await supabase.rpc('create_payout_request', { p_amount: 999999.99 });
    expect(error).toBeDefined();
    // El RPC lanza 'Saldo insuficiente para el retiro.'
    expect(error.message).toMatch(/insuficiente|INTEGRITY_ERROR/i);
  });

  it('3. Debe impedir cancelación de viajes en marcha (Safety Lock)', async () => {
    // Buscamos el viaje 'active' del seed
    const { data: ride } = await supabase.from('rides').select('id').eq('status', 'active').limit(1).single();

    if (ride) {
      const { error } = await supabase.rpc('cancel_ride', { p_ride_id: ride.id });
      expect(error).toBeDefined();
      // Ahora el error será el de estado, no el de NO_AUTORIZADO
      expect(error.message).toMatch(/NO_PUEDES_CANCELAR|activo o completado/i);
      console.log('✅ Bloqueo de cancelación en marcha validado.');
    }
  });

  it('4. Debe aplicar moderación de contenido (Safe Chat)', async () => {
    const { data: userData } = await supabase.auth.getUser();
    const testDriverId = userData.user.id;

    // Insertamos directamente para ver el efecto del trigger BEFORE INSERT
    const { data, error } = await supabase.from('rides').insert({
      driver_id: testDriverId,
      origin: { address: 'Test' },
      destination: { address: 'Test' },
      departure_time: new Date(Date.now() + 86400000).toISOString(),
      seats_total: 4,
      seats_available: 4,
      price: 10,
      details: 'Mi tlf es 600123456'
    }).select().single();

    if (data) {
      expect(data.details).toContain('[NÚMERO PROTEGIDO]');
      console.log('✅ Moderación automática de contenido validada.');
      await supabase.from('rides').delete().eq('id', data.id);
    } else {
      console.error('Error en insert:', error);
      throw error;
    }
  });
});
