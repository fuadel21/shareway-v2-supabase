const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.shareway.es',
  'https://shareway.es',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

const extraOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins])
const isArenaPreviewOrigin = (origin: string) => /^https:\/\/[a-z0-9-]+-[a-z0-9]+\.e2b\.app$/i.test(origin)

export const getCorsHeaders = (req?: Request) => {
  const origin = req?.headers.get('origin') || ''
  const allowOrigin = allowedOrigins.has(origin) || isArenaPreviewOrigin(origin)
    ? origin
    : 'https://www.shareway.es'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature, x-shareway-push-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

// Backward-compatible default for functions that do not receive the request yet.
export const corsHeaders = getCorsHeaders()
