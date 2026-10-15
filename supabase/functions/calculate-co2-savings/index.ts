import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * SHARWAY CLIMATE ENGINE v2
 * Audited CO2 Saving Calculator
 */

import { requireUser, unauthorized } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const user = await requireUser(req)
  if (!user) return unauthorized(corsHeaders)

  try {
    const { distance, passengerCount, vehicleMeta } = await req.json()

    // 1. Basic validation
    if (typeof distance !== 'number' || typeof passengerCount !== 'number') {
      throw new Error('Distance and passengerCount are required.')
    }

    // A savings only occurs if there are passengers besides the driver
    if (passengerCount <= 1) {
      return new Response(JSON.stringify({ co2Saved: "0.00", status: 'no_additionality' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 2. Initialize Supabase Admin for RPC call
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Call precise calculation RPC
    const { data: co2Saved, error } = await supabaseAdmin.rpc('get_accurate_co2_savings', {
      p_distance_km: distance,
      p_passenger_count: passengerCount,
      p_vehicle_meta: vehicleMeta || { fuel_type: 'gasoline', efficiency: 7.0 }
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        co2Saved: parseFloat(co2Saved).toFixed(2),
        methodology: 'EEA-Compliant-V2',
        impact_certification: true
      }),
      { }headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
