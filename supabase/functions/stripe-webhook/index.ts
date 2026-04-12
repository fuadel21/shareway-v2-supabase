import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const signature = req.headers.get('stripe-signature')
    if (!signature) return new Response('No signature', { status: 400 })

    try {
        const body = await req.text()
        const event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret)

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        console.log(`🔔 Evento Stripe: ${event.type} [${event.id}]`)

        const paymentIntent = event.data.object as any;
        const stripeId = paymentIntent.id;

        switch (event.type) {
            case 'payment_intent.succeeded':
                // Transición a CAPTURED
                await supabaseAdmin.rpc('transition_financial_status', {
                    p_stripe_id: stripeId,
                    p_new_status: 'captured',
                    p_metadata: { stripe_event_id: event.id }
                });
                
                if (paymentIntent.metadata.type === 'ride_booking') {
                    const walletDeduction = parseFloat(paymentIntent.metadata.wallet_deduction || "0");
                    await supabaseAdmin.rpc('fulfill_booking_after_payment', {
                        p_user_id: paymentIntent.metadata.user_id,
                        p_ride_id: paymentIntent.metadata.ride_id,
                        p_amount: paymentIntent.amount / 100, // Lo cobrado en tarjeta
                        p_payment_intent_id: stripeId,
                        p_wallet_deduction: walletDeduction // Lo del monedero
                    });
                }
                break;

            case 'payment_intent.payment_failed':
                await supabaseAdmin.rpc('transition_financial_status', {
                    p_stripe_id: stripeId,
                    p_new_status: 'failed',
                    p_metadata: { error: paymentIntent.last_payment_error?.message }
                });
                break;

            case 'charge.refunded':
                await supabaseAdmin.rpc('transition_financial_status', {
                    p_stripe_id: paymentIntent.payment_intent,
                    p_new_status: 'refunded',
                    p_metadata: { refund_id: paymentIntent.refunds?.data[0]?.id }
                });
                break;
                
            case 'charge.dispute.created':
                const dispute = event.data.object as any;
                console.log(`🚨 FRAUDE DETECTADO: Chargeback de ${dispute.amount / 100}€ en ${dispute.payment_intent}`);
                // Dispara el bloqueador SQL
                await supabaseAdmin.rpc('handle_stripe_dispute', {
                    p_payment_intent_id: dispute.payment_intent,
                    p_dispute_amount: dispute.amount / 100
                });
                break;
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (err) {
        console.error(`🚨 Error Webhook: ${err.message}`)
        return new Response(JSON.stringify({ error: err.message }), { status: 400 })
    }
})
