import { serve } from 'https://deno.land/std@0.131.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'fuadel21@hotmail.com'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  // Manejo de CORS (Preflight request)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] 🔔 Notificación de nuevo usuario recibida.`);

  try {
    const payload = await req.json();
    console.log(`[${requestId}] Payload:`, JSON.stringify(payload));

    const record = payload.record || payload.new || payload;
    const type = payload.type || 'new_user';
    const message = payload.message || 'Nueva actividad en ShareWay';

    // Lógica de destinatario dinámico
    let recipientEmail = ADMIN_EMAIL;
    let subject = `🚀 ShareWay: ${message}`;

    if (type === 'new_booking' || type === 'ride_completed') {
      // Buscar el email del conductor/usuario en la DB si viene el ID
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', payload.driver_id)
        .single();

      if (profile?.email) {
        recipientEmail = profile.email;
        subject = type === 'new_booking' ? '¡Nueva Reserva Recibida! 🚗' : '¡Pago Recibido! 💰';
      }
    }

    console.log(`[${requestId}] Enviando email a ${recipientEmail} via Resend...`);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'ShareWay Elite <notifications@resend.dev>',
        to: [recipientEmail],
        subject: subject,
        html: `
          <div style="font-family: sans-serif; padding: 30px; border-radius: 20px; max-width: 600px; margin: auto; color: #0f172a; border: 1px solid #f1f5f9;">
            <img src="https://wmkhutsesgtkcgqbctef.supabase.co/storage/v1/object/public/assets/logo-shareway.png" width="150" style="margin-bottom: 20px;"/>
            <h1 style="color: #10b981; font-size: 24px;">${subject}</h1>
            <p style="font-size: 16px; line-height: 1.6;">Hola,</p>
            <p style="font-size: 16px; line-height: 1.6;">${message}</p>

            <div style="background-color: #f8fafc; padding: 20px; border-radius: 15px; margin: 25px 0; border: 1px solid #e2e8f0;">
              <p style="margin: 5px 0; font-weight: bold;">Detalles del evento:</p>
              <p style="margin: 5px 0; color: #64748b;">ID del Viaje: <code style="font-size: 12px;">${payload.ride_id || 'N/A'}</code></p>
              <p style="margin: 5px 0; color: #64748b;">Fecha: ${new Date().toLocaleString('es-ES')}</p>
            </div>

            <a href="https://shareway.app/my-rides" style="display: inline-block; background-color: #0f172a; color: white; padding: 12px 25px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 14px;">Ver mi actividad</a>

            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">ShareWay Elite - La forma más inteligente de viajar.</p>
          </div>
        `,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error(`[${requestId}] Error de Resend:`, JSON.stringify(result));
      return new Response(JSON.stringify({ error: 'Error enviando email', details: result }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${requestId}] ✅ Email enviado con éxito. ID: ${result.id}`);
    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error(`[${requestId}] ❌ Error crítico:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})
