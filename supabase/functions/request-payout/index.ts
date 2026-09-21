import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const jsonResponse = (payload: unknown, headers: Record<string, string>, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...headers, 'Content-Type': 'application/json' } },
)

const getRpcPayload = (data: unknown): Record<string, unknown> => {
  if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === 'object') {
    return data[0] as Record<string, unknown>
  }
  return data && typeof data === 'object' ? data as Record<string, unknown> : {}
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, corsHeaders, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

    const body = await req.json()
    const amount = Number(body?.amount)
    const idempotencyKey = typeof body?.idempotencyKey === 'string'
      ? body.idempotencyKey.trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160)
      : ''
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ error: 'La cantidad no es válida.' }, corsHeaders, 400)
    }
    if (!idempotencyKey) {
      return jsonResponse({ error: 'La clave de idempotencia es obligatoria.' }, corsHeaders, 400)
    }

    // Identity is derived from the access token. The body userId, if sent by an
    // old client, is intentionally ignored.
    const { data, error } = await supabase.rpc('request_payout', {
      p_amount: Math.round(amount * 100) / 100,
      p_idempotency_key: idempotencyKey,
    })

    if (error) {
      console.error('request-payout RPC:', error)
      return jsonResponse({ error: error.message }, corsHeaders, 400)
    }

    const payload = getRpcPayload(data)
    if (payload.success !== true) {
      return jsonResponse({ error: String(payload.error || 'No se pudo crear la solicitud de retiro.') }, corsHeaders, 400)
    }

    return jsonResponse({
      success: true,
      payoutId: payload.payout_id,
      amount: payload.amount,
      status: payload.status,
      availableBalance: payload.available_balance,
      userId: user.id,
    }, corsHeaders)
  } catch (error) {
    console.error('request-payout:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Error interno' }, corsHeaders, 500)
  }
})
