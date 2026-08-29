import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { getCorsHeaders } from "../_shared/cors.ts"

const MIN_PRICE = 0.50
const MAX_PRICE = 300
const MAX_SEATS = 4
const PICKUP_SUPPLEMENT = 1.50
const DETOUR_THRESHOLD_KM = 3
const PRICE_TOLERANCE_RATIO = 0.25
const PRICE_TOLERANCE_ABS = 2

const roundMoney = (value: unknown) => Number(Number(value || 0).toFixed(2))

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

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const jsonResponse = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

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
      dropoffLocation,
      totalAmount,
      pricePerSeat,
      numSeats = 1,
      bookingSignature,
      useWalletBalance = false,
      departureTime,
      departure_time,
    } = await req.json()

    if (!rideId) return jsonResponse({ error: { message: 'ID del viaje requerido' } }, 400)

    const requestedSeats = Number(numSeats)
    const requestedTotal = roundMoney(totalAmount)
    const requestedPricePerSeat = roundMoney(pricePerSeat)

    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > MAX_SEATS) {
      return jsonResponse({ error: { message: 'Número de plazas no válido' } }, 400)
    }
    if (!Number.isFinite(requestedTotal) || requestedTotal < MIN_PRICE || requestedTotal > MAX_PRICE) {
      return jsonResponse({ error: { message: 'Importe de pago no válido' } }, 400)
    }
    if (requestedPricePerSeat > 0 && Math.abs(roundMoney(requestedPricePerSeat * requestedSeats) - requestedTotal) > 0.02) {
      return jsonResponse({ error: { message: 'El importe no coincide con las plazas seleccionadas' } }, 400)
    }

    const pickupLat = getCoord(pickupLocation, 'lat')
    const pickupLng = getCoord(pickupLocation, 'lng')
    const dropoffLat = getCoord(dropoffLocation, 'lat')
    const dropoffLng = getCoord(dropoffLocation, 'lng')
    if (![pickupLat, pickupLng, dropoffLat, dropoffLng].every(Number.isFinite)) {
      return jsonResponse({ error: { message: 'Recogida y destino son obligatorios' } }, 400)
    }

    const { data: ride, error: rideError } = await supabaseClient
      .from('rides')
      .select('id,driver_id,status,seats_available,departure_time,price,distance,origin,destination')
      .eq('id', rideId)
      .single()

    if (rideError || !ride) return jsonResponse({ error: { message: 'Viaje no encontrado' } }, 404)
    if (String(ride.driver_id) === String(user.id)) {
      return jsonResponse({ error: { message: 'No puedes reservar tu propio viaje' } }, 400)
    }
    if (ride.status !== 'scheduled') {
      return jsonResponse({ error: { message: 'Este viaje ya no está disponible para reservar' } }, 409)
    }
    const resolvedDeparture = ride.departure_time || departure_time || departureTime
    if (!resolvedDeparture) {
      return jsonResponse({ error: { message: 'La solicitud necesita fecha y hora de salida' } }, 400)
    }
    if (new Date(resolvedDeparture).getTime() <= Date.now()) {
      return jsonResponse({ error: { message: 'Este viaje ya ha salido o ha expirado' } }, 409)
    }
    if (Number(ride.seats_available || 0) < requestedSeats) {
      return jsonResponse({ error: { message: 'No quedan plazas suficientes' } }, 409)
    }

    const originLat = getCoord(ride.origin, 'lat')
    const originLng = getCoord(ride.origin, 'lng')
    const destLat = getCoord(ride.destination, 'lat')
    const destLng = getCoord(ride.destination, 'lng')
    const rideDistanceKm = Math.max(
      Number(ride.distance) || 0,
      haversineKm(originLat, originLng, destLat, destLng),
      1,
    )
    const ridePrice = roundMoney(ride.price)
    const passengerDistanceKm = Math.max(haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng), 0.5)
    const detourKm = haversineKm(originLat, originLng, pickupLat, pickupLng)
    const supplement = detourKm > DETOUR_THRESHOLD_KM ? PICKUP_SUPPLEMENT : 0
    const expectedTotal = roundMoney(((ridePrice / rideDistanceKm) * passengerDistanceKm + supplement) * requestedSeats)
    const maxAllowed = roundMoney(ridePrice * requestedSeats + PICKUP_SUPPLEMENT * requestedSeats)
    const minAccept = roundMoney(Math.max(MIN_PRICE, expectedTotal * (1 - PRICE_TOLERANCE_RATIO)))
    const maxAccept = roundMoney(Math.min(
      maxAllowed,
      Math.max(expectedTotal * (1 + PRICE_TOLERANCE_RATIO), expectedTotal + PRICE_TOLERANCE_ABS),
    ))

    if (requestedTotal < minAccept || requestedTotal > maxAccept) {
      console.warn('create-booking-payment-intent amount rejected', {
        rideId,
        requestedTotal,
        expectedTotal,
        minAccept,
        maxAccept,
      })
      return jsonResponse({ error: { message: 'El importe no coincide con el precio del viaje' } }, 400)
    }

    const { data: wallet } = await supabaseClient
      .from('wallets')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle()

    const availableBalance = useWalletBalance ? Math.max(0, Number(wallet?.balance || 0)) : 0
    const walletDeduction = roundMoney(Math.min(availableBalance, Math.max(0, requestedTotal - MIN_PRICE)))
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
        expected_total: expectedTotal.toFixed(2),
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
      departure_time: resolvedDeparture,
      pickup_location: pickupLocation ?? null,
      pickup_address: pickupAddress ?? null,
    }, { onConflict: 'ride_id,requester_id' })

    if (requestError) {
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => undefined)
      return jsonResponse({
        error: { message: requestError.message || 'No se pudo preparar la solicitud de reserva' },
      }, 500)
    }

    return jsonResponse({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      summary: {
        total: requestedTotal,
        expected: expectedTotal,
        walletUsed: walletDeduction,
        stripeCharge: stripeChargeAmount,
      },
    })
  } catch (error) {
    console.error('create-booking-payment-intent:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 500)
  }
})
