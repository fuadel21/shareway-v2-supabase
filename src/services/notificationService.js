import { supabase } from '@/lib/supabase.js';

export const NOTIFICATION_TYPES = {
  SYSTEM: 'system',
  INFO: 'info',
  RIDE_REQUEST: 'ride_request',
  REQUEST_ACCEPTED: 'request_accepted',
  REQUEST_REJECTED: 'request_rejected',
  CHAT_MESSAGE: 'chat_message',
  RIDE_REMINDER: 'ride_reminder',
  RIDE_CANCELLED: 'ride_cancelled',
  REVIEW: 'review',
  ACHIEVEMENT: 'achievement',
  ADMIN_ANNOUNCEMENT: 'admin_announcement',
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  messages: true,
  rideUpdates: true,
  reminders: true,
  reviews: true,
  adminAnnouncements: true,
  promotions: false,
};

const TYPE_TO_PREFERENCE = {
  [NOTIFICATION_TYPES.CHAT_MESSAGE]: 'messages',
  [NOTIFICATION_TYPES.RIDE_REQUEST]: 'rideUpdates',
  [NOTIFICATION_TYPES.REQUEST_ACCEPTED]: 'rideUpdates',
  [NOTIFICATION_TYPES.REQUEST_REJECTED]: 'rideUpdates',
  [NOTIFICATION_TYPES.RIDE_CANCELLED]: 'rideUpdates',
  [NOTIFICATION_TYPES.RIDE_REMINDER]: 'reminders',
  [NOTIFICATION_TYPES.REVIEW]: 'reviews',
  [NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT]: 'adminAnnouncements',
};

const shouldDeliverNotification = async ({ userId, type, priority }) => {
  if (!userId) return false;
  if (priority === 'critical') return true;

  const preferenceKey = TYPE_TO_PREFERENCE[type];
  if (!preferenceKey) return true;

  const { data, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('🛡️ [NotificationService] Preference check skipped:', error.message);
    return true;
  }

  const settings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(data?.preferences?.notifications || {}),
  };

  return settings[preferenceKey] !== false;
};

export const createNotification = async ({
  userId,
  actorId = null,
  title,
  message,
  content,
  type = NOTIFICATION_TYPES.SYSTEM,
  actionUrl = null,
  entityType = null,
  entityId = null,
  priority = 'normal',
  isPinned = false,
  metadata = {},
  data = {},
  ignorePreferences = false,
}) => {
  try {
    if (!userId || !title) throw new Error('Missing userId or title');

    if (!ignorePreferences) {
      const canDeliver = await shouldDeliverNotification({ userId, type, priority });
      if (!canDeliver) return null;
    }

    const { data: result, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        actor_id: actorId,
        title,
        message: message || content || '',
        type,
        action_url: actionUrl,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        priority,
        is_pinned: Boolean(isPinned),
        metadata: { ...data, ...metadata },
      })
      .select('*')
      .single();

    if (error) throw error;
    return result;
  } catch (error) {
    console.error('🛡️ [NotificationService] Create error:', error.message);
    return null;
  }
};

export const getNotifications = async (userId, options = {}) => {
  try {
    if (!userId) return [];

    const { onlyUnread = false, type = null, search = '', limit = 80 } = options;
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (onlyUnread) query = query.eq('is_read', false);
    if (type) query = query.eq('type', type);
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`title.ilike.${term},message.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('🛡️ [NotificationService] Get error:', error.message);
    return [];
  }
};

export const getUnreadCount = async (userId) => {
  try {
    if (!userId) return 0;

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('🛡️ [NotificationService] Count error:', error.message);
    return 0;
  }
};

export const markAsRead = async (notificationId) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) throw error;
  } catch (error) {
    console.error('🛡️ [NotificationService] Mark read error:', error.message);
    throw error;
  }
};

export const markAsUnread = async (notificationId) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: false })
      .eq('id', notificationId);

    if (error) throw error;
  } catch (error) {
    console.error('🛡️ [NotificationService] Mark unread error:', error.message);
    throw error;
  }
};

export const markAllAsRead = async (userId) => {
  try {
    if (!userId) return;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
  } catch (error) {
    console.error('🛡️ [NotificationService] Mark all error:', error.message);
    throw error;
  }
};

export const togglePinned = async (notificationId, isPinned) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_pinned: Boolean(isPinned) })
      .eq('id', notificationId);

    if (error) throw error;
  } catch (error) {
    console.error('🛡️ [NotificationService] Pin error:', error.message);
    throw error;
  }
};

export const deleteNotification = async (id) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('🛡️ [NotificationService] Delete error:', error.message);
    throw error;
  }
};

export const subscribeToNotifications = (userId, callback) => {
  if (!userId) return null;

  return supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, payload => {
      if (callback) callback(payload);
    })
    .subscribe();
};

export const getMyNotifications = getNotifications;
export const getUnreadNotificationCount = getUnreadCount;
export const markNotificationAsRead = markAsRead;
export const markAllNotificationsAsRead = markAllAsRead;
