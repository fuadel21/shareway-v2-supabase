import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { getCorsHeaders } from '../_shared/cors.ts'

const MIN_TOP_UP_EUR = 5
const MAX_TOP_UP_EUR = 3000
const ALLOWED_CREDIT_PRICE_IDS = new Set([
  'price_1PFl0SRxcm33Sg25w6a9aUtq',
  'price_1PFl0jRxcm33Sg255VzD22M0',
  'price_1PFl0wRxcm33Sg25bX1yVfKx',
  'price_1PFl1ERxcm33Sg258Jc8E9E2',
])

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

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecretKey) return jsonResponse({ error: 'Configuración de Stripe incompleta.' }, corsHeaders, 503)
    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })

    const body = await req.json()
    const packageId = typeof body?.packageId === 'string' ? body.packageId.trim() : ''
    const requestedIdempotencyKey = typeof body?.idempotencyKey === 'string'
      ? body.idempotencyKey.trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160)
      : ''
    if (!requestedIdempotencyKey) {
      return jsonResponse({ error: 'La clave de idempotencia es obligatoria.' }, 400)
    }
    let amount: number
    let source: 'package' | 'custom'

    if (packageId) {
      if (!ALLOWED_CREDIT_PRICE_IDS.has(packageId)) {
        return jsonResponse({ error: 'El paquete de créditos no está disponible.' }, corsHeaders, 400)
      }
      // The browser sends only the Stripe Price id. The amount is resolved from
      // Stripe, so it cannot be changed by tampering with the request body.
      const price = await stripe.prices.retrieve(packageId)
      if (!price.active || price.type !== 'one_time' || price.currency !== 'eur' || !price.unit_amount) {
        return jsonResponse({ error: 'El paquete de créditos no está disponible.' }, corsHeaders, 400)
      }
      amount = price.unit_amount / 100
      source = 'package'
    } else {
      amount = Number(body?.amount)
      source = 'custom'
    }

    if (!Number.isFinite(amount) || Math.round(amount * 100) !== amount * 100
       || amount < MIN_TOP_UP_EUR || amount > MAX_TOP_UP_EUR) {
      return jsonResponse({
        error: `La recarga debe estar entre ${MIN_TOP_UP_EUR.toFixed(2)} y ${MAX_TOP_UP_EUR.toFixed(2)} EUR.`,
      }, corsHeaders, 400)
    }
    amount = Math.round(amount * 100) / 100

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      metadata: {
        type: 'wallet_deposit',
        user_id: user.id,
        amount_eur: amount.toFixed(2),
        source,
        ...(packageId ? { package_id: packageId } : {}),
      },
      description: `ShareWay wallet top-up for ${user.id}`,
    }, requestedIdempotencyKey ? {
      idempotencyKey: `wallet:${user.id}:${requestedIdempotencyKey}`,
    } : undefined)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { error: intentError } = await supabaseAdmin
      .from('payment_intents')
      .insert({
        user_id: user.id,
        amount,
        currency: 'EUR',
        status: 'pending',
        provider: 'stripe',
        external_id: paymentIntent.id,
      })

    if (intentError) {
      // A retried request with the same Stripe idempotency key returns the same
      // PaymentIntent. Reuse its already persisted deposit intent instead of
      // cancelling a valid client secret.
      const { data: existingIntent } = await supabaseAdmin
        .from('payment_intents')
        .select('user_id, amount, status, financial_status')
        .eq('external_id', paymentIntent.id)
        .maybeSingle()

      if (existingIntent
        && existingIntent.user_id === user.id
        && Number(existingIntent.amount) === amount) {
        if (existingIntent.status === 'pending') {
          return jsonResponse({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount,
            currency: 'eur',
            reused: true,
          }, corsHeaders)
        }

        // The Stripe idempotency key can be retried after the webhook has
        // already credited the wallet. Never cancel a succeeded PaymentIntent
        // just because the second database insert hit the unique external_id.
        if (existingIntent.status === 'completed' || existingIntent.financial_status === 'captured') {
          return jsonResponse({
            success: true,
            alreadyProcessed: true,
            paymentIntentId: paymentIntent.id,
            amount,
            currency: 'eur',
          }, corsHeaders)
        }

        return jsonResponse({
          error: 'Esta recarga ya no está pendiente. Inicia una nueva operación si necesitas volver a intentarlo.',
        }, corsHeaders, 409)
      }

      console.error('create-payment-intent: cannot persist deposit intent', intentError)
      // Do not leave an uncoupled client secret that Stripe could later settle
      // without an auditable wallet intent.
      try {
        if (!['succeeded', 'processing'].includes(paymentIntent.status)) {
          await stripe.paymentIntents.cancel(paymentIntent.id)
        }
      } catch (cancelError) {
        console.error('create-payment-intent: cannot cancel orphan intent', cancelError)
      }
      return jsonResponse({ error: 'No se pudo registrar la recarga. Inténtalo de nuevo.' }, corsHeaders, 503)
    }

    return jsonResponse({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      currency: 'eur',
    }, corsHeaders)
  } catch (error) {
    console.error('create-payment-intent:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'No se pudo iniciar el pago.' }, corsHeaders, 400)
  }
})
