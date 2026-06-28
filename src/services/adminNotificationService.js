import { supabase } from '@/lib/supabase.js';

const callAdminAnnouncementRpc = async ({
  title,
  message,
  actionUrl = '/notifications',
  target = 'all',
  userId = null,
  city = null,
  priority = 'normal',
}) => {
  const { data, error } = await supabase.rpc('sw_send_admin_announcement_v2', {
    p_title: title,
    p_message: message,
    p_action_url: actionUrl,
    p_target: target,
    p_user_id: userId,
    p_city: city,
    p_priority: priority,
  });

  if (error) throw error;
  return Number(data || 0);
};

export const sendAdminNotificationToUser = async ({
  userId,
  title,
  message,
  actionUrl = '/notifications',
  priority = 'normal',
}) => {
  const count = await callAdminAnnouncementRpc({
    title,
    message,
    actionUrl,
    target: 'single',
    userId,
    priority,
  });

  return count > 0 ? [{ id: userId }] : [];
};

export const sendAdminNotificationToUsers = async ({
  userIds = [],
  title,
  message,
  actionUrl = '/notifications',
  priority = 'normal',
}) => {
  const results = [];
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  for (const userId of uniqueUserIds) {
    const count = await callAdminAnnouncementRpc({
      title,
      message,
      actionUrl,
      target: 'single',
      userId,
      priority,
    });

    if (count > 0) results.push({ id: userId });
  }

  return results;
};

export const sendAdminNotificationBySegment = async ({
  segment = 'all',
  city = null,
  title,
  message,
  actionUrl = '/notifications',
  priority = 'normal',
}) => {
  const target = segment === 'single' ? 'all' : segment;
  const count = await callAdminAnnouncementRpc({
    title,
    message,
    actionUrl,
    target,
    city,
    priority,
  });

  return Array.from({ length: count }, (_, index) => ({ id: `${target}-${index}` }));
};
