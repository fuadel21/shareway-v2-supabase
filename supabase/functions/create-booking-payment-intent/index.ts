import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY');

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const authHeader = req.headers.get('Authorization')!
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) throw new Error('No autorizado')

        const { rideId, pickupLocation, pickupAddress, useWalletBalance, totalAmount } = await req.json()
        if (!rideId) throw new Error('ID del viaje requerido')

        // 1. Obtener detalles del viaje y del usuario (wallet)
        const { data: ride, error: rideError } = await supabaseClient
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single()

        const { data: wallet } = await supabaseClient
            .from('wallets')
            .select('balance')
            .eq('user_id', user.id)
            .single()

        if (rideError || !ride) throw new Error('Viaje no encontrado')
        
        // 2. Calcular Pago Mixto Seguro (Con Desvíos Dinámicos)
        const baseToPay = ride.price
        const totalToPay = totalAmount ? parseFloat(totalAmount) : baseToPay
        
        // Anti-Fraud: Evitar alteración maliciosa
        if (totalToPay < baseToPay || totalToPay > 300) {
             throw new Error('Manipulación de precio detectada')
        }

        const availableBalance = useWalletBalance ? (wallet?.balance || 0) : 0
        
        // Stripe requiere un mínimo de 0.50€ para procesar cargos
        // Si la diferencia es menor a 0.50€, cobramos 0.50€ y el resto sale de la wallet
        const stripeChargeAmount = Math.max(0.50, totalToPay - availableBalance)
        const walletDeduction = Math.max(0, totalToPay - stripeChargeAmount)

        if (!STRIPE_KEY) throw new Error('Configuración de pagos incompleta')

        const stripe = new Stripe(STRIPE_KEY, {
            httpClient: Stripe.createFetchHttpClient(),
        })

        // 3. Crear Payment Intent con METADATOS DE DEDUCCIÓN
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(stripeChargeAmount * 100),
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            metadata: { 
                rideId, 
                user_id: user.id, 
                type: 'ride_booking',
                wallet_deduction: walletDeduction.toFixed(2), // Informamos al webhook cuánto restar
                total_ride_price: totalToPay.toFixed(2)
            }
        })

        // 4. Registrar en ride_requests como pendiente de confirmación de pago
        await supabaseClient.from('ride_requests').upsert({
            ride_id: rideId,
            requester_id: user.id,
            status: 'pending',
            payment_intent_id: paymentIntent.id,
            amount: totalToPay,
            pickup_location: pickupLocation,
            pickup_address: pickupAddress
        }, { onConflict: 'ride_id,requester_id' })

        return new Response(JSON.stringify({ 
            clientSecret: paymentIntent.client_secret,
            summary: {
                total: totalToPay,
                walletUsed: walletDeduction,
                stripeCharge: stripeChargeAmount
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: { message: error.message } }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    }
})
