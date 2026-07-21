import { createClient } from '@supabase/supabase-js';
import { createSingleFlightFetch } from './createSingleFlightFetch.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('🛡️ CRÍTICO: Faltan credenciales de Supabase en .env');
}

const protectedFetch = createSingleFlightFetch(globalThis.fetch);

// SINGLETON PATTERN: Eliminamos la cabecera 'global' que causaba el bloqueo de CORS.
// Las RPC críticas comparten una sola petición mientras una operación idéntica siga en curso.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

export const SUPABASE_CONFIG = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
