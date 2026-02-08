/**
 * Notification Service Enhanced - Sistema Completo de Notificaciones
 * Manejo de push notifications, email y preferencias
 */

import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';

/**
 * Crea una notificación con validación de preferencias
 * @param {Object} notificationData - Datos de la notificación
 * @returns {Promise<Object>} Resultado de la creación
 */
export const createNotification = async ({
    userId,
    type,
    title,
    body,
    data = {},
    priority = 'normal',
    category = 'general',
    scheduledAt = new Date()
}) => {
    try {
        const { success, error, data: result } = await safeCall(
            () => supabase.rpc('create_notification', {
                p_user_id: userId,
                p_type: type,
                p_title: title,
                p_body: body,
                p_data: data,
                p_priority: priority,
                p_category: category,
                p_scheduled_at: scheduledAt.toISOString()
            }),
            'create_notification'
        );

        if (!success) {
            throw new Error(error || 'Error al crear notificación');
        }

        return result;
    } catch (error) {
        console.error('🛡️ [Notification Service] createNotification failed:', error);
        throw error;
    }
};

/**
 * Obtiene notificaciones no leídas de un usuario
 * @param {string} userId - ID del usuario
 * @param {Object} options - Opciones de consulta
 * @returns {Promise<Object>} Notificaciones no leídas
 */
export const getUnreadNotifications = async (
    userId,
    { limit = 20 } = {}
) => {
    try {
        const { data, error } = await supabase
            .rpc('get_unread_notifications', {
                p_user_id: userId,
                p_limit: limit
            });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Notification Service] getUnreadNotifications failed:', error);
        throw error;
    }
};

/**
 * Marca una notificación como leída
 * @param {string} notificationId - ID de la notificación
 * @param {string} userId - ID del usuario (opcional, usa auth.uid() por defecto)
 * @returns {Promise<Object>} Resultado de la actualización
 */
export const markNotificationRead = async (notificationId, userId) => {
    try {
        const { success, error, data } = await safeCall(
            () => supabase.rpc('mark_notification_read', {
                p_notification_id: notificationId,
                p_user_id: userId
            }),
            'mark_notification_read'
        );

        if (!success) {
            throw new Error(error || 'Error al marcar notificación como leída');
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Notification Service] markNotificationRead failed:', error);
        throw error;
    }
};

/**
 * Marca todas las notificaciones como leídas
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>} Resultado de la actualización
 */
export const markAllNotificationsRead = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .update({ 
                status: 'read', 
                read_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .in('status', ['pending', 'sent', 'delivered'])
            .select('id');

        if (error) {
            throw new Error(error.message);
        }

        return {
            success: true,
            marked_count: data?.length || 0
        };
    } catch (error) {
        console.error('🛡️ [Notification Service] markAllNotificationsRead failed:', error);
        throw error;
    }
};

/**
 * Obtiene preferencias de notificación de un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>} Preferencias del usuario
 */
export const getNotificationPreferences = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('notification_preferences')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            throw new Error(error.message);
        }

        // Si no tiene preferencias, crear defaults
        if (!data) {
            const { data: newPrefs, error: insertError } = await supabase
                .from('notification_preferences')
                .insert({ user_id: userId })
                .select('*')
                .single();

            if (insertError) {
                throw new Error(insertError.message);
            }

            return newPrefs;
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Notification Service] getNotificationPreferences failed:', error);
        throw error;
    }
};

/**
 * Actualiza preferencias de notificación
 * @param {string} userId - ID del usuario
 * @param {Object} preferences - Nuevas preferencias
 * @returns {Promise<Object>} Preferencias actualizadas
 */
export const updateNotificationPreferences = async (userId, preferences) => {
    try {
        const { data, error } = await supabase
            .from('notification_preferences')
            .upsert({
                user_id: userId,
                ...preferences,
                updated_at: new Date().toISOString()
            })
            .select('*')
            .single();

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Notification Service] updateNotificationPreferences failed:', error);
        throw error;
    }
};

/**
 * Registra dispositivo para push notifications
 * @param {Object} deviceData - Datos del dispositivo
 * @returns {Promise<Object>} Resultado del registro
 */
export const registerDevice = async ({
    deviceToken,
    deviceType, // 'ios', 'android', 'web'
    deviceId,
    appVersion
}) => {
    try {
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
            throw new Error('Usuario no autenticado');
        }

        const { data, error } = await supabase
            .from('user_devices')
            .upsert({
                user_id: user.user.id,
                device_token: deviceToken,
                device_type: deviceType,
                device_id: deviceId,
                app_version: appVersion,
                is_active: true,
                last_seen_at: new Date().toISOString()
            })
            .select('*')
            .single();

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Notification Service] registerDevice failed:', error);
        throw error;
    }
};

/**
 * Crea notificaciones para eventos específicos del sistema
 */

export const notifyRideRequest = async (driverId, requestData) => {
    return createNotification({
        userId: driverId,
        type: 'ride_request',
        title: 'Nueva solicitud de plaza',
        body: `${requestData.requesterName} quiere unirse a tu viaje`,
        data: {
            ride_id: requestData.rideId,
            request_id: requestData.requestId,
            requester_id: requestData.requesterId,
            requester_name: requestData.requesterName,
            origin: requestData.origin,
            destination: requestData.destination,
            departure_time: requestData.departureTime,
            suggested_price: requestData.suggestedPrice,
            seats_needed: requestData.seatsNeeded,
            action_url: `/requests/${requestData.requestId}`
        },
        priority: 'normal',
        category: 'ride'
    });
};

export const notifyRideAccepted = async (passengerId, rideData) => {
    return createNotification({
        userId: passengerId,
        type: 'ride_accepted',
        title: '¡Tu solicitud fue aceptada!',
        body: `${rideData.driverName} aceptó tu solicitud de plaza`,
        data: {
            ride_id: rideData.rideId,
            driver_id: rideData.driverId,
            driver_name: rideData.driverName,
            origin: rideData.origin,
            destination: rideData.destination,
            departure_time: rideData.departureTime,
            pickup_point: rideData.pickupPoint,
            price: rideData.price,
            pin: rideData.pin,
            action_url: `/rides/${rideData.rideId}`
        },
        priority: 'high',
        category: 'ride'
    });
};

export const notifyPaymentRequired = async (userId, paymentData) => {
    return createNotification({
        userId,
        type: 'payment_required',
        title: 'Pago requerido para confirmar plaza',
        body: `Realiza el pago de €${paymentData.amount} para confirmar tu plaza`,
        data: {
            ride_id: paymentData.rideId,
            amount: paymentData.amount,
            expires_in: paymentData.expiresIn,
            origin: paymentData.origin,
            destination: paymentData.destination,
            departure_time: paymentData.departureTime,
            action_url: `/payment/${paymentData.rideId}`
        },
        priority: 'urgent',
        category: 'payment'
    });
};

export const notifyReviewReminder = async (userId, reviewData) => {
    return createNotification({
        userId,
        type: 'review_reminder',
        title: 'Valora tu experiencia',
        body: `¿Cómo fue tu viaje con ${reviewData.otherUserName}?`,
        data: {
            ride_id: reviewData.rideId,
            other_user_id: reviewData.otherUserId,
            other_user_name: reviewData.otherUserName,
            origin: reviewData.origin,
            destination: reviewData.destination,
            trip_date: reviewData.tripDate,
            action_url: `/review/${reviewData.rideId}/${reviewData.otherUserId}`
        },
        priority: 'normal',
        category: 'social'
    });
};

export const notifyBadgeEarned = async (userId, badgeData) => {
    return createNotification({
        userId,
        type: 'badge_earned',
        title: '¡Nuevo badge obtenido!',
        body: `Has desbloqueado el badge "${badgeData.badgeName}"`,
        data: {
            badge_type: badgeData.badgeType,
            badge_name: badgeData.badgeName,
            badge_level: badgeData.badgeLevel,
            action_url: '/profile/badges'
        },
        priority: 'normal',
        category: 'social'
    });
};

/**
 * Suscripción a notificaciones en tiempo real
 * @param {string} userId - ID del usuario
 * @param {Function} callback - Función callback para nuevas notificaciones
 * @returns {Object} Suscripción de Supabase
 */
export const subscribeToNotifications = (userId, callback) => {
    const channel = supabase
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
                callback(payload.new);
            }
        )
        .subscribe();

    return channel;
};

/**
 * Cancela suscripción a notificaciones
 * @param {Object} channel - Canal de Supabase a cancelar
 */
export const unsubscribeFromNotifications = (channel) => {
    if (channel) {
        supabase.removeChannel(channel);
    }
};

/**
 * Solicita permisos de notificación push en el navegador
 * @returns {Promise<boolean>} Si se concedieron los permisos
 */
export const requestPushPermission = async () => {
    if (!('Notification' in window)) {
        console.warn('Este navegador no soporta notificaciones push');
        return false;
    }

    if (Notification.permission === 'granted') {
        return true;
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }

    return false;
};

/**
 * Muestra notificación push local (para testing/fallback)
 * @param {Object} notificationData - Datos de la notificación
 */
export const showLocalNotification = ({
    title,
    body,
    icon = '/favicon.ico',
    tag,
    requireInteraction = false,
    onClick
}) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    const notification = new Notification(title, {
        body,
        icon,
        tag,
        requireInteraction
    });

    if (onClick) {
        notification.onclick = onClick;
    }

    // Auto-cerrar después de 5 segundos si no requiere interacción
    if (!requireInteraction) {
        setTimeout(() => {
            notification.close();
        }, 5000);
    }

    return notification;
};
