import { supabase } from '../lib/supabase';

/**
 * Servicio de Notificaciones Unificado v4.0
 * Alineado con la función SECURITY DEFINER de la base de datos.
 */
export const createNotification = async ({
    userId,
    title,
    message,
    type = 'info',
    metadata = {},
    rideId = null,
    priority = 0
}) => {
    try {
        const { data, error } = await supabase.rpc('create_notification', {
            p_user_id: userId,
            p_title: title,
            p_message: message,
            p_type: type,
            p_metadata: metadata,
            p_ride_id: rideId,
            p_priority: priority
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('🛡️ [NotificationService] Error:', error.message);
        // Fallback silencioso para no romper la experiencia del usuario principal
        return null;
    }
};

export const markAsRead = async (notificationId) => {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
    if (error) throw error;
};

export const getMyNotifications = async () => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) throw error;
    return data;
};
