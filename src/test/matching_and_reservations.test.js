import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

const TEST_DRIVER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PASSENGER_ID = '00000000-0000-0000-0000-000000000002';

// Datos comunes para evitar errores de validación
const COMMON_RIDE_DATA = {
  origin: { name: 'Madrid', address: 'Puerta del Sol', lat: 40.41, lng: -3.70 },
  destination: { name: 'Barcelona', address: 'Sants', lat: 41.38, lng: 2.17 },
  origin_location: 'POINT(-3.70 40.41)',
  destination_location: 'POINT(2.17 41.38)',
  departure_time: new Date(Date.now() + 86400000).toISOString(),
  seats_total: 4,
  seats_available: 4,
  price: 30
};

describe('🚀 Test de Matching Inteligente y Reservas Pro', () => {

  it('1. Debe encontrar viajes por Waypoints (Paradas Intermedias)', async () => {
    const { data: ride, error: insError } = await supabase.from('rides').insert({
      ...COMMON_RIDE_DATA,
      driver_id: TEST_DRIVER_ID,
      waypoints: [{ name: 'Zaragoza', lat: 41.64, lng: -0.88 }]
    }).select().single();

    if (insError) throw insError;

    const { data: results, error: rpcError } = await supabase.rpc('search_rides_secure', {
      p_origin: { lat: 41.64, lng: -0.88 }, // Zaragoza (Waypoint)
      p_destination: { lat: 41.38, lng: 2.17 },
      p_max_dist_meters: 15000
    });

    if (rpcError) throw rpcError;

    const found = results?.some(r => r.id === ride.id);
    expect(found).toBe(true);
    console.log('✅ Búsqueda por Waypoints validada.');
    
    await supabase.from('rides').delete().eq('id', ride.id);
  });

  it('2. Debe calcular el Match Score por Afinidad Social', async () => {
    // 1. Conductor con preferencias específicas
    await supabase.from('profiles').update({ 
      preferences: { pets: 'yes', music: 'rock', smoking: 'no' } 
    }).eq('id', TEST_DRIVER_ID);

    // 2. Crear un viaje para este conductor
    const { data: ride, error: insError } = await supabase.from('rides').insert({
      ...COMMON_RIDE_DATA,
      driver_id: TEST_DRIVER_ID
    }).select().single();

    if (insError) throw insError;

    // 3. Buscar desde el punto de vista del pasajero
    const { data: results, error: rpcError } = await supabase.rpc('search_rides_secure', {
      p_origin: COMMON_RIDE_DATA.origin,
      p_destination: COMMON_RIDE_DATA.destination
    });

    if (rpcError) throw rpcError;

    const bestMatch = results?.find(r => r.id === ride.id);
    expect(bestMatch).toBeDefined();
    expect(bestMatch.match_score).toBeGreaterThan(50);
    console.log('✅ Algoritmo de afinidad social validado.');

    await supabase.from('rides').delete().eq('id', ride.id);
  });

  it('3. Debe disparar Notificación de Plaza Liberada (Waitlist)', async () => {
    // 1. Crear una solicitud pendiente
    const { error: reqError } = await supabase.from('ride_requests').insert({
      requester_id: TEST_PASSENGER_ID,
      origin: COMMON_RIDE_DATA.origin,
      destination: COMMON_RIDE_DATA.destination,
      origin_location: COMMON_RIDE_DATA.origin_location,
      destination_location: COMMON_RIDE_DATA.destination_location,
      departure_time: COMMON_RIDE_DATA.departure_time,
      status: 'pending'
    });

    if (reqError) throw reqError;

    // 2. Crear viaje lleno
    const { data: ride, error: insError } = await supabase.from('rides').insert({
      ...COMMON_RIDE_DATA,
      driver_id: TEST_DRIVER_ID,
      seats_available: 0
    }).select().single();

    if (insError) throw insError;

    // 3. Liberar plaza
    await supabase.from('rides').update({ seats_available: 1 }).eq('id', ride.id);

    // 4. Esperar un poco al trigger y verificar notificación
    await new Promise(r => setTimeout(r, 1000));
    const { data: notify } = await supabase.from('notifications')
      .select('*')
      .eq('user_id', TEST_PASSENGER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    expect(notify?.[0]?.payload?.type).toBe('seat_available');
    console.log('✅ Trigger de lista de espera validado.');
    
    await supabase.from('rides').delete().eq('id', ride.id);
    await supabase.from('ride_requests').delete().eq('requester_id', TEST_PASSENGER_ID);
  });

  it('4. Debe procesar Reservas Multi-plaza correctamente', async () => {
    const { data: ride, error: insError } = await supabase.from('rides').insert({
      ...COMMON_RIDE_DATA,
      driver_id: TEST_DRIVER_ID,
      seats_available: 4
    }).select().single();

    if (insError) throw insError;

    // Reservar 3 plazas
    const { data, error: rpcError } = await supabase.rpc('confirm_trip_and_pay', {
      p_ride_id: ride.id,
      p_seats_to_book: 3
    });

    if (rpcError) throw rpcError;

    const { data: updatedRide } = await supabase.from('rides').select('seats_available, passengers').eq('id', ride.id).single();
    
    expect(updatedRide.seats_available).toBe(1); 
    console.log('✅ Reserva multi-plaza validada.');

    await supabase.from('rides').delete().eq('id', ride.id);
  });

});
