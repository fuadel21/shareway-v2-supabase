import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// These are deliberately separate authenticated clients. Never use a
// service-role key in a browser/Vitest client: it bypasses the policies this
// suite is meant to verify. Configure the optional remote suite with:
// SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY,
// SUPABASE_SECURITY_DRIVER_EMAIL/PASSWORD,
// SUPABASE_SECURITY_PASSENGER_EMAIL/PASSWORD,
// SUPABASE_SECURITY_OUTSIDER_EMAIL/PASSWORD, and
// SUPABASE_SECURITY_RIDE_ID (an active test ride). Optional role/lifecycle
// checks use SUPABASE_SECURITY_ADMIN_EMAIL/PASSWORD plus
// SUPABASE_SECURITY_CANCELLED_RIDE_ID/CANCELLED_TOKEN.
const env = (name, viteName = name) => process.env[name] || import.meta.env[viteName] || '';
const testUrl = env('SUPABASE_TEST_URL', 'VITE_SUPABASE_URL');
const anonKey = env('SUPABASE_TEST_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
const rideId = env('SUPABASE_SECURITY_RIDE_ID');
const driverCredentials = {
  email: env('SUPABASE_SECURITY_DRIVER_EMAIL'),
  password: env('SUPABASE_SECURITY_DRIVER_PASSWORD'),
};
const passengerCredentials = {
  email: env('SUPABASE_SECURITY_PASSENGER_EMAIL'),
  password: env('SUPABASE_SECURITY_PASSENGER_PASSWORD'),
};
const outsiderCredentials = {
  email: env('SUPABASE_SECURITY_OUTSIDER_EMAIL'),
  password: env('SUPABASE_SECURITY_OUTSIDER_PASSWORD'),
};
const adminCredentials = {
  email: env('SUPABASE_SECURITY_ADMIN_EMAIL'),
  password: env('SUPABASE_SECURITY_ADMIN_PASSWORD'),
};
const cancelledRideId = env('SUPABASE_SECURITY_CANCELLED_RIDE_ID');
const cancelledToken = env('SUPABASE_SECURITY_CANCELLED_TOKEN');

const remoteSuiteConfigured = Boolean(
  testUrl
  && anonKey
  && rideId
  && driverCredentials.email
  && driverCredentials.password
  && passengerCredentials.email
  && passengerCredentials.password
  && outsiderCredentials.email
  && outsiderCredentials.password
);

const createTestClient = () => createClient(testUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const signIn = async (client, credentials) => {
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error) throw error;
  return data.user;
};

const remoteDescribe = describe.skipIf(!remoteSuiteConfigured);

remoteDescribe('🛡️ Autorización real de seguridad ShareWay', () => {
  let anon;
  let driver;
  let passenger;
  let outsider;
  let admin;
  const hasAdminCredentials = Boolean(adminCredentials.email && adminCredentials.password);

  beforeAll(async () => {
    anon = createTestClient();
    driver = createTestClient();
    passenger = createTestClient();
    outsider = createTestClient();
    admin = hasAdminCredentials ? createTestClient() : null;

    await Promise.all([
      signIn(driver, driverCredentials),
      signIn(passenger, passengerCredentials),
      signIn(outsider, outsiderCredentials),
      ...(admin ? [signIn(admin, adminCredentials)] : []),
    ]);
  });

  it('anon no puede leer rides ni ubicaciones directamente', async () => {
    const [ridesResult, locationsResult] = await Promise.all([
      anon.from('rides').select('*').eq('id', rideId),
      anon.from('ride_locations').select('*').eq('ride_id', rideId),
    ]);

    expect(ridesResult.error ? [] : (ridesResult.data || [])).toEqual([]);
    expect(locationsResult.error ? [] : (locationsResult.data || [])).toEqual([]);
  });

  it('un usuario ajeno no puede leer el viaje ni su ubicación por REST', async () => {
    const [ridesResult, locationsResult] = await Promise.all([
      outsider.from('rides').select('*').eq('id', rideId),
      outsider.from('ride_locations').select('*').eq('ride_id', rideId),
    ]);

    expect(ridesResult.error ? [] : (ridesResult.data || [])).toEqual([]);
    expect(locationsResult.error ? [] : (locationsResult.data || [])).toEqual([]);
  });

  it('el mapa de viajes usa un RPC autenticado y no abre el read model a anon', async () => {
    const [anonMap, outsiderMap] = await Promise.all([
      anon.rpc('get_live_ride_map'),
      outsider.rpc('get_live_ride_map'),
    ]);

    expect(anonMap.error).toBeTruthy();
    expect(outsiderMap.error).toBeNull();
    expect(Array.isArray(outsiderMap.data)).toBe(true);
    const firstRide = outsiderMap.data?.[0];
    if (firstRide) {
      expect(firstRide).not.toHaveProperty('passengers');
      expect(firstRide).not.toHaveProperty('price');
      expect(firstRide).not.toHaveProperty('vehicle_plate');
    }
  });

  it('el conductor puede leer su viaje y el pasajero puede leer solo su ubicación', async () => {
    const [driverRide, passengerRide, driverLocation, passengerLocation] = await Promise.all([
      driver.from('rides').select('id,driver_id,status,passengers').eq('id', rideId).maybeSingle(),
      passenger.from('rides').select('id,status').eq('id', rideId).maybeSingle(),
      driver.from('ride_locations').select('ride_id,latitude,longitude').eq('ride_id', rideId).maybeSingle(),
      passenger.from('ride_locations').select('ride_id,latitude,longitude').eq('ride_id', rideId).maybeSingle(),
    ]);

    expect(driverRide.error).toBeNull();
    expect(driverRide.data?.id).toBe(rideId);
    expect(passengerRide.error).toBeNull();
    expect(passengerRide.data?.id).toBe(rideId);
    expect(driverLocation.error).toBeNull();
    expect(passengerLocation.error).toBeNull();
  });

  it('el RPC público de share no acepta un token inválido y no diferencia el motivo', async () => {
    const { data, error } = await anon.rpc('verify_share_token', {
      p_ride_id: rideId,
      p_token: '0'.repeat(64),
    });

    expect(error).toBeNull();
    expect(data).toEqual({ success: false, error: 'LINK_INVALID_OR_EXPIRED' });
  });

  it('un usuario ajeno no puede escribir una ubicación aunque conozca el ride_id', async () => {
    const { error } = await outsider.rpc('update_ride_location', {
      p_ride_id: rideId,
      p_lat: 39.4699,
      p_lng: -0.3763,
      p_heading: 0,
    });

    // The hardened RPC is intentionally a no-op for an unauthorized driver.
    expect(error).toBeNull();
    const { data } = await outsider.from('ride_locations').select('updated_at').eq('ride_id', rideId).maybeSingle();
    expect(data).toBeNull();
  });

  it.skipIf(!hasAdminCredentials)('un admin puede leer el panel protegido sin abrirlo a usuarios ajenos', async () => {
    const [adminResult, outsiderResult] = await Promise.all([
      admin.from('emergency_alerts').select('id').limit(1),
      outsider.from('emergency_alerts').select('id').eq('ride_id', rideId),
    ]);

    expect(adminResult.error).toBeNull();
    expect(Array.isArray(adminResult.data)).toBe(true);
    expect(outsiderResult.error ? [] : (outsiderResult.data || [])).toEqual([]);
  });

  it.skipIf(!cancelledRideId || !cancelledToken)('un token de viaje cancelado falla con el mismo error genérico', async () => {
    const { data, error } = await anon.rpc('verify_share_token', {
      p_ride_id: cancelledRideId,
      p_token: cancelledToken,
    });

    expect(error).toBeNull();
    expect(data).toEqual({ success: false, error: 'LINK_INVALID_OR_EXPIRED' });
  });
});

// Keep a local test visible in every checkout so an absent remote test
// environment is reported as a deliberate skip rather than a false pass.
describe('🛡️ Configuración de la auditoría remota', () => {
  it('no contiene una clave service-role en el cliente de pruebas', () => {
    expect(import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
