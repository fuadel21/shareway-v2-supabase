import { supabase } from '../lib/supabase';

/**
 * Obtiene todos los chats del usuario actual enriquecidos.
 * Versión Optimizada v2.0
 */
export const getUserChats = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('chats')
            .select(`
                *,
                messages:messages(content, created_at),
                ride:rides(destination, origin, departure_time)
            `)
            .contains('participants', [userId])
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Extraer IDs de otros participantes de forma masiva
        const otherUserIds = [...new Set(data.flatMap(chat =>
            chat.participants.filter(p => p !== userId)
        ))];

        if (otherUserIds.length === 0) return data;

        // Consulta de perfiles en una sola operación (Batch Fetching)
        const { data: profiles, error: pError } = await supabase
            .from('profiles')
            .select('id, display_name, photo_url, is_verified')
            .in('id', otherUserIds);

        // Fallback en caso de que is_verified falte en la DB (aunque el SQL lo añade)
        const safeProfiles = profiles || [];
        const profilesMap = new Map(safeProfiles.map(p => [p.id, p]));

        return data.map(chat => {
            const otherId = chat.participants.find(p => p !== userId);
            const profile = profilesMap.get(otherId);

            // Lógica de Previsualización: El mensaje más reciente
            const messages = chat.messages || [];
            const lastMessage = messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

            // Construcción del contexto del viaje
            const rideInfo = chat.ride ? {
                dest: chat.ride.destination?.name || chat.ride.destination?.address?.split(',')[0],
                time: chat.ride.departure_time
            } : null;

            return {
                ...chat,
                otherUserName: profile?.display_name || 'Usuario',
                otherUserPhoto: profile?.photo_url,
                isVerifiedUser: profile?.is_verified,
                lastMessagePreview: lastMessage?.content || 'Inicia una conversación...',
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

/**
 * Envío de Mensaje con Validación de Red
 */
export const sendMessage = async (chatId, senderId, content) => {
    if (!content?.trim()) return null;

    try {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                chat_id: chatId,
                sender_id: senderId,
                content: content.trim()
            })
            .select()
            .single();

        if (error) throw error;

        // Actualización asíncrona del chat (Fire and forget)
        supabase.from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId)
            .then(({ error }) => { if (error) console.warn("Timestamp update failed"); });

        return data;
    } catch (error) {
        console.error("🛡️ [ChatService] sendMessage failed:", error);
        throw error;
    }
};
