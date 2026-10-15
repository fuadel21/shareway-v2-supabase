// NOTA: version AUTOCONTENIDA (sin imports locales) para poder pegarla
// directamente en el editor del dashboard de Supabase, que solo admite un
// archivo. Solo la llama el trigger de la BD via pg_net (server-to-server),
// asi que no necesita CORS.
import { serve } from 'https://deno.land/std@0.131.0/http/server.ts'

// ============================================================================
// SHAREWAY · Notificador de emails (Resend)
// ============================================================================
// Tipos de payload (enviados por los triggers de la BD via pg_net):
//   booking_confirmation → email al PASAJERO: has reservado X plazas, PIN, etc.
//   new_booking          → email al CONDUCTOR: te han reservado plaza
//   ride_completed       → email al CONDUCTOR: pago recibido
//   new_user (default)   → email al ADMIN: nuevo usuario registrado
// Todos los datos llegan ya resueltos en el payload (la función no consulta BD).
// ============================================================================

const WEBHOOK_SECRET = Deno.env.get('SW_INTERNAL_WEBHOOK_SECRET') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('EMAIL_FROM') || 'ShareWay <notifications@resend.dev>'
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'fuadel21@hotmail.com'

const esc = (value: unknown) =>
    String(value ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c))

const money = (value: unknown) => {
    const n = Number(value) || 0
    return n.toFixed(2).replace('.', ',') + ' €'
}

const shell = (title: string, body: string) => `
  <div style="font-family: system-ui, -apple-system, sans-serif; background:#f8fafc; padding:24px;">
    <div style="max-width:560px; margin:auto; background:#ffffff; border-radius:24px; overflow:hidden; border:1px solid #e2e8f0;">
      <div style="background:#0f172a; padding:22px 32px;">
        <img src="https://shareway.es/email-logo.png" width="168" alt="ShareWay" style="display:block; margin-bottom:10px;"/>
        <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:900;">${esc(title)}</h1>
      </div>
      <div style="padding:28px 32px; color:#0f172a; font-size:15px; line-height:1.65;">${body}</div>
      <div style="padding:18px 32px; background:#f1f5f9; color:#64748b; font-size:11px; line-height:1.5;">
        Este es un mensaje automático de ShareWay · comparte viaje, comparte gastos.<br/>
        Política de cancelación: +24h reembolso 100% · 2-24h 50% · menos de 2h sin reembolso.
      </div>
    </div>
  </div>`

const row = (label: string, value: string) => `
  <tr>
    <td style="padding:7px 0; color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:1px; width:40%;">${esc(label)}</td>
    <td style="padding:7px 0; color:#0f172a; font-size:14px; font-weight:700;">${value}</td>
  </tr>`

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok')
    }

    const requestId = crypto.randomUUID()

    try {
        // Protección mínima anti-spam: el trigger de la BD envía este encabezado
        if (!WEBHOOK_SECRET || req.headers.get('x-sw-webhook') !== WEBHOOK_SECRET) {
            return new Response(JSON.stringify({ error: 'unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        if (!RESEND_API_KEY) {
            console.warn(`[${requestId}] RESEND_API_KEY no configurada; email omitido`)
            return new Response(JSON.stringify({ ok: true, skipped: 'no_resend_key' }), {
                headers: { 'Content-Type': 'application/json' },
            })
        }

        const p = await req.json()
        const type = String(p.type || 'new_user')

        let to = ADMIN_EMAIL
        let subject = ''
        let html = ''

        if (type === 'booking_confirmation') {
            const pin = String(p.pin || '----')
            to = String(p.to_email || ADMIN_EMAIL)
            subject = `🚗 Reserva confirmada: ${p.origin} → ${p.destination}`
            html = shell(
                '¡Tu plaza está reservada!',
                `
                <p>Hola <b>${esc(p.to_name)}</b>, tu reserva se ha confirmado correctamente.</p>
                <table style="width:100%; border-collapse:collapse;">
                    ${row('Viaje', `${esc(p.origin)} → ${esc(p.destination)}`)}
                    ${row('Salida', esc(p.departure_time))}
                    ${row('Plazas', esc(p.seats))}
                    ${row('Importe pagado', money(p.amount))}
                </table>
                <div style="margin:22px 0; padding:18px; background:#ecfdf5; border:2px dashed #10b981; border-radius:18px; text-align:center;">
                    <p style="margin:0 0 6px; color:#065f46; font-size:11px; font-weight:900; letter-spacing:2px;">TU PIN DE ABORDAJE</p>
                    <p style="margin:0; font-size:34px; font-weight:900; letter-spacing:10px; color:#065f46;">${esc(pin)}</p>
                </div>
                <p style="color:#64748b; font-size:13px;">Presenta este PIN al conductor al subir al vehículo. Puedes ver los detalles del viaje en la app, sección <b>Mis viajes</b>.</p>
                `,
            )
        } else if (type === 'new_booking') {
            to = String(p.to_email || ADMIN_EMAIL)
            subject = `🎉 Nueva reserva: ${p.origin} → ${p.destination}`
            html = shell(
                '¡Tienes una reserva nueva!',
                `
                <p>Hola <b>${esc(p.to_name)}</b>, un pasajero acaba de reservar plaza en tu viaje.</p>
                <table style="width:100%; border-collapse:collapse;">
                    ${row('Viaje', `${esc(p.origin)} → ${esc(p.destination)}`)}
                    ${row('Salida', esc(p.departure_time))}
                    ${row('Pasajero', esc(p.passenger_name))}
                    ${row('Plazas', esc(p.seats))}
                    ${row('Importe', money(p.amount))}
                </table>
                <p style="color:#64748b; font-size:13px;">El importe queda retenido en garantía y se abonará a tu cartera al completar el viaje (90% para ti). Gestiona la reserva desde <b>Mis viajes</b>.</p>
                `,
            )
        } else if (type === 'ride_completed') {
            to = String(p.to_email || ADMIN_EMAIL)
            subject = `💰 Pago recibido: ${money(p.amount)}`
            html = shell(
                'Viaje completado',
                `
                <p>Hola <b>${esc(p.to_name)}</b>, tu viaje ha finalizado y el pago ya está en tu cartera.</p>
                <table style="width:100%; border-collapse:collapse;">
                    ${row('Viaje', `${esc(p.origin)} → ${esc(p.destination)}`)}
                    ${row('Neto para ti', money(p.amount))}
                </table>
                <p style="color:#64748b; font-size:13px;">Puedes solicitar el retiro del saldo desde <b>Ajustes → Pagos</b>.</p>
                `,
            )
        } else {
            // new_user → admin
            const name = p.name || p.display_name || p.record?.display_name || 'Usuario'
            const email = p.email || p.record?.email || 'No proporcionado'
            const userId = p.user_id || p.record?.id || '—'
            subject = `🚀 Nuevo registro: ${name}`
            html = shell(
                'Nuevo usuario en la plataforma',
                `
                <p>Se ha registrado un nuevo miembro en ShareWay.</p>
                <table style="width:100%; border-collapse:collapse;">
                    ${row('Nombre', esc(name))}
                    ${row('Email', esc(email))}
                    ${row('ID Usuario', esc(userId))}
                </table>
                `,
            )
        }

        console.log(`[${requestId}] Enviando email (${type}) a ${to}`)

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({ from: FROM, to: [to], subject, html }),
        })

        const result = await res.text()
        console.log(`[${requestId}] Resend ${res.status}: ${result}`)

        return new Response(JSON.stringify({ ok: res.ok, status: res.status }), {
            status: res.ok ? 200 : 502,
            headers: { 'Content-Type': 'application/json' },
        })
    } catch (error) {
        console.error(`[${requestId}] Error:`, error)
        return new Response(JSON.stringify({ error: String(error) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
})
