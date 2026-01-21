import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  httpClient: Stripe.createFetchHttpClient()
})

serve(async (req) => {
  const { userId, amount } = await req.json()
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  )

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  if (!profile.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'User has no Stripe account' }), { status: 400 })
  }

  const transfer = await stripe.transfers.create({
    amount: amount * 100, // Amount in cents
    currency: 'eur',
    destination: profile.stripe_customer_id,
  });

  return new Response(JSON.stringify({ success: true, transferId: transfer.id }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
