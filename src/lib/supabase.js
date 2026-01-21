import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('🛡️ CRÍTICO: Faltan credenciales de Supabase en .env');
}

// SINGLETON PATTERN: Eliminamos la cabecera 'global' que causaba el bloqueo de CORS
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'sw-auth-storage',
  },
  realtime: {
    params: {
      eventsPerSecond: 5
    }
  }
});

export const SUPABASE_CONFIG = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
