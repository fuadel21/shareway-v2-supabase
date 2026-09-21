import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { getCorsHeaders } from "../_shared/cors.ts"

const MIN_PRICE = 0.50
const MAX_BOOKING_TOTAL = 2400
const MAX_SEATS = 8

const roundMoney = (value: unknown) => Number(Number(value || 0).toFixed(2))
const rpcPayload = (value: unknown): Record<string, any> | null => {
  const payload = Array.isArray(value) ? value[0] : value
  return payload && typeof payload === 'object' ? payload as Record<string, any> : null
}

const getCoord = (loc: any, key: 'lat' | 'lng') => {
  const aliases = key === 'lat'
    ? [loc?.lat, loc?.latitude, loc?.coordinates?.lat, loc?.coordinates?.latitude]
    : [loc?.lng, loc?.longitude, loc?.coordinates?.lng, loc?.coordinates?.longitude]

  for (const value of aliases) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }

  return NaN
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const jsonResponse = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: { message: 'Método no permitido' } }, 405)

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecretKey) return jsonResponse({ error: { message: 'Configuración de Stripe incompleta' } }, 503)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return jsonResponse({ error: { message: 'Configuración interna incompleta' } }, 503)

    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const {
      rideId,
      pickupLocation,
      pickupAddress,
      dropoffLocation,
      dropoffAddress,
      totalAmount,
      pricePerSeat,
      numSeats = 1,
      bookingSignature,
      useWalletBalance = false,
    } = await req.json()

    if (!rideId) return jsonResponse({ error: { message: 'ID del viaje requerido' } }, 400)
    if (typeof bookingSignature !== 'string' || !bookingSignature.trim()) {
      return jsonResponse({ error: { message: 'La cotización de reserva es obligatoria' } }, 400)
    }

    const requestedSeats = Number(numSeats)
    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > MAX_SEATS) {
      return jsonResponse({ error: { message: 'Número de plazas no válido' } }, 400)
    }

    const pickupLat = getCoord(pickupLocation, 'lat')
    const pickupLng = getCoord(pickupLocation, 'lng')
    const dropoffLat = getCoord(dropoffLocation, 'lat')
    const dropoffLng = getCoord(dropoffLocation, 'lng')
    if (![pickupLat, pickupLng, dropoffLat, dropoffLng].every(Number.isFinite)) {
      return jsonResponse({ error: { message: 'Recogida y destino son obligatorios' } }, 400)
    }

    // Card payments are deliberately not mixed with wallet funds. A split
    // payment would need a separate, audited debit/escrow operation.
    if (useWalletBalance) {
      return jsonResponse({ error: { message: 'El pago mixto tarjeta + wallet no está disponible' } }, 400)
    }

    const { data: quote, error: quoteError } = await supabaseClient.rpc('quote_ride_booking', {
      p_ride_id: rideId,
      p_pickup_location: pickupLocation,
      p_dropoff_location: dropoffLocation,
      p_num_seats: requestedSeats,
    })

    const resolvedQuote = Array.isArray(quote) ? quote[0] : quote
    if (quoteError) {
      return jsonResponse({ error: { message: quoteError.message || 'No se pudo calcular el precio seguro' } }, 400)
    }
    if (!resolvedQuote?.success) {
      return jsonResponse({
        error: { message: resolvedQuote?.error || 'No se pudo calcular el precio seguro' },
      }, 400)
    }

    const expectedTotal = roundMoney(resolvedQuote.total)
    const requestedTotal = roundMoney(totalAmount)
    const requestedPricePerSeat = roundMoney(pricePerSeat)

    // The client may display/send a quote, but it cannot choose a different
    // amount. The server quote is the only amount written to Stripe and to the
    // durable reservation.
    if (!Number.isFinite(expectedTotal) || expectedTotal < MIN_PRICE || expectedTotal > MAX_BOOKING_TOTAL) {
      return jsonResponse({ error: { message: 'El importe calculado no es válido' } }, 400)
    }
    if (!Number.isFinite(requestedTotal) || requestedTotal !== expectedTotal) {
      return jsonResponse({
        error: { message: 'El importe no coincide con el precio seguro del viaje' },
        quote: { total: expectedTotal },
      }, 400)
    }
    const expectedPricePerSeat = roundMoney(resolvedQuote.price_per_seat)
    if (!Number.isFinite(requestedPricePerSeat)
      || requestedPricePerSeat <= 0
      || !Number.isFinite(expectedPricePerSeat)
      || requestedPricePerSeat !== expectedPricePerSeat) {
      return jsonResponse({ error: { message: 'El importe por plaza no coincide con la cotización segura' } }, 400)
    }

    const signature = String(bookingSignature)
    const prepareReservation = async (previousPaymentIntentId?: string, previousPaymentIntentStatus?: string) => {
      const { data, error } = await supabaseAdmin.rpc('prepare_booking_payment', {
        p_user_id: user.id,
        p_ride_id: rideId,
        p_amount: expectedTotal,
        p_num_seats: requestedSeats,
        p_pickup_location: pickupLocation,
        p_pickup_address: typeof pickupAddress === 'string' ? pickupAddress : null,
        p_dropoff_location: dropoffLocation,
        p_dropoff_address: typeof dropoffAddress === 'string' ? dropoffAddress : null,
        p_booking_signature: signature,
        p_previous_payment_intent_id: previousPaymentIntentId ?? null,
        p_previous_payment_intent_status: previousPaymentIntentStatus ?? null,
      })
      if (error) throw error
      const result = rpcPayload(data)
      if (!result?.success) {
        throw new Error(String(result?.error || 'No se pudo reservar la operación de pago'))
      }
      return result
    }

    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })
    let reservation = await prepareReservation()
    let existingPaymentIntent: Stripe.PaymentIntent | null = null

    if (reservation.payment_intent_id) {
      // The database row is the durable association, but Stripe remains the
      // authority for the current external state. In particular, never send a
      // canceled PaymentIntent back to the client: Stripe idempotency keys are
      // immutable and would otherwise keep returning that canceled object.
      existingPaymentIntent = await stripePaymentIntentRetrieve(
        stripe,
        String(reservation.payment_intent_id),
      )

      if (existingPaymentIntent.status === 'canceled') {
        reservation = await prepareReservation(existingPaymentIntent.id, 'canceled')
      } else {
        const expectedCents = Math.round(expectedTotal * 100)
        if (existingPaymentIntent.amount !== expectedCents
          || existingPaymentIntent.metadata?.ride_id !== String(rideId)
          || existingPaymentIntent.metadata?.user_id !== user.id) {
          console.error('create-booking-payment-intent: durable request does not match Stripe intent', {
            requestId: reservation.request_id,
            paymentIntentId: existingPaymentIntent.id,
          })
          return jsonResponse({
            error: { message: 'El pago pendiente no coincide con la reserva actual' },
          }, 409)
        }

        return jsonResponse({
          clientSecret: existingPaymentIntent.client_secret,
          paymentIntentId: existingPaymentIntent.id,
          summary: {
            total: expectedTotal,
            expected: expectedTotal,
            walletUsed: 0,
            stripeCharge: expectedTotal,
            numSeats: requestedSeats,
          },
          reused: true,
        })
      }
    }

    const recordId = String(reservation.payment_intent_record_id || '')
    const operationKey = String(reservation.operation_key || '')
    if (!recordId || !operationKey) {
      // This should only be possible for a legacy request whose external
      // PaymentIntent is still non-canceled (handled above). Fail closed rather
      // than creating a Stripe object without a durable SQL reservation.
      return jsonResponse({ error: { message: 'No se pudo persistir la reserva de pago' } }, 503)
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(expectedTotal * 100),
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        ride_id: String(rideId),
        user_id: String(user.id),
        request_id: String(reservation.request_id || ''),
        payment_intent_record_id: recordId,
        type: 'ride_booking',
        total_ride_price: expectedTotal.toFixed(2),
        expected_total: expectedTotal.toFixed(2),
        price_per_seat: String(resolvedQuote.price_per_seat),
        num_seats: String(requestedSeats),
        booking_attempt: String(reservation.booking_attempt || 1),
        booking_signature: signature.slice(0, 450),
      },
    }, {
      // This key belongs to the durable reservation attempt. A canceled
      // PaymentIntent receives a new server-generated vN key on replacement.
      idempotencyKey: operationKey,
    })

    const { data: attached, error: attachError } = await supabaseAdmin.rpc('attach_booking_payment_intent', {
      p_payment_intent_record_id: recordId,
      p_stripe_payment_intent_id: paymentIntent.id,
      p_stripe_amount: paymentIntent.amount / 100,
      p_stripe_status: paymentIntent.status,
    })
    if (attachError) {
      // Do not cancel here. The durable reservation and Stripe idempotency key
      // make this exact operation retryable, and a webhook can still reconcile
      // a PaymentIntent created before this request lost its connection.
      console.error('create-booking-payment-intent: cannot attach Stripe intent', attachError)
      return jsonResponse({
        error: { message: 'No se pudo enlazar el pago con la reserva. Inténtalo de nuevo.' },
        retryable: true,
      }, 503)
    }
    const attachedResult = rpcPayload(attached)
    if (!attachedResult?.success) {
      console.error('create-booking-payment-intent: attach rejected', attachedResult)
      return jsonResponse({
        error: { message: String(attachedResult?.error || 'No se pudo enlazar el pago con la reserva') },
        retryable: true,
      }, 503)
    }

    if (paymentIntent.status === 'canceled') {
      // Persist the canceled external state before asking the caller to retry.
      // The next prepare call will see this attempt and allocate a new vN key;
      // it can never replay this canceled PaymentIntent.
      return jsonResponse({
        error: { message: 'Stripe devolvió un PaymentIntent cancelado; inténtalo de nuevo' },
        retryable: true,
      }, 503)
    }

    return jsonResponse({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      summary: {
        total: expectedTotal,
        expected: expectedTotal,
        walletUsed: 0,
        stripeCharge: expectedTotal,
        numSeats: requestedSeats,
      },
    })
  } catch (error) {
    console.error('create-booking-payment-intent:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 500)
  }
})

const stripePaymentIntentRetrieve = async (stripe: Stripe, paymentIntentId: string) => {
  return await stripe.paymentIntents.retrieve(paymentIntentId)
}
