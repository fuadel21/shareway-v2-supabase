import { supabase } from '../lib/supabase';

/**
 * Obtiene todos los chats del usuario actual.
 */
export const getUserChats = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('chats')
            .select(`
                *,
                messages(content, created_at)
            `)
            .contains('participants', [userId])
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Enriquecer con perfiles (esto suele ser mejor hacerlo con un join si es posible, 
        // pero aquí seguimos el patrón de ChatList.jsx)
        const otherUserIds = data.map(chat => chat.participants.find(p => p !== userId)).filter(Boolean);

        if (otherUserIds.length === 0) return data.map(c => ({ ...c, lastMessagePreview: '', otherUserName: 'Usuario' }));

        const { data: profiles, error: pError } = await supabase
            .from('profiles')
            .select('id, display_name, photo_url')
            .in('id', otherUserIds);

        if (pError) throw pError;

        const profilesMap = new Map(profiles.map(p => [p.id, p]));

        return data.map(chat => {
            const otherId = chat.participants.find(p => p !== userId);
            const profile = profilesMap.get(otherId);
            const messages = chat.messages || [];
            const lastMessage = messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

            return {
                ...chat,
                otherUserName: profile?.display_name || 'Usuario',
                otherUserPhoto: profile?.photo_url,
                lastMessagePreview: lastMessage?.content || '',
                lastActivity: chat.updated_at,
                unreadCount: 0 // Implementar lógica real si existe columna unread
            };
        });
    } catch (error) {
        console.error("Error en getUserChats:", error);
        throw error;
    }
};

/**
 * Crea o recupera un chat existente entre dos usuarios.
 */
export const getOrCreateChat = async (otherUserId, rideId = null) => {
    try {
        const { data, error } = await supabase.rpc('get_or_create_chat', {
            p_other_user_id: otherUserId,
            p_ride_id: rideId
        });

        if (error) throw error;
        return data.chatId;
    } catch (error) {
        console.error("Error en getOrCreateChat:", error);
        throw error;
    }
};

/**
 * Envía un mensaje a un chat.
 */
export const sendMessage = async (chatId, senderId, content) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                chat_id: chatId,
                sender_id: senderId,
                content: content
            })
            .select()
            .single();

        if (error) throw error;

        // Actualizar el timestamp del chat
        await supabase
            .from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId);

        return data;
    } catch (error) {
        console.error("Error en sendMessage:", error);
        throw error;
    }
};
