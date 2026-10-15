import { getCorsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"



const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { 'Content-Type': 'application/json' } },,
)

const roundMoney = (value: unknown) => Number(Number(value || 0).toFixed(2))

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) })
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
  const { data: claimData, error: claimError } = await supabaseAdmin.rpc('claim_stripe_webhook_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload: event,
  })

  if (claimError) {
    console.error('stripe-webhook inbox claim:', claimError)
    return jsonResponse({ received: false, retryable: true, eventId: event.id }, 500)
  }

  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as Record<string, unknown> | null
  if (claim?.success === false) {
    console.error('stripe-webhook inbox claim rejected:', claim)
    return jsonResponse({ received: false, retryable: true, eventId: event.id, error: claim.error }, 500)
  }
  if (claim?.already_processed === true) {
    return jsonResponse({ received: true, alreadyProcessed: true, eventId: event.id })
  }
  if (claim?.already_processing === true || claim?.claimed !== true) {
    // A different worker owns the event, or the inbox did not durably claim it.
    // Returning non-2xx keeps the event retryable instead of acknowledging a
    // potentially lost financial transition.
    return jsonResponse({ received: false, retryable: true, eventId: event.id }, 500)
  }

  const failures: RpcFailure[] = []

  const invokeRpc = async (fn: string, params: Record<string, unknown>) => {
    const { data, error } = await supabaseAdmin.rpc(fn, params)
    return {
      data,
      error,
      businessFailure: error ? null : rpcBusinessFailure(fn, data),
    }
  }

  const runRpc = async (operation: string, fn: string, params: Record<string, unknown>) => {
    const { data, error, businessFailure } = await invokeRpc(fn, params)

    if (error) {
      failures.push(rpcFailure(operation, error))
    } else if (businessFailure) {
      failures.push({ ...businessFailure, operation })
    }

    return data
  }

  const recoverUnfulfillableBooking = async (
    paymentIntent: Stripe.PaymentIntent,
    eventId: string,
    failure: RpcFailure,
  ) => {
    const chargedAmount = roundMoney(Number(paymentIntent.amount_received || 0) / 100)
    const rideId = String(paymentIntent.metadata?.ride_id || '').trim()
    const userId = String(paymentIntent.metadata?.user_id || '').trim()
    if (!Number.isFinite(chargedAmount) || chargedAmount < 0.01 || !rideId || !userId) {
      failures.push({
        operation: 'refund unfulfillable ride booking',
        message: 'El PaymentIntent no contiene importe cobrado o metadatos de reserva válidos',
        code: 'INVALID_CHARGED_AMOUNT_OR_METADATA',
      })
      return
    }

    const operationKey = `booking-fulfillment-failure:${paymentIntent.id}`
    // The recovery outbox is written before Stripe is called. If the worker
    // dies after Stripe accepts the refund, the operation and Stripe key let a
    // later webhook retry finish the SQL ledger without a second refund.
    const { data: prepared, error: prepareError } = await invokeRpc('prepare_stripe_refund_operation', {
      p_operation_key: operationKey,
      p_payment_intent_id: paymentIntent.id,
      p_ride_id: rideId,
      p_passenger_id: userId,
      p_refund_amount: chargedAmount,
      p_metadata: {
        type: 'booking_fulfillment_failure',
        failure: failure.message.slice(0, 400),
        stripe_event_id: eventId,
      },
    })
    if (prepareError) throw prepareError
    const preparedResult = prepared as Record<string, unknown> | null
    if (!preparedResult?.success) {
      failures.push({
        operation: 'prepare unfulfillable ride booking refund',
        message: String(preparedResult?.error || 'No se pudo preparar el reembolso de recuperación'),
      })
      return
    }

    const durableAmount = roundMoney(preparedResult.refund_amount)
    if (durableAmount !== chargedAmount) {
      failures.push({
        operation: 'prepare unfulfillable ride booking refund',
        message: 'La operación de recuperación no coincide con el importe cobrado',
        code: 'REFUND_OPERATION_AMOUNT_MISMATCH',
      })
      return
    }

    let stripeRefundId = String(preparedResult.stripe_refund_id || '')
    let refundedAmount = durableAmount
    const operationStatus = String(preparedResult.status || '').toLowerCase()
    if (!(['refunded', 'settled'].includes(operationStatus) && stripeRefundId)) {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntent.id,
        amount: Math.round(durableAmount * 100),
        reason: 'requested_by_customer',
        metadata: {
          ride_id: rideId,
          user_id: userId,
          type: 'booking_fulfillment_failure',
          failure: failure.message.slice(0, 400),
        },
      }, {
        // Stripe returns the same refund after a retry; SQL can therefore be
        // retried safely even when its first attempt failed after the refund.
        idempotencyKey: `stripe-refund:${operationKey}`,
      })
      const stripeAmount = roundMoney(Number(refund.amount || 0) / 100)
      if (stripeAmount !== durableAmount) {
        failures.push({
          operation: 'refund unfulfillable ride booking',
          message: 'Stripe devolvió un importe distinto al reembolso de recuperación',
          code: 'REFUND_AMOUNT_MISMATCH',
        })
        return
      }
      stripeRefundId = refund.id
      const { data: completed, error: completeError } = await supabaseAdmin.rpc('complete_stripe_refund_operation', {
        p_operation_key: operationKey,
        p_stripe_refund_id: stripeRefundId,
        p_refund_amount: stripeAmount,
        p_stripe_event_id: eventId,
        p_metadata: { source: 'stripe-webhook-recovery' },
      })
      if (completeError) throw completeError
      const completedResult = completed as Record<string, unknown> | null
      if (!completedResult?.success) {
        failures.push({
          operation: 'complete unfulfillable ride booking refund',
          message: String(completedResult?.error || 'No se pudo cerrar la operación de recuperación'),
        })
        return
      }
      refundedAmount = roundMoney(completedResult.refund_amount)
    }

    const { error: recordError, businessFailure: recordFailure } = await invokeRpc(
      'record_unfulfillable_booking_refund',
      {
        p_user_id: userId,
        p_ride_id: rideId,
        p_payment_intent_id: paymentIntent.id,
        p_refund_amount: refundedAmount,
        p_reason: `Cobro revertido: ${failure.message}`,
        p_stripe_event_id: eventId,
        p_refund_operation_key: operationKey,
      },
    )
    if (recordError) {
      failures.push(rpcFailure('record unfulfillable ride booking refund', recordError))
      return
    }
    if (recordFailure) {
      failures.push({ ...recordFailure, operation: 'record unfulfillable ride booking refund' })
      return
    }

    const { error: recoveredTransitionError, businessFailure: recoveredTransitionFailure } = await invokeRpc(
      'transition_financial_status',
      {
        p_stripe_id: paymentIntent.id,
        p_new_status: 'refunded',
        p_metadata: {
          stripe_event_id: eventId,
          ride_id: rideId,
          user_id: userId,
          amount: refundedAmount,
          refund_operation_key: operationKey,
          stripe_refund_id: stripeRefundId,
          recovery: true,
        },
      },
    )
    if (recoveredTransitionError) {
      failures.push(rpcFailure('transition recovered payment to refunded', recoveredTransitionError))
      return
    }
    if (recoveredTransitionFailure) {
      failures.push({ ...recoveredTransitionFailure, operation: 'transition recovered payment to refunded' })
    }
  }

  const recoverableFulfillmentFailures = new Set([
    'NO_SEATS_AVAILABLE',
    'RIDE_ALREADY_DEPARTED',
    'RIDE_NOT_SCHEDULED',
    'PAYMENT_QUOTE_NOT_AVAILABLE',
    'PAYMENT_QUOTE_STALE',
    'PAYMENT_AMOUNT_MISMATCH',
    'PAYMENT_AMOUNT_NOT_STORED',
    'PAYMENT_REQUEST_NOT_FOUND',
  ])

  const finalizeEvent = async (status: 'processed' | 'failed', errorMessage = '') => {
    const { data, error } = await supabaseAdmin.rpc('complete_stripe_webhook_event', {
      p_event_id: event.id,
      p_status: status,
      p_error: errorMessage || null,
    })
    const businessFailure = error ? null : rpcBusinessFailure('complete Stripe webhook event', data)
    return { data, error, businessFailure }
  }

  try {
    console.log(`Stripe event ${event.type} [${event.id}]`)

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const paymentType = paymentIntent.metadata?.type
        // For a succeeded PaymentIntent, amount_received is the only amount
        // accepted as captured money. The requested amount is not evidence of
        // a successful charge and must never be used as a fallback.
        const amountReceivedCents = Number(paymentIntent.amount_received ?? 0)
        const amountReceived = amountReceivedCents / 100

        if (!Number.isInteger(amountReceivedCents) || amountReceivedCents <= 0) {
          failures.push({
            operation: 'transition payment to captured',
            message: 'Stripe no informó un amount_received válido para el cobro',
            code: 'CAPTURED_AMOUNT_REQUIRED',
          })
          break
        }

        const transitionResult = await invokeRpc('transition_financial_status', {
          p_stripe_id: paymentIntent.id,
          p_new_status: 'captured',
          p_metadata: {
            ...paymentIntent.metadata,
            stripe_event_id: event.id,
            amount: amountReceived,
            amount_received: amountReceived,
            currency: paymentIntent.currency,
          },
        })
        if (transitionResult.error) {
          failures.push(rpcFailure('transition payment to captured', transitionResult.error))
          break
        }
        if (transitionResult.businessFailure) {
          failures.push({ ...transitionResult.businessFailure, operation: 'transition payment to captured' })
          // Do not settle a wallet or fulfill a ride after the authoritative
          // captured transition was rejected (for example, amount mismatch).
          break
        }

        if (paymentType === 'wallet_deposit') {
          await runRpc('settle wallet deposit', 'settle_wallet_deposit', {
            p_external_id: paymentIntent.id,
            p_paid_amount: amountReceived,
            p_stripe_event_id: event.id,
          })
        }

        if (paymentType === 'ride_booking') {
          const userId = paymentIntent.metadata.user_id
          const rideId = paymentIntent.metadata.ride_id

          if (!userId || !rideId) {
            failures.push({
              operation: 'fulfill ride booking',
              message: 'Faltan user_id o ride_id en los metadatos del PaymentIntent',
            })
          } else {
            const walletDeduction = Number.parseFloat(paymentIntent.metadata.wallet_deduction || '0')

            const fulfillmentParams = {
              p_user_id: userId,
              p_ride_id: rideId,
              p_amount: amountReceived,
              p_payment_intent_id: paymentIntent.id,
              p_wallet_deduction: Number.isFinite(walletDeduction) ? walletDeduction : 0,
            }
            const { error: fulfillmentError, businessFailure } = await invokeRpc(
              'fulfill_booking_after_payment',
              fulfillmentParams,
            )

            if (fulfillmentError) {
              failures.push(rpcFailure('fulfill ride booking', fulfillmentError))
            } else if (businessFailure) {
              const failureCode = businessFailure.message.toUpperCase()
              if (recoverableFulfillmentFailures.has(failureCode)) {
                await recoverUnfulfillableBooking(paymentIntent, event.id, businessFailure)
              } else {
                failures.push({ ...businessFailure, operation: 'fulfill ride booking' })
              }
            }
          }
        }
        break
      }

      case 'payment_intent.created':
      case 'payment_intent.processing':
      case 'payment_intent.requires_action':
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const statusByEvent: Record<string, string> = {
          'payment_intent.created': 'created',
          'payment_intent.processing': 'processing',
          'payment_intent.requires_action': 'requires_action',
          'payment_intent.canceled': 'canceled',
        }
        await runRpc('transition payment state', 'transition_financial_status', {
          p_stripe_id: paymentIntent.id,
          p_new_status: statusByEvent[event.type],
          p_metadata: {
            ...paymentIntent.metadata,
            stripe_event_id: event.id,
            amount: Number(paymentIntent.amount_received || paymentIntent.amount || 0) / 100,
            currency: paymentIntent.currency,
          },
        })
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        if (paymentIntent.metadata?.type === 'wallet_deposit') {
          await runRpc('mark wallet deposit failed', 'mark_wallet_deposit_failed', {
            p_external_id: paymentIntent.id,
            p_stripe_event_id: event.id,
          })
        } else {
          await runRpc('transition payment to failed', 'transition_financial_status', {
            p_stripe_id: paymentIntent.id,
            p_new_status: 'failed',
            p_metadata: {
              ...paymentIntent.metadata,
              stripe_event_id: event.id,
              amount: Number(paymentIntent.amount_received || paymentIntent.amount || 0) / 100,
              currency: paymentIntent.currency,
              error: paymentIntent.last_payment_error?.message,
            },
          })
        }
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
          // Primero: si es un deposito de cartera, se debita el saldo.
          const refundAmount = roundMoney(
            Number(charge.amount_refunded || charge.amount || 0) / 100,
          )
          const {
            data: reversalData,
            error: reversalError,
            businessFailure: reversalFailure,
          } = await runRpc('reverse wallet deposit refund', 'reverse_wallet_deposit_refund', {
            p_external_id: paymentIntentId,
            p_refund_amount: refundAmount,
            p_stripe_event_id: event.id,
          })
          if (reversalError || reversalFailure) {
            failures.push(reversalFailure || rpcFailure('reverse wallet deposit refund', reversalError))
          } else {
            const reversal = (Array.isArray(reversalData) ? reversalData[0] : reversalData) as
              | Record<string, unknown>
              | null
            if (reversal?.handled) break
          }
          // Si no era un deposito de cartera (p.ej. pago de reserva),
          // se registra la transicion financiera como antes.
          await runRpc('transition payment to refunded', 'transition_financial_status', {
            p_stripe_id: paymentIntentId,
            p_new_status: 'refunded',
            p_metadata: {
              stripe_event_id: event.id,
              amount: Number(charge.amount_refunded || charge.amount || 0) / 100,
              currency: charge.currency,
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
          await runRpc('transition payment to disputed', 'transition_financial_status', {
            p_stripe_id: paymentIntentId,
            p_new_status: 'disputed',
            p_metadata: {
              stripe_event_id: event.id,
              amount: dispute.amount / 100,
              currency: dispute.currency,
            },
          })
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

      const finalized = await finalizeEvent(
        'failed',
        failures.map((failure) => `${failure.operation}: ${failure.message}`).join(' | '),
      )
      if (finalized.error || finalized.businessFailure) {
        console.error('stripe-webhook inbox failure state could not be persisted:', finalized.error || finalized.businessFailure)
      }

      // A non-2xx response tells Stripe to retry the same signed event. The
      // inbox preserves the failure even if Stripe's next attempt is delayed.
      return jsonResponse({
        received: false,
        retryable: true,
        eventId: event.id,
        failures,
      }, 500)
    }

    const finalized = await finalizeEvent('processed')
    if (finalized.error || finalized.businessFailure) {
      const finalizationError = finalized.error?.message || finalized.businessFailure?.message || 'No se pudo cerrar el evento Stripe'
      console.error('stripe-webhook inbox finalization:', finalizationError)
      return jsonResponse({
        received: false,
        retryable: true,
        eventId: event.id,
        error: finalizationError,
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

    const finalized = await finalizeEvent('failed', message)
    if (finalized.error || finalized.businessFailure) {
      console.error('stripe-webhook inbox failure state could not be persisted:', finalized.error || finalized.businessFailure)
    }

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
