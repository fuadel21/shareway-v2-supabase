import { supabase } from '@/lib/supabase.js';
import { createNotification, NOTIFICATION_TYPES } from '@/services/notificationService.js';

const getCurrentAdmin = async () => {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const user = authData?.user;
  if (!user?.id) throw new Error('No autenticado');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, is_admin, role')
    .eq('id', user.id)
    .single();

  if (profileError) throw profileError;

  const role = String(profile?.role || '').toLowerCase();
  const isAdmin = profile?.is_admin === true || role === 'admin' || role === 'super_admin';
  if (!isAdmin) throw new Error('No tienes permisos de administrador');

  return user;
};

export const sendAdminNotificationToUser = async ({ userId, title, message, actionUrl = '/notifications', priority = 'normal', metadata = {} }) => {
  const admin = await getCurrentAdmin();

  return createNotification({
    userId,
    actorId: admin.id,
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title,
    message,
    actionUrl,
    entityType: 'admin_announcement',
    entityId: crypto.randomUUID(),
    priority,
    isPinned: priority === 'critical',
    metadata,
  });
};

export const sendAdminNotificationToUsers = async ({ userIds = [], title, message, actionUrl = '/notifications', priority = 'normal', metadata = {} }) => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  const admin = await getCurrentAdmin();

  const payload = uniqueUserIds.map((userId) => ({
    user_id: userId,
    actor_id: admin.id,
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title,
    message,
    action_url: actionUrl,
    entity_type: 'admin_announcement',
    entity_id: crypto.randomUUID(),
    priority,
    is_pinned: priority === 'critical',
    metadata,
  }));

  const { data, error } = await supabase
    .from('notifications')
    .insert(payload)
    .select('*');

  if (error) throw error;
  return data || [];
};

export const sendAdminNotificationBySegment = async ({ segment = 'all', city = null, title, message, actionUrl = '/notifications', priority = 'normal', limit = 500 }) => {
  let query = supabase
    .from('profiles')
    .select('id, city, role, is_admin')
    .limit(limit);

  if (segment === 'city' && city) query = query.ilike('city', city);
  if (segment === 'drivers') query = query.or('role.eq.driver,role.eq.conductor');
  if (segment === 'passengers') query = query.or('role.eq.passenger,role.eq.pasajero');

  const { data: profiles, error } = await query;
  if (error) throw error;

  const userIds = (profiles || []).map((profile) => profile.id);
  return sendAdminNotificationToUsers({ userIds, title, message, actionUrl, priority, metadata: { segment, city } });
};
