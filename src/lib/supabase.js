import { createClient } from '@supabase/supabase-js';
import { createSingleFlightFetch } from './createSingleFlightFetch.js';
import { installRideSyncRecovery } from './enhanceRideSyncChannel.js';
import { installRadarPresenceHeartbeat } from './radarPresenceHeartbeat.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('🛡️ CRÍTICO: Faltan credenciales de Supabase en .env');
}

// Timeout global: ninguna peticion a Supabase puede quedar colgada para siempre
// (en moviles con red inestable el fetch sin timeout se cuelga indefinidamente).
const fetchWithTimeout = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const externalSignal = init?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }
  return globalThis.fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const protectedFetch = createSingleFlightFetch(fetchWithTimeout);

// SINGLETON PATTERN: Eliminamos la cabecera 'global' que causaba el bloqueo de CORS.
// Las RPC críticas comparten una sola petición mientras una operación idéntica siga en curso.
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: protectedFetch,
  },
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'sw-auth-storage',
  },
  realtime: {
    params: {
      eventsPerSecond: 5,
    },
  },
});

// RideDetails keeps its normal realtime subscription. This recovery layer only
// requests a fresh secure snapshot after reconnect/focus/online events so both
// driver and passenger recover from any missed seat or passenger update.
const recoveredClient = installRideSyncRecovery(supabaseClient);

// Enabled radar modes stay eligible for matching while the user keeps using the app.
// This heartbeat never enables a radar and never overwrites its stored coordinates.
export const supabase = installRadarPresenceHeartbeat(recoveredClient);

export const SUPABASE_CONFIG = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
