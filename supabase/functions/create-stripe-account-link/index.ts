import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  httpClient: Stripe.createFetchHttpClient()
})

serve(async (req) => {
  const { userId } = await req.json()
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

  let accountId = profile.stripe_customer_id
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: (await supabaseAdmin.auth.admin.getUserById(userId)).data.user.email,
    })
    accountId = account.id
    await supabaseAdmin.from('profiles').update({ stripe_customer_id: accountId }).eq('id', userId)
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${req.headers.get('origin')}/settings/payouts`,
    return_url: `${req.headers.get('origin')}/settings/payouts`,
    type: 'account_onboarding',
  })

  return new Response(JSON.stringify({ url: accountLink.url }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
