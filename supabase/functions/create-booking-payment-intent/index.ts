import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

const roundMoney = (value: unknown) => Number(Number(value || 0).toFixed(2))

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecretKey) return jsonResponse({ error: { message: 'Configuración de Stripe incompleta' } }, 503)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const {
      rideId,
      pickupLocation,
      pickupAddress,
      totalAmount,
      pricePerSeat,
      numSeats = 1,
      bookingSignature,
      useWalletBalance = false,
    } = await req.json()

    if (!rideId) return jsonResponse({ error: { message: 'ID del viaje requerido' } }, 400)

    const requestedSeats = Number(numSeats)
    const requestedTotal = roundMoney(totalAmount)
    const requestedPricePerSeat = roundMoney(pricePerSeat)

    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > 4) {
      return jsonResponse({ error: { message: 'Número de plazas no válido' } }, 400)
    }
    if (!Number.isFinite(requestedTotal) || requestedTotal < 0.50 || requestedTotal > 300) {
      return jsonResponse({ error: { message: 'Importe de pago no válido' } }, 400)
    }
    if (requestedPricePerSeat > 0 && Math.abs(roundMoney(requestedPricePerSeat * requestedSeats) - requestedTotal) > 0.02) {
      return jsonResponse({ error: { message: 'El importe no coincide con las plazas seleccionadas' } }, 400)
    }

    const { data: ride, error: rideError } = await supabaseClient
      .from('rides')
      .select('id,driver_id,status,seats_available,departure_time,price')
      .eq('id', rideId)
      .single()

    if (rideError || !ride) return jsonResponse({ error: { message: 'Viaje no encontrado' } }, 404)
    if (String(ride.driver_id) === String(user.id)) {
      return jsonResponse({ error: { message: 'No puedes reservar tu propio viaje' } }, 400)
    }
    if (ride.status !== 'scheduled') {
      return jsonResponse({ error: { message: 'Este viaje ya no está disponible para reservar' } }, 409)
    }
    if (new Date(ride.departure_time).getTime() <= Date.now()) {
      return jsonResponse({ error: { message: 'Este viaje ya ha salido o ha expirado' } }, 409)
    }
    if (Number(ride.seats_available || 0) < requestedSeats) {
      return jsonResponse({ error: { message: 'No quedan plazas suficientes' } }, 409)
    }

    // Una reserva parcial puede costar menos que el trayecto completo. El código
    // anterior la rechazaba siempre que totalAmount era inferior a ride.price.
    const maxExpectedTotal = roundMoney((Number(ride.price) || 0) * requestedSeats + 50)
    if (maxExpectedTotal > 0 && requestedTotal > maxExpectedTotal) {
      return jsonResponse({ error: { message: 'Importe superior al máximo permitido para este viaje' } }, 400)
    }

    const { data: wallet } = await supabaseClient
      .from('wallets')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle()

    const availableBalance = useWalletBalance ? Math.max(0, Number(wallet?.balance || 0)) : 0
    const walletDeduction = roundMoney(Math.min(availableBalance, Math.max(0, requestedTotal - 0.50)))
    const stripeChargeAmount = roundMoney(requestedTotal - walletDeduction)

    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(stripeChargeAmount * 100),
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        ride_id: String(rideId),
        user_id: String(user.id),
        type: 'ride_booking',
        wallet_deduction: walletDeduction.toFixed(2),
        total_ride_price: requestedTotal.toFixed(2),
        num_seats: String(requestedSeats),
        booking_signature: String(bookingSignature || '').slice(0, 450),
      },
    }, {
      idempotencyKey: `booking:${rideId}:${user.id}:${String(bookingSignature || requestedTotal).slice(0, 120)}`,
    })

    const { error: requestError } = await supabaseClient.from('ride_requests').upsert({
      ride_id: rideId,
      requester_id: user.id,
      status: 'pending',
      payment_intent_id: paymentIntent.id,
      amount: requestedTotal,
      pickup_location: pickupLocation ?? null,
      pickup_address: pickupAddress ?? null,
    }, { onConflict: 'ride_id,requester_id' })

    if (requestError) {
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => undefined)
      return jsonResponse({ error: { message: 'No se pudo preparar la solicitud de reserva' } }, 500)
    }

    return jsonResponse({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      summary: {
        total: requestedTotal,
        walletUsed: walletDeduction,
        stripeCharge: stripeChargeAmount,
      },
    })
  } catch (error) {
    console.error('create-booking-payment-intent:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 500)
  }
})
