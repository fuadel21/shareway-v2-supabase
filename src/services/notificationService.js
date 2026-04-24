import { supabase } from '../lib/supabase';

/**
 * Servicio de Notificaciones Unificado v4.5
 * Corregido para coincidir con el esquema de la base de datos (read vs is_read, content vs message)
 */

export const createNotification = async ({
    userId,
    title,
    content,
    type = 'info',
    data = {},
}) => {
    try {
        const { data: result, error } = await supabase.rpc('create_notification', {
            p_user_id: userId,
            p_title: title,
            p_content: content,
            p_type: type,
            p_data: data
        });

        if (error) throw error;
        return result;
    } catch (error) {
        console.error('🛡️ [NotificationService] Error:', error.message);
        return null;
    }
};

export const getNotifications = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('🛡️ [NotificationService] Get error:', error.message);
        return [];
    }
};

export const getUnreadCount = async (userId) => {
    try {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;
        return count;
    } catch (error) {
        console.error('🛡️ [NotificationService] Count error:', error.message);
        return 0;
    }
};

export const markAsRead = async (notificationId) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId);

        if (error) throw error;
    } catch (error) {
        console.error('🛡️ [NotificationService] Mark error:', error.message);
        throw error;
    }
};

export const markAllAsRead = async (userId) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;
    } catch (error) {
        console.error('🛡️ [NotificationService] Mark all error:', error.message);
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
    return supabase
        .channel(`notifications:${userId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`
        }, payload => {
            if (callback) callback(payload.new);
        })
        .subscribe();
};

export const getMyNotifications = getNotifications; // Alias para compatibilidad parcial
