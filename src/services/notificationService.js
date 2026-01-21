import { supabase } from '../lib/supabase';

/**
 * Get notifications for a user
 * @param {string} userId 
 * @param {number} limit 
 * @returns {Promise<Array>}
 */
export const getNotifications = async (userId, limit = 20) => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
};

/**
 * Mark a notification as read
 * @param {string} notificationId 
 */
export const markAsRead = async (notificationId) => {
    const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

    if (error) throw error;
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId 
 */
export const markAllAsRead = async (userId) => {
    const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);

    if (error) throw error;
};

/**
 * Subscribe to realtime notifications
 * @param {string} userId 
 * @param {function} onNotification 
 * @returns {object} subscription
 */
export const subscribeToNotifications = (userId, onNotification) => {
    return supabase
        .channel(`notifications:${userId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`
            },
            (payload) => {
                onNotification(payload.new);
            }
        )
        .subscribe();
};

/**
 * Create a notification
 * @param {string} userId 
 * @param {string} title 
 * @param {string} content 
 * @param {string} type 
 * @param {object} data 
 */
export const createNotification = async (userId, title, content, type = 'info', data = {}) => {
    const { error } = await supabase.rpc('create_notification', {
        p_user_id: userId,
        p_title: title,
        p_content: content,
        p_type: type,
        p_data: data
    });

    if (error) throw error;
};

/**
 * Get unread count
 * @param {string} userId 
 * @returns {Promise<number>}
 */
export const getUnreadCount = async (userId) => {
    const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

    if (error) throw error;
    return count;
};
