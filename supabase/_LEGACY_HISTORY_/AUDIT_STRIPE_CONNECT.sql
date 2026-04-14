-- SHAREWAY V2: STRIPE CONNECT READINESS AUDIT
-- Objetivo: Identificar qué conductores están listos para recibir pagos y cuáles necesitan configurar Stripe.
WITH driver_stats AS (
    -- Contamos cuántos viajes ha ofrecido cada conductor
    SELECT driver_id,
        COUNT(*) as total_offered_rides
    FROM public.rides
    GROUP BY driver_id
)
SELECT p.id as user_id,
    p.full_name,
    p.email,
    COALESCE(ds.total_offered_rides, 0) as rides_count,
    CASE
        WHEN p.stripe_account_id IS NOT NULL
        AND (p.verification->>'stripe_enabled')::boolean = true THEN 'LISTO ✅'
        WHEN p.stripe_account_id IS NOT NULL THEN 'PENDIENTE VERIFICACIÓN ⚠️'
        ELSE 'SIN CONFIGURAR ❌'
    END as stripe_status,
    p.stripe_account_id
FROM public.profiles p
    LEFT JOIN driver_stats ds ON p.id = ds.driver_id
ORDER BY ds.total_offered_rides DESC,
    stripe_status;
-- NOTA: Si ves a muchos conductores en 'SIN CONFIGURAR', 
-- deberías enviarles una notificación push invitándoles a 
-- "Activar Cobros" en sus ajustes de perfil.