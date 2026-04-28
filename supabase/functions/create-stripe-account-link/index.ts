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
    // Aceptamos return_url opcional desde el body para soportar Deep Links de Capacitor
    const { userId, return_url } = await req.json()

    if (!userId) throw new Error('User ID is required');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', userId)
      .single()

    if (profileError) throw profileError

    let accountId = profile.stripe_account_id

    // 1. Crear cuenta de Stripe Express si no existe
    if (!accountId) {
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (userError) throw userError

      const account = await stripe.accounts.create({
        type: 'express',
        email: userData.user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        settings: {
          payouts: {
            schedule: { interval: 'manual' }
          }
        }
      })
      accountId = account.id
      await supabaseAdmin.from('profiles').update({ stripe_account_id: accountId }).eq('id', userId)
    }

    // 2. Determinar URLs de retorno (Prioridad al body, luego al origin)
    const requestOrigin = req.headers.get('origin') || 'https://shareway.vercel.app';
    const finalReturnUrl = return_url || `${requestOrigin}/settings/payout`;

    // 3. Crear el link de Onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: finalReturnUrl,
      return_url: finalReturnUrl,
      type: 'account_onboarding',
    })

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Stripe Account Link Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
