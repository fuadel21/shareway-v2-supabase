import { supabase } from '../lib/supabase';
import { createNotification, NOTIFICATION_TYPES } from './notificationService.js';

/**
 * Obtiene todos los chats del usuario actual enriquecidos.
 * Versión Optimizada v3.0 con soporte para Unread Counts
 */
export const getUserChats = async (userId) => {
    try {
        // Obtenemos los chats básicos
        const { data, error } = await supabase
            .from('chats')
            .select(`
                *,
                ride:rides(destination, origin, departure_time)
            `)
            .contains('participants', [userId])
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Extraer IDs de otros participantes de forma masiva
        const otherUserIds = [...new Set(data.flatMap(chat =>
            chat.participants.filter(p => p !== userId)
        ))];

        // Obtener el último mensaje y el conteo de no leídos de cada chat
        // Hacemos esto en paralelo para mayor velocidad
        const chatEnrichments = await Promise.all(data.map(async (chat) => {
            const [lastMsgRes, unreadRes] = await Promise.all([
                supabase.from('messages')
                    .select('content, created_at, sender_id, read_by')
                    .eq('chat_id', chat.id)
                    .order('created_at', { ascending: false })
                    .limit(1),
                supabase.from('messages')
                    .select('id', { count: 'exact' })
                    .eq('chat_id', chat.id)
                    .neq('sender_id', userId)
                    .not('read_by', 'cs', `["${userId}"]`)
            ]);

            return {
                chatId: chat.id,
                lastMessage: lastMsgRes.data?.[0],
                unreadCount: unreadRes.count || 0
            };
        }));

        if (otherUserIds.length === 0) return [];

        // Consulta de perfiles
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, display_name, photo_url, is_verified')
            .in('id', otherUserIds);

        const profilesMap = new Map((profiles || []).map(p => [p.id, p]));
        const enrichmentMap = new Map(chatEnrichments.map(e => [e.chatId, e]));

        return data.map(chat => {
            const otherId = chat.participants.find(p => p !== userId);
            const profile = profilesMap.get(otherId);
            const enrichment = enrichmentMap.get(chat.id);

            const rideInfo = chat.ride ? {
                dest: chat.ride.destination?.name || chat.ride.destination?.address?.split(',')[0],
                time: chat.ride.departure_time
            } : null;

            return {
                ...chat,
                otherUserName: profile?.display_name || 'Usuario',
                otherUserPhoto: profile?.photo_url,
                isVerifiedUser: profile?.is_verified,
                lastMessagePreview: enrichment?.lastMessage?.content || 'Inicia una conversación...',
                lastMessageSenderId: enrichment?.lastMessage?.sender_id,
                lastMessageRead: enrichment?.lastMessage?.read_by?.length > 1, // Si hay más de 1 participante que lo leyó
                unreadCount: enrichment?.unreadCount || 0,
                lastActivity: chat.updated_at,
                isRideChat: !!chat.ride_id,
                rideContext: rideInfo
            };
        });
    } catch (error) {
        console.error("🛡️ [ChatService] getUserChats failed:", error);
        throw error;
    }
};

/**
 * Marca todos los mensajes de un chat como leídos para el usuario actual.
 */
export const markChatAsRead = async (chatId) => {
    try {
        const { error } = await supabase.rpc('mark_chat_as_read', {
            p_chat_id: chatId
        });
        if (error) throw error;
        return true;
    } catch (error) {
        console.error("🛡️ [ChatService] markChatAsRead failed:", error);
        return false;
    }
};

/**
 * Obtiene el total global de mensajes no leídos.
 */
export const getTotalUnreadCount = async () => {
    try {
        const { data, error } = await supabase.rpc('get_total_unread_count');
        if (error) throw error;
        return data || 0;
    } catch (error) {
        console.error("🛡️ [ChatService] getTotalUnreadCount failed:", error);
        return 0;
    }
};

/**
 * Crea o recupera un chat con un RPC atómico.
 */
export const getOrCreateChat = async (otherUserId, rideId = null) => {
    try {
        const { data, error } = await supabase.rpc('get_or_create_chat_v2', {
            p_other_user_id: otherUserId,
            p_ride_id: rideId
        });

        if (error) throw error;
        return data.chatId || data; // Maneja diferentes formatos de retorno del RPC
    } catch (error) {
        console.error("🛡️ [ChatService] getOrCreateChat failed:", error);
        throw error;
    }
};

const notifyChatReceivers = async ({ chatId, senderId, content }) => {
    const { data: chat, error } = await supabase
        .from('chats')
        .select('id, participants, ride_id')
        .eq('id', chatId)
        .single();

    if (error || !chat?.participants?.length) return;

    const receivers = chat.participants.filter(participantId => String(participantId) !== String(senderId));
    if (receivers.length === 0) return;

    await Promise.all(receivers.map(receiverId => createNotification({
        userId: receiverId,
        actorId: senderId,
        type: NOTIFICATION_TYPES.CHAT_MESSAGE,
        title: 'Nuevo mensaje',
        message: content.length > 120 ? `${content.slice(0, 117)}...` : content,
        actionUrl: `/chat/${chatId}`,
        entityType: 'chat',
        entityId: chatId,
        priority: 'normal',
        metadata: {
            chat_id: chatId,
            ride_id: chat.ride_id || null,
        },
    })));
};

/**
 * Envío de Mensaje con Validación de Red
 */
export const sendMessage = async (chatId, senderId, content) => {
    const cleanContent = content?.trim();
    if (!cleanContent) return null;

    try {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                chat_id: chatId,
                sender_id: senderId,
                content: cleanContent
            })
            .select()
            .single();

        if (error) throw error;

        // Actualización asíncrona del chat (Fire and forget)
        supabase.from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId)
            .then(({ error }) => { if (error) console.warn("Timestamp update failed"); });

        // Notificación in-app al resto de participantes. No bloquea el envío del mensaje.
        notifyChatReceivers({ chatId, senderId, content: cleanContent })
            .catch((notifyError) => console.warn("Chat notification failed", notifyError));

        return data;
    } catch (error) {
        console.error("🛡️ [ChatService] sendMessage failed:", error);
        throw error;
    }
};
