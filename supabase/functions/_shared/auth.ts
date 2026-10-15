// ============================================================================
// Autenticacion compartida para Edge Functions
// ============================================================================

// Verifica el JWT del llamante contra Supabase Auth.
// Devuelve el usuario o null. supabase-js (functions.invoke) ya manda el
// token de sesion del usuario logueado en el header Authorization.
export const requireUser = async (req: Request): Promise<{ id: string; email?: string } | null> => {
    const auth = req.headers.get('Authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token) return null
    try {
        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
            headers: {
                apikey: Deno.env.get('SUPABASE_ANON_KEY') || '',
                Authorization: `Bearer ${token}`,
            },
        })
        if (!res.ok) return null
        const user = await res.json()
        return user?.id ? user : null
    } catch (_e) {
        return null
    }
}

// Para llamadas internas disparadas por triggers de la BD (pg_net).
// El secreto vive SOLO en los secrets de la Edge Function
// (SW_INTERNAL_WEBHOOK_SECRET) y, en la BD, en private.app_secrets
// (ver supabase/SECURITY_ROTATE_INTERNAL_WEBHOOK_SECRET.sql).
// Nunca debe volver a escribirse en el codigo: el valor anterior quedo
// publicado en el historial git y debe considerarse comprometido.
// Si el secret no esta configurado, se rechaza siempre (fail-closed).
const timingSafeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export const isInternalWebhook = (req: Request): boolean => {
    const secret = Deno.env.get('SW_INTERNAL_WEBHOOK_SECRET') || ''
    const incoming = req.headers.get('x-sw-webhook') || ''
    return secret.length > 0 && timingSafeEqual(incoming, secret)
}

export const unauthorized = (extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    })
