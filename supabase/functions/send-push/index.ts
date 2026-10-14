import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import webpush from 'https://esm.sh/web-push@3.6.7';

;

const jsonResponse = (payload: Record<string, unknown>, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
});

const getNotificationRecord = (body: Record<string, unknown>) => {
  const record = body.record || body.notification || body.new || body;
  if (!record || typeof record !== 'object') return null;
  return record as Record<string, unknown>;
};

const getString = (value: unknown, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  return String(value);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    // Limpiar valores mal guardados: comillas envolventes y espacios
    // Por si el valor se guardo con saltos de linea o espacios intercalados
    const cleanSecret = (value: string | undefined) => String(value || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
    const publicKey = cleanSecret(Deno.env.get('VAPID_PUBLIC_KEY'));
    const privateKey = cleanSecret(Deno.env.get('VAPID_PRIVATE_KEY'));
    const subject = cleanSecret(Deno.env.get('VAPID_SUBJECT')).replace(/^mailto:\s+/i, 'mailto:') || 'mailto:fuadel21@hotmail.com';
    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';

    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Faltan variables de Supabase.');
    if (!publicKey || !privateKey) throw new Error('Faltan claves VAPID en Supabase Secrets.');

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const authHeader = req.headers.get('Authorization') || '';
    const incomingSecret = req.headers.get('x-shareway-push-secret') || '';
    const isServiceRequest = Boolean(
      (webhookSecret && incomingSecret === webhookSecret) ||
      authHeader === `Bearer ${serviceKey}`
    );

    const adminClient = createClient(supabaseUrl, serviceKey);
    let targetUserId = '';
    let title = 'ShareWay';
    let message = 'Tienes una nueva notificación.';
    let url = '/notifications';

    if (isServiceRequest) {
      const record = getNotificationRecord(body);
      targetUserId = getString(record?.user_id);
      title = getString(record?.title, title);
      message = getString(record?.message || record?.content || record?.body, message);
      url = getString(record?.action_url || record?.url || record?.link, url);
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user?.id) return jsonResponse({ error: 'No autenticado' }, 401);

      targetUserId = userData.user.id;
      title = getString(body.title, title);
      message = getString(body.message, 'Push activada correctamente en este dispositivo.');
      url = getString(body.url, url);
    }

    if (!targetUserId) return jsonResponse({ error: 'Falta user_id de destino' }, 400);

    const { data: subscriptions, error: subError } = await adminClient
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', targetUserId)
      .eq('is_active', true);

    if (subError) throw subError;

    // Normalizar a base64url estricto: web-push rechaza '=' de padding y +/ 
    const toB64Url = (value: string) => String(value || '').trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    webpush.setVapidDetails(subject, toB64Url(publicKey), toB64Url(privateKey));

    let sent = 0;
    let failed = 0;

    for (const item of subscriptions || []) {
      try {
        await webpush.sendNotification({
          endpoint: item.endpoint,
          keys: {
            p256dh: item.p256dh,
            auth: item.auth,
          },
        }, JSON.stringify({ title, body: message, url }));
        sent += 1;
      } catch (_error) {
        failed += 1;
        await adminClient
          .from('push_subscriptions')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', item.id);
      }
    }

    return jsonResponse({ sent, failed, targetUserId });
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Error enviando push' }, 500);
  }
});
