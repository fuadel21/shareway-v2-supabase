import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  httpClient: Stripe.createFetchHttpClient()
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId, amount } = await req.json()
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    // 1. Validar y descontar saldo en Supabase preventivamente
    const { data: payoutData, error: payoutError } = await supabaseAdmin.rpc('request_payout_with_deduction', {
      p_user_id: userId,
      p_amount: amount
    })

    if (payoutError) throw payoutError

    // 2. Obtener el ID de cuenta de Stripe
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', userId)
      .single()

    if (profileError) throw profileError

    if (!profile.stripe_account_id) {
      throw new Error('User has no Stripe account linked.')
    }

    // 3. Procesar la transferencia en Stripe
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Ensure cents is integer
      currency: 'eur',
      destination: profile.stripe_account_id,
    })

    return new Response(JSON.stringify({
      success: true,
      transferId: transfer.id,
      remainingBalance: payoutData.remaining_balance
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
