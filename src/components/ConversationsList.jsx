import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { getUserChats } from '@/services/chatService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, MessageSquare, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';

const getInitials = (name) => {
    if (!name || typeof name !== 'string' || !name.trim()) return '?';
    // FALLO 22 ARREGLADO: Lógica de iniciales robusta para evitar "?" vacíos
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

function ConversationsList() {
    const { user } = useOutletContext();
    const { chatId: activeChatId } = useParams();
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const { t, i18n } = useTranslation();

    const fetchConversations = useCallback(async () => {
        if (!user?.id) return;
        try {
            const chats = await getUserChats(user.id);
            setConversations(chats);
        } catch (error) {
            console.error("🛡️ Conversations fetch failed:", error);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchConversations();

        // FALLO 29 ARREGLADO: Sincronización Realtime para la lista de chats
        const channel = supabase
            .channel(`list_sync_${user?.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
                fetchConversations();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, fetchConversations]);

    if (loading) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-10 space-y-4">
                <Loader2 className="animate-spin h-8 w-8 text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{t('common.loading')}</p>
            </div>
        );
    }

    if (conversations.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-6">
                <div className="h-24 w-24 bg-white rounded-[2rem] shadow-xl flex items-center justify-center border border-slate-50">
                    <MessageSquare className="h-12 w-12 text-slate-100" />
                </div>
                <h3 className="font-black text-slate-950 text-xl tracking-tighter uppercase italic">{t('chats.no_chats')}</h3>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            <header className="p-8 border-b border-slate-50 text-left">
                <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic">{t('chats.title')}</h2>
                <p className="text-[9px] font-black text-primary uppercase tracking-[0.3em] mt-1">{t('chats.subtitle')}</p>
            </header>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
                {conversations.map((convo, idx) => (
                    <Link
                        to={`/chat/${convo.id}`}
                        key={convo.id}
                        className={cn(
                            "block p-6 transition-all duration-300 border-b border-slate-50/50 relative group",
                            activeChatId === convo.id ? 'bg-primary/5' : 'hover:bg-slate-50'
                        )}
                    >
                        <div className="flex items-center gap-5">
                            <div className="relative">
                                <Avatar className="h-16 w-16 border-2 border-white shadow-lg">
                                    <AvatarImage src={convo.otherUserPhoto} />
                                    <AvatarFallback className="bg-slate-900 text-white font-black text-xs">
                                        {getInitials(convo.otherUserName)}
                                    </AvatarFallback>
                                </Avatar>
                                {convo.unreadCount > 0 && (
                                    <div className="absolute -top-1 -right-1 h-6 w-6 bg-primary text-white text-[10px] font-black rounded-full border-4 border-white flex items-center justify-center">
                                        {convo.unreadCount}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <div className="flex justify-between items-center mb-1">
                                    <p className="font-black text-slate-900 truncate tracking-tight text-lg">{convo.otherUserName}</p>
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                        <Clock className="h-3 w-3" />
                                        <p className="text-[9px] font-black uppercase tracking-widest">
                                            {formatDistanceToNow(new Date(convo.lastActivity), { 
                                                addSuffix: true, 
                                                locale: i18n.language === 'es' ? es : enUS 
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className={cn(
                                        "text-sm truncate pr-8",
                                        convo.unreadCount > 0 ? "font-black text-slate-900" : "font-medium text-slate-400"
                                    )}>
                                        {convo.lastMessagePreview}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

export default ConversationsList;
