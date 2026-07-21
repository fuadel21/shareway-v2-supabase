import { createClient } from '@supabase/supabase-js';
import { createSingleFlightFetch } from './createSingleFlightFetch.js';
import { installRideSyncRecovery } from './enhanceRideSyncChannel.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('🛡️ CRÍTICO: Faltan credenciales de Supabase en .env');
}

const protectedFetch = createSingleFlightFetch(globalThis.fetch);

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
export const supabase = installRideSyncRecovery(supabaseClient);

export const SUPABASE_CONFIG = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
