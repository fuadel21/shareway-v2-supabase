import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Legacy endpoint intentionally disabled.
 *
 * Refunds must go through cancel-booking-and-refund or
 * cancel-ride-and-refund. Those flows derive the amount from the locked ride
 * passenger record, apply the canonical 24h/2h policy, use Stripe idempotency
 * keys and finish the SQL state transition atomically. Keeping a second refund
 * calculator here would reintroduce the old booking-grace rule and would allow
 * a caller to select an arbitrary stripe_id/user_id pair.
 */
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const jsonResponse = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error } = await supabaseClient.auth.getUser()
    if (error || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    return jsonResponse({
      error: {
        message: 'Endpoint obsoleto. Usa cancel-booking-and-refund o cancel-ride-and-refund.',
        code: 'LEGACY_REFUND_ENDPOINT_DISABLED',
      },
      userId: user.id,
    }, 410)
  } catch (error) {
    console.error('process-ride-refund legacy endpoint:', error)
    return jsonResponse({ error: { message: 'No se pudo validar la sesión' } }, 401)
  }
})
