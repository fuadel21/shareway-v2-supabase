import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { corsHeaders } from '../_shared/cors.ts'

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

const activePassengerStatuses = new Set([
  'confirmed',
  'accepted',
  'pending_boarding',
  'verified',
  'completed',
])

const passengerMatches = (passenger: Record<string, unknown>, userId: string) => {
  const id = String(
    passenger?.id ?? passenger?.passenger_id ?? passenger?.user_id ?? '',
  ).toLowerCase()
  const status = String(passenger?.status ?? '').toLowerCase()
  return id === userId.toLowerCase() && activePassengerStatuses.has(status)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: { message: 'Método no permitido' } }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
      return jsonResponse({ error: { message: 'Configuración de recuperación incompleta' } }, 503)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const { rideId, paymentIntentId: localPaymentIntentId } = await req.json()
    if (!rideId) return jsonResponse({ error: { message: 'ID del viaje requerido' } }, 400)

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const [{ data: ride, error: rideError }, { data: request, error: requestError }] = await Promise.all([
      admin
        .from('rides')
        .select('id,participant_ids,passengers,status')
        .eq('id', rideId)
        .maybeSingle(),
      admin
        .from('ride_requests')
        .select('status,payment_intent_id,amount,updated_at')
        .eq('ride_id', rideId)
        .eq('requester_id', user.id)
        .maybeSingle(),
    ])

    if (rideError) throw rideError
    if (requestError) throw requestError
    if (!ride) return jsonResponse({ error: { message: 'Viaje no encontrado' } }, 404)

    const participantIds = Array.isArray(ride.participant_ids) ? ride.participant_ids.map(String) : []
    const passengers = Array.isArray(ride.passengers) ? ride.passengers : []
    const bookingConfirmed = participantIds.includes(String(user.id)) ||
      passengers.some((passenger) => passengerMatches(passenger, user.id))

    if (bookingConfirmed) {
      return jsonResponse({
        state: 'confirmed',
        canDismiss: true,
        bookingConfirmed: true,
        rideStatus: ride.status,
      })
    }

    const paymentIntentId = String(
      localPaymentIntentId || request?.payment_intent_id || '',
    ).trim()

    if (!paymentIntentId) {
      return jsonResponse({
        state: 'retryable',
        canDismiss: true,
        bookingConfirmed: false,
        reason: 'NO_PAYMENT_INTENT_FOUND',
        requestStatus: request?.status ?? null,
      })
    }

    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })

    let paymentIntent: Stripe.PaymentIntent
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    } catch (error) {
      console.error('get-booking-payment-recovery-state retrieve:', error)
      return jsonResponse({
        state: 'unknown',
        canDismiss: false,
        bookingConfirmed: false,
        paymentIntentId,
        reason: 'PAYMENT_STATUS_UNAVAILABLE',
      })
    }

    if (
      String(paymentIntent.metadata?.user_id || '') !== String(user.id) ||
      String(paymentIntent.metadata?.ride_id || '') !== String(rideId)
    ) {
      return jsonResponse({ error: { message: 'El pago no pertenece a esta reserva' } }, 403)
    }

    const status = paymentIntent.status
    const pendingStatuses = new Set([
      'processing',
      'requires_action',
      'requires_capture',
      'requires_confirmation',
    ])
    const retryableStatuses = new Set(['canceled', 'requires_payment_method'])

    if (status === 'succeeded' || pendingStatuses.has(status)) {
      return jsonResponse({
        state: status === 'succeeded' ? 'paid_waiting_booking' : 'pending',
        canDismiss: false,
        bookingConfirmed: false,
        paymentIntentId,
        paymentStatus: status,
        requestStatus: request?.status ?? null,
      })
    }

    if (retryableStatuses.has(status)) {
      return jsonResponse({
        state: 'retryable',
        canDismiss: true,
        bookingConfirmed: false,
        paymentIntentId,
        paymentStatus: status,
        requestStatus: request?.status ?? null,
      })
    }

    return jsonResponse({
      state: 'unknown',
      canDismiss: false,
      bookingConfirmed: false,
      paymentIntentId,
      paymentStatus: status,
      requestStatus: request?.status ?? null,
    })
  } catch (error) {
    console.error('get-booking-payment-recovery-state:', error)
    return jsonResponse({
      error: { message: error instanceof Error ? error.message : 'Error inesperado' },
    }, 500)
  }
})
