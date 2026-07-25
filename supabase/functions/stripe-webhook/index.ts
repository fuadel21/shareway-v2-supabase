import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

type RpcFailure = {
  operation: string
  message: string
  code?: string
  details?: string
}

const rpcFailure = (operation: string, error: any): RpcFailure => ({
  operation,
  message: error?.message || 'Error desconocido de Supabase',
  code: error?.code,
  details: error?.details,
})

const rpcBusinessFailure = (operation: string, data: unknown): RpcFailure | null => {
  const payload = Array.isArray(data) && data.length === 1 ? data[0] : data

  if (!payload || typeof payload !== 'object') return null

  const result = payload as Record<string, unknown>
  if (result.success !== false) return null

  return {
    operation,
    message: String(result.error || result.message || 'La operación financiera fue rechazada por Supabase'),
    code: result.code ? String(result.code) : 'RPC_BUSINESS_FAILURE',
    details: result.details ? String(result.details) : undefined,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405)

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!stripeSecretKey || !endpointSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('stripe-webhook: configuración incompleta')
    return jsonResponse({ error: 'Configuración del webhook incompleta' }, 503)
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return jsonResponse({ error: 'Firma Stripe ausente' }, 400)

  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  })

  let event: Stripe.Event

  try {
    const body = await req.text()
    event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Firma Stripe inválida'
    console.error('stripe-webhook signature:', message)
    return jsonResponse({ error: message }, 400)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
  const failures: RpcFailure[] = []

  const runRpc = async (operation: string, fn: string, params: Record<string, unknown>) => {
    const { data, error } = await supabaseAdmin.rpc(fn, params)

    if (error) {
      failures.push(rpcFailure(operation, error))
      return
    }

    const businessFailure = rpcBusinessFailure(operation, data)
    if (businessFailure) failures.push(businessFailure)
  }

  try {
    console.log(`Stripe event ${event.type} [${event.id}]`)

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        await runRpc('transition payment to captured', 'transition_financial_status', {
          p_stripe_id: paymentIntent.id,
          p_new_status: 'captured',
          p_metadata: { stripe_event_id: event.id },
        })

        if (paymentIntent.metadata?.type === 'ride_booking') {
          const userId = paymentIntent.metadata.user_id
          const rideId = paymentIntent.metadata.ride_id

          if (!userId || !rideId) {
            failures.push({
              operation: 'fulfill ride booking',
              message: 'Faltan user_id o ride_id en los metadatos del PaymentIntent',
            })
          } else {
            const walletDeduction = Number.parseFloat(paymentIntent.metadata.wallet_deduction || '0')

            await runRpc('fulfill ride booking', 'fulfill_booking_after_payment', {
              p_user_id: userId,
              p_ride_id: rideId,
              p_amount: paymentIntent.amount_received / 100,
              p_payment_intent_id: paymentIntent.id,
              p_wallet_deduction: Number.isFinite(walletDeduction) ? walletDeduction : 0,
            })
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        await runRpc('transition payment to failed', 'transition_financial_status', {
          p_stripe_id: paymentIntent.id,
          p_new_status: 'failed',
          p_metadata: {
            stripe_event_id: event.id,
            error: paymentIntent.last_payment_error?.message,
          },
        })
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id

        if (!paymentIntentId) {
          failures.push({
            operation: 'transition payment to refunded',
            message: 'El evento charge.refunded no contiene payment_intent',
          })
        } else {
          await runRpc('transition payment to refunded', 'transition_financial_status', {
            p_stripe_id: paymentIntentId,
            p_new_status: 'refunded',
            p_metadata: {
              stripe_event_id: event.id,
              refund_id: charge.refunds?.data?.[0]?.id,
            },
          })
        }
        break
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute
        const paymentIntentId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id

        if (!paymentIntentId) {
          failures.push({
            operation: 'register Stripe dispute',
            message: 'La disputa no contiene payment_intent',
          })
        } else {
          await runRpc('register Stripe dispute', 'handle_stripe_dispute', {
            p_payment_intent_id: paymentIntentId,
            p_dispute_amount: dispute.amount / 100,
          })
        }
        break
      }

      default:
        console.log(`Stripe event ignored safely: ${event.type}`)
    }

    if (failures.length > 0) {
      console.error('stripe-webhook database failures:', JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        failures,
      }))

      // A non-2xx response tells Stripe to retry the same signed event. Returning
      // 200 here would permanently lose a paid booking, refund or dispute update.
      return jsonResponse({
        received: false,
        retryable: true,
        eventId: event.id,
        failures,
      }, 500)
    }

    return jsonResponse({ received: true, eventId: event.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno procesando el webhook'
    console.error('stripe-webhook processing:', JSON.stringify({
      event_id: event.id,
      event_type: event.type,
      error: message,
    }))

    // Signature was already validated. This is an internal processing failure,
    // so Stripe must retry instead of treating the event as permanently invalid.
    return jsonResponse({
      received: false,
      retryable: true,
      eventId: event.id,
      error: message,
    }, 500)
  }
})