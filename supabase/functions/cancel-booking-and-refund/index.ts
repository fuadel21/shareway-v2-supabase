import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { getCorsHeaders } from "../_shared/cors.ts"

const roundMoney = (value: unknown) => Number(Number(value || 0).toFixed(2))

const getPassengerId = (passenger: any) => String(
  passenger?.id || passenger?.passenger_id || passenger?.user_id || '',
).trim()

const isActivePassenger = (passenger: any) => [
  'confirmed',
  'accepted',
  'pending_boarding',
  'verified',
  'on_board',
  'confirmed_by_pin',
].includes(String(passenger?.status || '').toLowerCase())

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const jsonResponse = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return jsonResponse({ error: { message: 'Configuración interna incompleta' } }, 503)
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const { rideId } = await req.json()
    if (!rideId) return jsonResponse({ error: { message: 'rideId requerido' } }, 400)

    const { data: ride, error: rideError } = await supabaseClient
      .from('rides')
      .select('id,driver_id,status,departure_time,passengers')
      .eq('id', rideId)
      .single()

    if (rideError || !ride) return jsonResponse({ error: { message: 'Viaje no encontrado' } }, 404)

    const passengers = Array.isArray(ride.passengers) ? ride.passengers : []
    const pax = passengers
      .find((candidate: any) => getPassengerId(candidate).toLowerCase() === user.id.toLowerCase() && isActivePassenger(candidate))

    if (!pax) {
      const alreadyCancelled = passengers.some((candidate: any) => (
        getPassengerId(candidate).toLowerCase() === user.id.toLowerCase()
        && ['cancelled', 'canceled'].includes(String(candidate?.status || '').toLowerCase())
      ))
      if (alreadyCancelled) return jsonResponse({ success: true, alreadyCancelled: true, status: 'cancelled' })
      return jsonResponse({ error: { message: 'No tienes una reserva activa en este viaje' } }, 400)
    }

    const bookedPrice = Number(pax.booked_price)
    const seats = Math.max(1, Number(pax.seats_booked || pax.num_seats || pax.seats || 1))
    if (!Number.isFinite(bookedPrice) || bookedPrice < 0.50 || bookedPrice > 300
      || !Number.isInteger(seats) || seats > 8) {
      return jsonResponse({ error: { message: 'Datos de reserva no válidos' } }, 400)
    }

    const derivedTotal = roundMoney(bookedPrice * seats)
    const storedPaymentAmount = pax.payment_amount == null
      ? derivedTotal
      : roundMoney(pax.payment_amount)
    if (!Number.isFinite(storedPaymentAmount) || storedPaymentAmount !== derivedTotal) {
      return jsonResponse({ error: { message: 'El importe de reserva no coincide con el precio por plaza y las plazas guardadas' } }, 409)
    }
    const totalPaid = derivedTotal
    if (!Number.isFinite(totalPaid) || totalPaid < 0.50 || totalPaid > 2400) {
      return jsonResponse({ error: { message: 'Importe de reserva no válido' } }, 400)
    }
    const hoursUntilDeparture = (new Date(ride.departure_time).getTime() - Date.now()) / 3600000
    let refundRatio = 0
    if (hoursUntilDeparture > 24) refundRatio = 1
    else if (hoursUntilDeparture >= 2) refundRatio = 0.5

    let refundAmount = roundMoney(totalPaid * refundRatio)
    const paymentMethod = String(pax.payment_method || '').toLowerCase()
    const paymentIntentId = String(pax.payment_intent_id || '')
    const isStripeBooking = ['stripe', 'card', 'credit_card'].includes(paymentMethod) || paymentIntentId.startsWith('pi_')
    let stripeRefunded = 0
    let refundOperationKey: string | null = null

    if (isStripeBooking && refundAmount > 0) {
      if (!paymentIntentId.startsWith('pi_')) {
        return jsonResponse({ error: { message: 'No se puede localizar el pago externo de esta reserva' } }, 409)
      }

      // Persist the policy decision before any Stripe side effect. The key is
      // stable across retries, so a retry after the 24h/2h boundary reuses the
      // original amount instead of recalculating a different refund.
      refundOperationKey = `cancel-booking:${rideId}:${user.id}:${paymentIntentId}`
      const { data: prepared, error: prepareError } = await adminClient.rpc('prepare_stripe_refund_operation', {
        p_operation_key: refundOperationKey,
        p_payment_intent_id: paymentIntentId,
        p_ride_id: rideId,
        p_passenger_id: user.id,
        p_refund_amount: refundAmount,
        p_metadata: {
          type: 'ride_cancellation',
          policy: 'passenger_cancellation',
          computed_refund_percent: refundRatio,
          seats,
        },
      })
      if (prepareError) throw prepareError
      if (!prepared?.success) {
        return jsonResponse({ error: { message: prepared?.error || 'No se pudo preparar el reembolso' } }, 409)
      }
      refundAmount = roundMoney(prepared.refund_amount)
      if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > totalPaid) {
        return jsonResponse({ error: { message: 'La operación de reembolso persistida no es válida' } }, 409)
      }

      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
      if (!stripeSecretKey) return jsonResponse({ error: { message: 'Configuración de Stripe incompleta' } }, 503)

      const operationStatus = String(prepared.status || '').toLowerCase()
      if (['refunded', 'settled'].includes(operationStatus) && prepared.stripe_refund_id) {
        stripeRefunded = refundAmount
      } else {
        const stripe = new Stripe(stripeSecretKey, {
          httpClient: Stripe.createFetchHttpClient(),
        })
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
        const chargeAmount = roundMoney(Number(paymentIntent.amount_received || 0) / 100)
        if (chargeAmount !== totalPaid || refundAmount > chargeAmount) {
          return jsonResponse({ error: { message: 'El pago externo no coincide con el importe de reserva guardado' } }, 409)
        }

        // Persist the captured amount before the refund side effect. This closes
        // the race in which charge.refunded reaches the webhook before the
        // cancellation RPC: retries still have a durable capture transition.
        const { data: captureTransition, error: captureTransitionError } = await adminClient.rpc('transition_financial_status', {
          p_stripe_id: paymentIntentId,
          p_new_status: 'captured',
          p_metadata: {
            source: 'cancel-booking-and-refund',
            ride_id: String(rideId),
            user_id: user.id,
            amount: chargeAmount,
            amount_received: chargeAmount,
            currency: paymentIntent.currency,
          },
        })
        if (captureTransitionError || captureTransition?.success !== true) {
          throw captureTransitionError || new Error(captureTransition?.error || 'No se pudo registrar la captura Stripe')
        }

        const refund = await stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: Math.round(refundAmount * 100),
          reason: 'requested_by_customer',
          metadata: { ride_id: String(rideId), user_id: user.id, type: 'ride_cancellation' },
        }, {
          idempotencyKey: `stripe-refund:${refundOperationKey}`,
        })
        stripeRefunded = roundMoney(Number(refund.amount || 0) / 100)
        if (stripeRefunded !== refundAmount) {
          return jsonResponse({ error: { message: 'Stripe devolvió un importe distinto al reembolso calculado' } }, 409)
        }

        const { data: completed, error: completeError } = await adminClient.rpc('complete_stripe_refund_operation', {
          p_operation_key: refundOperationKey,
          p_stripe_refund_id: refund.id,
          p_refund_amount: stripeRefunded,
          p_stripe_event_id: null,
          p_metadata: {
            source: 'cancel-booking-and-refund',
            captured_amount: chargeAmount,
            captured_currency: paymentIntent.currency,
          },
        })
        if (completeError) throw completeError
        if (!completed?.success) {
          return jsonResponse({ error: { message: completed?.error || 'No se pudo confirmar el reembolso Stripe' } }, 409)
        }
      }
    }

    const { data: rpcResult, error: rpcError } = await adminClient.rpc('cancel_booking_and_refund', {
      p_ride_id: rideId,
      p_stripe_refunded: isStripeBooking ? stripeRefunded : null,
      p_actor_id: user.id,
      p_refund_operation_key: refundOperationKey,
    })

    if (rpcError) throw rpcError
    if (rpcResult?.success === false) {
      return jsonResponse({ error: { message: rpcResult.error || rpcResult.message || 'No se pudo cancelar la reserva' } }, 409)
    }

    return jsonResponse({
      success: true,
      message: 'Cancelación procesada',
      stripeRefunded,
      details: rpcResult,
    })
  } catch (error) {
    console.error('cancel-booking-and-refund:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 400)
  }
})
