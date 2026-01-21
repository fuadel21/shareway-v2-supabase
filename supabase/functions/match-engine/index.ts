import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const { table, record } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Extraer destino de forma segura (soporta .address o .name)
    const destName = record.destination?.address || record.destination?.name || 'tu destino';

    if (table === 'rides') {
      const { data: matches, error } = await supabaseAdmin.rpc('find_matching_requests_for_ride', {
        p_ride_id: record.id
      })

      if (error) throw error

      for (const match of (matches || [])) {
        await supabaseAdmin.from('notifications').insert({
          user_id: match.requester_id,
          payload: {
            title: '¡Viaje compatible encontrado!',
            content: `Se ha publicado un viaje que coincide con tu solicitud a ${destName}.`,
            type: 'match',
            data: { ride_id: record.id, request_id: match.id }
          }
        })
      }

    } else if (table === 'ride_requests') {
      const { data: matches, error } = await supabaseAdmin.rpc('find_matching_rides_for_request', {
        p_request_id: record.id
      })

      if (error) throw error

      for (const match of (matches || [])) {
        await supabaseAdmin.from('notifications').insert({
          user_id: match.driver_id,
          payload: {
            title: '¡Pasajero interesado!',
            content: `Un pasajero busca un viaje en tu ruta hacia ${destName}.`,
            type: 'match',
            data: { ride_id: match.id, request_id: record.id }
          }
        })
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('Match Engine Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
