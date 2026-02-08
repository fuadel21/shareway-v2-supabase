-- SHAREWAY V2: NOTIFY DRIVERS FOR STRIPE ONBOARDING
-- Objetivo: Enviar una notificación a todos los conductores que han ofrecido viajes pero no tienen Stripe configurado.
DO $$
DECLARE v_driver RECORD;
v_count INTEGER := 0;
BEGIN FOR v_driver IN
SELECT DISTINCT p.id,
    p.full_name,
    p.display_name
FROM public.profiles p
    JOIN public.rides r ON p.id = r.driver_id
WHERE p.stripe_account_id IS NULL LOOP -- Enviar notificación interna
    PERFORM public.create_notification(
        v_driver.id,
        '💳 ¡Activa tus cobros!',
        'Hola ' || COALESCE(
            v_driver.display_name,
            v_driver.full_name,
            'conductor'
        ) || ', hemos detectado que ofreces viajes pero aún no has configurado Stripe. Actívalo en tus ajustes de perfil para recibir el dinero de tus pasajeros directamente.',
        'warning',
        jsonb_build_object('action', 'open_billing_settings')
    );
v_count := v_count + 1;
END LOOP;
RAISE NOTICE 'Se han enviado % notificaciones de onboarding de Stripe.',
v_count;
END $$;