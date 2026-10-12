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
export const isInternalWebhook = (req: Request): boolean =>
    req.headers.get('x-sw-webhook') === 'shareway-bookings-2026'

export const unauthorized = (extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    })
