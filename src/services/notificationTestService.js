import { supabase } from '@/lib/supabase.js';

export const createNotificationTestRecord = async ({ userId, label }) => {
  if (!userId) throw new Error('Sesión no válida: falta userId.');

  const modernPayload = {
    user_id: userId,
    actor_id: userId,
    type: 'system',
    title: 'Prueba de notificaciones ShareWay',
    message: `Realtime activo para ${label}.`,
    action_url: '/settings/notification-test',
    entity_type: 'notification_test',
    entity_id: String(Date.now()),
    priority: 'normal',
    is_pinned: false,
    metadata: {
      source: 'NotificationTestPage',
      createdFromClient: true,
      timestamp: new Date().toISOString(),
    },
  };

  const modernResult = await supabase
    .from('notifications')
    .insert(modernPayload)
    .select('*')
    .single();

  if (!modernResult.error) return modernResult.data;

  if (modernResult.error.code !== 'PGRST204') throw modernResult.error;

  const legacyPayload = {
    user_id: userId,
    type: 'system',
    title: 'Prueba de notificaciones ShareWay',
    message: `Realtime activo para ${label}.`,
  };

  const legacyResult = await supabase
    .from('notifications')
    .insert(legacyPayload)
    .select('*')
    .single();

  if (legacyResult.error) throw legacyResult.error;
  return legacyResult.data;
};
