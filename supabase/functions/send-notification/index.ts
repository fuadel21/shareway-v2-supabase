import { serve } from 'https://deno.land/std@0.131.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { requireUser, isInternalWebhook, unauthorized } from '../_shared/auth.ts'

const FCM_API_URL = 'https://fcm.googleapis.com/fcm/send'
const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY')

// SEGURIDAD: antes esta funcion no pedia ninguna credencial y cualquiera
// podia enviar pushes arbitrarios a cualquier usuario (spam/phishing).
// Ahora exige sesion (y un usuario solo puede enviarse pushes a si mismo)
// o el secreto interno de los triggers de la BD (x-sw-webhook).
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const user = await requireUser(req)
  const internal = isInternalWebhook(req)
  if (!user && !internal) return unauthorized(corsHeaders)
  if (!FCM_SERVER_KEY) {
    return new Response(JSON.stringify({ error: 'Push no configurado' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { userId, payload } = await req.json()

    if (!userId || !payload) {
      return new Response(JSON.stringify({ error: 'Missing userId or payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!internal && userId !== user?.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('fcm_token')
      .eq('id', userId)
      .single()

    if (profileError || !profile?.fcm_token) {
      throw new Error(`Could not find FCM token for user ${userId}`)
    }

    const fcmPayload = {
      to: profile.fcm_token,
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon || 'https://www.shareway.app/favicon.ico',
      },
      data: payload.data || {},
    }

    const fcmResponse = await fetch(FCM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify(fcmPayload),
    })

    if (!fcmResponse.ok) {
        const errorBody = await fcmResponse.text();
        throw new Error(`FCM request failed: ${fcmResponse.statusText} - ${errorBody}`);
    }

    const fcmResult = await fcmResponse.json();

    if (fcmResult.failure > 0) {
        console.error('FCM sending error:', fcmResult.results[0].error);
    }

    return new Response(JSON.stringify({ success: true, result: fcmResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
