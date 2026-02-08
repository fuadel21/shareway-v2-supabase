import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

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
            // Sincronizamos metadatos: user_id o passengerId (fallback)
            const user_id = paymentIntent.metadata.user_id || paymentIntent.metadata.passengerId
            const { type, amount, ride_id } = paymentIntent.metadata

            if (type === 'wallet_topup' || (!type && user_id)) {
                console.log(`💰 Processing Wallet Topup for user: ${user_id}`)
                const { data, error } = await supabaseAdmin.rpc('credit_wallet_on_success', {
                    p_user_id: user_id,
                    p_payment_intent_id: paymentIntent.id,
                    p_amount: parseFloat(amount) || (paymentIntent.amount / 100)
                })

                if (error) throw error
                console.log(`✅ Wallet credited successfully:`, data)
            }

            if (type === 'ride_booking' && ride_id && user_id) {
                console.log(`🚗 Fulfilling booking for Ride: ${ride_id} by User: ${user_id}`)

                // 1. Ejecutar cumplimiento atómico (Finanzas + Pasajero en Ride + Status Request)
                const bookingAmount = parseFloat(amount) || (paymentIntent.amount / 100)
                const { error: rpcError } = await supabaseAdmin.rpc('fulfill_booking_after_payment', {
                    p_user_id: user_id,
                    p_ride_id: ride_id,
                    p_amount: bookingAmount,
                    p_payment_intent_id: paymentIntent.id
                })

                if (rpcError) {
                    console.error(`🚨 Fulfillment Error for Ride ${ride_id}:`, rpcError)
                    throw rpcError
                }

                console.log(`✅ Webhook Fulfillment Success for Ride: ${ride_id}`)
            }
        }

        if (event.type === 'account.updated') {
            const account = event.data.object
            console.log(`👤 Stripe Account Updated: ${account.id}`)

            const isVerified = account.payouts_enabled && account.charges_enabled

            // Actualizar perfil basado en stripe_account_id
            const { error } = await supabaseAdmin
                .from('profiles')
                .update({
                    stripe_account_verified: isVerified,
                    verification: { stripe_enabled: isVerified }
                })
                .eq('stripe_account_id', account.id)

            if (error) console.error(`🚨 Error updating profile for account ${account.id}:`, error)
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (error) {
        console.error(`🚨 Webhook Process Error: ${error.message}`)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
