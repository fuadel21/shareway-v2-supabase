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
    const { userId } = await req.json()
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_account_id, verification')
      .eq('id', userId)
      .single()

    if (profileError) throw profileError

    if (!profile.stripe_account_id) {
      return new Response(JSON.stringify({ error: 'User has no Stripe account linked.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      })
    }

    const account = await stripe.accounts.retrieve(profile.stripe_account_id)
    const payoutsEnabled = account.payouts_enabled;
    const chargesEnabled = account.charges_enabled;

    if (payoutsEnabled && chargesEnabled) {
      await supabaseAdmin.from('profiles').update({
        stripe_account_verified: true,
        verification: profile.verification ? { ...profile.verification, stripe_enabled: true } : { stripe_enabled: true }
      }).eq('id', userId)
    }

    return new Response(JSON.stringify({
      success: true,
      isVerified: payoutsEnabled && chargesEnabled
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
