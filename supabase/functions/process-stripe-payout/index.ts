import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    httpClient: Stripe.createFetchHttpClient()
})

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { payoutId } = await req.json()
        const authHeader = req.headers.get('Authorization')!

        // Crear cliente Supabase con el token del admin
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        // 1. Verificar que el usuario es ADMIN
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) throw new Error('No autorizado')

        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('role, is_admin')
            .eq('id', user.id)
            .single()

        if (profileError || (!profile.is_admin && profile.role !== 'admin')) {
            throw new Error('Solo los administradores pueden procesar pagos.')
        }

        // 2. Obtener detalles de la solicitud de retiro
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { data: payout, error: payoutError } = await supabaseAdmin
            .from('payout_requests')
            .select('*, profiles(stripe_account_id)')
            .eq('id', payoutId)
            .single()

        if (payoutError || !payout) throw new Error('Solicitud de retiro no encontrada.')
        if (payout.status !== 'pending') throw new Error('Esta solicitud ya ha sido procesada.')

        const stripeAccountId = payout.profiles?.stripe_account_id
        if (!stripeAccountId) throw new Error('El conductor no tiene una cuenta de Stripe vinculada.')

        // 3. Ejecutar la transferencia en Stripe con LLAVE DE IDEMPOTENCIA
        // Esto garantiza que aunque se llame varias veces, Stripe solo envíe el dinero UNA VEZ.
        const amountInCents = Math.round(parseFloat(payout.amount) * 100)

        console.log(`💸 Initiating safe Stripe transfer of ${payout.amount}€ to ${stripeAccountId}`)

        const transfer = await stripe.transfers.create({
            amount: amountInCents,
            currency: 'eur',
            destination: stripeAccountId,
            description: `ShareWay Payout: Request ${payoutId}`,
            metadata: { payoutId: payoutId, user_id: payout.user_id }
        }, {
            idempotencyKey: `payout_${payoutId}` // <-- BLINDAJE CRÍTICO
        })

        // 4. Actualizar la base de datos a través del RPC existente
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('process_payout', {
            p_payout_id: payoutId,
            p_status: 'completed',
            p_stripe_transfer_id: transfer.id
        })

        if (rpcError) throw rpcError

        return new Response(JSON.stringify({ success: true, transferId: transfer.id }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error('🚨 Payout Error:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
