import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { getCorsHeaders } from '../_shared/cors.ts'

const jsonResponse = (payload: unknown, headers: Record<string, string>, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...headers, 'Content-Type': 'application/json' } },
)

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, corsHeaders, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

  try {
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

    const { data: adminProfile, error: adminProfileError } = await supabaseUser
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .single()

    if (adminProfileError || (!adminProfile?.is_admin && !['admin', 'super_admin'].includes(adminProfile?.role))) {
      return jsonResponse({ error: 'Solo los administradores pueden procesar pagos.' }, corsHeaders, 403)
    }

    const body = await req.json()
    const payoutId = typeof body?.payoutId === 'string' ? body.payoutId.trim() : ''
    if (!payoutId) return jsonResponse({ error: 'payoutId es obligatorio.' }, corsHeaders, 400)

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecretKey) return jsonResponse({ error: 'Configuración de Stripe incompleta.' }, corsHeaders, 503)
    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: payout, error: payoutError } = await supabaseAdmin
      .from('payout_requests')
      .select('id, user_id, amount, status, stripe_transfer_id')
      .eq('id', payoutId)
      .single()

    if (payoutError || !payout) return jsonResponse({ error: 'Solicitud de retiro no encontrada.' }, corsHeaders, 404)

    if (payout.status === 'completed') {
      return jsonResponse({
        success: true,
        alreadyProcessed: true,
        payoutId,
        transferId: payout.stripe_transfer_id,
      }, corsHeaders)
    }
    if (payout.status !== 'pending') {
      return jsonResponse({ error: 'Esta solicitud ya no está pendiente.' }, corsHeaders, 409)
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', payout.user_id)
      .single()

    if (profileError || !profile?.stripe_account_id) {
      return jsonResponse({ error: 'El conductor no tiene una cuenta de Stripe vinculada.' }, corsHeaders, 400)
    }

    const amount = Number(payout.amount)
    if (!Number.isFinite(amount) || amount < 5 || amount > 3000) {
      return jsonResponse({ error: 'El importe del retiro no es válido.' }, corsHeaders, 400)
    }
    const amountInCents = Math.round(amount * 100)

    // The idempotency key is stable for the database request. If SQL fails
    // after Stripe accepts the transfer, a retry gets the same transfer and can
    // safely finish process_payout.
    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: 'eur',
      destination: profile.stripe_account_id,
      description: `ShareWay Payout: Request ${payoutId}`,
      metadata: { payoutId, user_id: payout.user_id },
    }, {
      idempotencyKey: `payout:${payoutId}`,
    })

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('process_payout', {
      p_payout_id: payoutId,
      p_status: 'completed',
      p_stripe_transfer_id: transfer.id,
    })

    if (rpcError) {
      console.error('process-stripe-payout settlement RPC:', rpcError)
      return jsonResponse({
        error: 'La transferencia se creó, pero falta cerrar el registro interno. Reintenta.',
        transferId: transfer.id,
        retryable: true,
      }, corsHeaders, 500)
    }

    const result = Array.isArray(rpcData) && rpcData.length === 1 ? rpcData[0] : rpcData
    if (!result || result.success !== true) {
      console.error('process-stripe-payout business failure:', result)
      return jsonResponse({
        error: 'La transferencia se creó, pero falta cerrar el registro interno. Reintenta.',
        transferId: transfer.id,
        retryable: true,
      }, corsHeaders, 500)
    }

    return jsonResponse({
      success: true,
      payoutId,
      transferId: transfer.id,
      amount,
    }, corsHeaders)
  } catch (error) {
    console.error('process-stripe-payout:', error)
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Error interno procesando el retiro',
      // Stripe calls use payout:{payoutId}; an unknown network result must be
      // retried so the same transfer can be recovered and SQL can be closed.
      retryable: true,
    }, corsHeaders, 500)
  }
})
