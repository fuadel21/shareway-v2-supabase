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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return jsonResponse({ error: { message: 'Configuración interna incompleta' } }, 503)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { rideId, reason = 'Cancelación operativa' } = await req.json()
    if (!rideId) return jsonResponse({ error: { message: 'rideId requerido' } }, 400)

    const { data: ride, error: rideError } = await adminClient
      .from('rides')
      .select('id,driver_id,status,departure_time,passengers')
      .eq('id', rideId)
      .single()

    if (rideError || !ride) return jsonResponse({ error: { message: 'Viaje no encontrado' } }, 404)
    if (String(ride.driver_id).toLowerCase() !== user.id.toLowerCase()) {
      return jsonResponse({ error: { message: 'No eres el conductor de este viaje' } }, 403)
    }

    const activePassengers = (Array.isArray(ride.passengers) ? ride.passengers : [])
      .filter(isActivePassenger)
    const externalRefunds: Record<string, {
      operation_key: string
      amount: number
      stripe_refund_id: string
    }> = {}
    const refundWork: Array<{
      passengerId: string
      paymentIntentId: string
      totalPaid: number
      operationKey: string
      prepared: any
    }> = []

    // Validate every stored booking and prepare every external refund before
    // making the first Stripe call. This leaves a durable recovery record for
    // each passenger even if a later Stripe request or SQL transaction fails.
    for (const passenger of activePassengers) {
      const passengerId = getPassengerId(passenger)
      if (!passengerId) return jsonResponse({ error: { message: 'Reserva sin pasajero identificable' } }, 409)

      const bookedPrice = Number(passenger.booked_price)
      const seats = Math.max(1, Number(passenger.seats_booked || passenger.num_seats || passenger.seats || 1))
      if (!Number.isFinite(bookedPrice) || bookedPrice < 0.50 || bookedPrice > 300
        || !Number.isInteger(seats) || seats < 1 || seats > 8) {
        return jsonResponse({ error: { message: 'Datos financieros de reserva no válidos' } }, 409)
      }
      const derivedTotal = roundMoney(bookedPrice * seats)
      const storedPaymentAmount = passenger.payment_amount == null
        ? derivedTotal
        : roundMoney(passenger.payment_amount)
      if (!Number.isFinite(storedPaymentAmount) || storedPaymentAmount !== derivedTotal) {
        return jsonResponse({ error: { message: 'El importe de reserva no coincide con el precio por plaza y las plazas guardadas' } }, 409)
      }
      const totalPaid = derivedTotal
      if (!Number.isFinite(totalPaid) || totalPaid < 0.50 || totalPaid > 2400) {
        return jsonResponse({ error: { message: 'Datos financieros de reserva no válidos' } }, 409)
      }

      const paymentMethod = String(passenger.payment_method || '').toLowerCase()
      const paymentIntentId = String(passenger.payment_intent_id || '')
      const isStripeBooking = ['stripe', 'card', 'credit_card'].includes(paymentMethod) || paymentIntentId.startsWith('pi_')
      if (!isStripeBooking) continue

      if (!paymentIntentId.startsWith('pi_')) {
        return jsonResponse({ error: { message: 'No se puede localizar un pago externo para una reserva' } }, 409)
      }

      const operationKey = `cancel-ride:${rideId}:${passengerId}:${paymentIntentId}`
      const { data: prepared, error: prepareError } = await adminClient.rpc('prepare_stripe_refund_operation', {
        p_operation_key: operationKey,
        p_payment_intent_id: paymentIntentId,
        p_ride_id: rideId,
        p_passenger_id: passengerId,
        p_refund_amount: totalPaid,
        p_metadata: {
          type: 'driver_ride_cancellation',
          policy: 'driver_cancellation_full_refund',
          seats,
        },
      })
      if (prepareError) throw prepareError
      if (!prepared?.success || roundMoney(prepared.refund_amount) !== totalPaid) {
        return jsonResponse({ error: { message: prepared?.error || 'La operación de reembolso persistida no coincide con la reserva' } }, 409)
      }

      refundWork.push({
        passengerId,
        paymentIntentId,
        totalPaid,
        operationKey,
        prepared,
      })
    }

    let stripe: Stripe | null = null
    for (const work of refundWork) {
      const operationStatus = String(work.prepared.status || '').toLowerCase()
      let stripeRefundId = String(work.prepared.stripe_refund_id || '')
      let stripeRefunded = work.totalPaid

      if (!(['refunded', 'settled'].includes(operationStatus) && stripeRefundId)) {
        const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
        if (!stripeSecretKey) return jsonResponse({ error: { message: 'Configuración de Stripe incompleta' } }, 503)
        stripe ??= new Stripe(stripeSecretKey, {
          httpClient: Stripe.createFetchHttpClient(),
        })

        const paymentIntent = await stripe.paymentIntents.retrieve(work.paymentIntentId)
        const chargeAmount = roundMoney(Number(paymentIntent.amount_received || 0) / 100)
        if (chargeAmount !== work.totalPaid) {
          return jsonResponse({ error: { message: 'El pago externo no coincide con el importe de reserva guardado' } }, 409)
        }

        // Keep the captured Stripe evidence durable before issuing the external
        // refund. The SQL cancellation then has an auditable transition even if
        // webhook delivery advances the PaymentIntent to refunded first.
        const { data: captureTransition, error: captureTransitionError } = await adminClient.rpc('transition_financial_status', {
          p_stripe_id: work.paymentIntentId,
          p_new_status: 'captured',
          p_metadata: {
            source: 'cancel-ride-and-refund',
            ride_id: String(rideId),
            user_id: work.passengerId,
            amount: chargeAmount,
            amount_received: chargeAmount,
            currency: paymentIntent.currency,
          },
        })
        if (captureTransitionError || captureTransition?.success !== true) {
          throw captureTransitionError || new Error(captureTransition?.error || 'No se pudo registrar la captura Stripe')
        }

        const refund = await stripe.refunds.create({
          payment_intent: work.paymentIntentId,
          amount: Math.round(work.totalPaid * 100),
          reason: 'requested_by_customer',
          metadata: {
            ride_id: String(rideId),
            passenger_id: work.passengerId,
            type: 'driver_ride_cancellation',
          },
        }, {
          idempotencyKey: `stripe-refund:${work.operationKey}`,
        })
        stripeRefunded = roundMoney(Number(refund.amount || 0) / 100)
        if (stripeRefunded !== work.totalPaid) {
          return jsonResponse({ error: { message: 'Stripe devolvió un importe distinto al reembolso calculado' } }, 409)
        }
        stripeRefundId = refund.id

        const { data: completed, error: completeError } = await adminClient.rpc('complete_stripe_refund_operation', {
          p_operation_key: work.operationKey,
          p_stripe_refund_id: stripeRefundId,
          p_refund_amount: stripeRefunded,
          p_stripe_event_id: null,
          p_metadata: {
            source: 'cancel-ride-and-refund',
            captured_amount: chargeAmount,
            captured_currency: paymentIntent.currency,
          },
        })
        if (completeError) throw completeError
        if (!completed?.success) {
          return jsonResponse({ error: { message: completed?.error || 'No se pudo confirmar el reembolso Stripe' } }, 409)
        }
        stripeRefunded = roundMoney(completed.refund_amount)
      }

      externalRefunds[work.passengerId] = {
        operation_key: work.operationKey,
        amount: stripeRefunded,
        stripe_refund_id: stripeRefundId,
      }
    }

    // This is an internal service-role call. Authenticated users cannot submit
    // a fabricated Stripe refund map through the public RPC surface.
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('cancel_ride_unified', {
      p_ride_id: rideId,
      p_reason: String(reason).slice(0, 500),
      p_external_refunds: externalRefunds,
      p_actor_id: user.id,
    })

    if (rpcError) throw rpcError
    if (rpcResult?.success === false) {
      return jsonResponse({ error: { message: rpcResult.error || rpcResult.message || 'No se pudo cancelar el viaje' } }, 409)
    }

    return jsonResponse({
      success: true,
      message: 'Viaje cancelado y pasajeros reembolsados',
      details: rpcResult,
      stripeRefunded: Object.values(externalRefunds).reduce((sum, value) => sum + value.amount, 0),
    })
  } catch (error) {
    console.error('cancel-ride-and-refund:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 400)
  }
})
