import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
    const signature = req.headers.get('stripe-signature')

    if (!signature) {
        return new Response('Missing signature', { status: 400 })
    }

    try {
        const body = await req.text()
        const event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret)

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        console.log(`🔔 Webhook received: ${event.type} [${event.id}]`)

        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object
            const { type, user_id, amount, ride_id } = paymentIntent.metadata

            // CASO A: Recarga de Cartera (Wallet Topup)
            if (type === 'wallet_topup' || (!type && user_id)) {
                console.log(`💰 Processing Wallet Topup for user: ${user_id}`)
                
                // Invocamos el RPC de acreditación (El mismo que el frontend, pero desde el servidor)
                // El RPC ya tiene lógica anti-duplicados (idempotencia)
                const { data, error } = await supabaseAdmin.rpc('credit_wallet_on_success', {
                    p_payment_intent_id: paymentIntent.id,
                    p_amount: parseFloat(amount) || (paymentIntent.amount / 100)
                })

                if (error) {
                    console.error(`❌ Error crediting wallet via Webhook: ${error.message}`)
                    throw error
                }
                console.log(`✅ Wallet credited successfully via Webhook:`, data)
            }

            // CASO B: Pago directo de Viaje (Booking)
            if (type === 'ride_booking' && ride_id && user_id) {
                console.log(`🚗 Processing direct booking for Ride: ${ride_id}`)
                
                // Aquí podrías llamar al RPC de confirmación de reserva
                const { error } = await supabaseAdmin
                    .from('ride_requests')
                    .update({ status: 'accepted' })
                    .eq('ride_id', ride_id)
                    .eq('requester_id', user_id)

                if (error) throw error
            }
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error(`🚨 Webhook Process Error: ${error.message}`)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
