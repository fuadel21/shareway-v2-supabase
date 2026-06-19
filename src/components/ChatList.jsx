import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getUserChats } from '@/services/chatService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Check, CheckCheck, Loader2, MessageSquare, ChevronRight, ShieldCheck, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        user: 'Usuario',
        startConversation: 'Inicia una conversación...',
        grouping: 'Agrupando mensajes...',
        title: 'Mensajes',
        subtitle: 'Bandeja de entrada inteligente',
        empty: 'Sin conversaciones'
    },
    en: {
        user: 'User',
        startConversation: 'Start a conversation...',
        grouping: 'Grouping messages...',
        title: 'Messages',
        subtitle: 'Smart inbox',
        empty: 'No conversations'
    },
    ar: {
        user: 'مستخدم',
        startConversation: 'ابدأ محادثة...',
        grouping: 'جارٍ تجميع الرسائل...',
        title: 'الرسائل',
        subtitle: 'صندوق وارد ذكي',
        empty: 'لا توجد محادثات'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

const formatChatTime = (dateValue, language) => {
    const date = dateValue ? new Date(dateValue) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'en' ? 'en-US' : 'es-ES', {
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

const ChatItem = ({ chat, onClick, userId, copy, language }) => {
    const safeDate = formatChatTime(chat.updated_at, language);
    const isMeLast = chat.lastMessageSenderId === userId;

    return (
        <div
            onClick={() => onClick(chat)}
            className={cn(
                'group flex items-center gap-4 p-5 bg-white border border-slate-100 rounded-[2.5rem] hover:shadow-xl hover:scale-[1.01] transition-all cursor-pointer relative',
                chat.unreadCount > 0 ? 'border-emerald-100 bg-emerald-50/5' : ''
            )}
        >
            <div className="relative">
                <Avatar className="h-14 w-14 border-2 border-white shadow-md">
                    <AvatarImage src={chat.otherUserPhoto} />
                    <AvatarFallback className="bg-slate-100 font-black text-slate-800">
                        {getInitials(chat.otherUserName)}
                    </AvatarFallback>
                </Avatar>
                <div className={cn(
                    'absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white shadow-sm',
                    chat.unreadCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-200'
                )} />
            </div>

            <div className="flex-1 min-w-0 text-left">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex flex-col text-left">
                        <div className="flex items-center gap-2">
                            <h3 className={cn(
                                'font-black text-slate-900 text-sm uppercase italic tracking-tighter truncate max-w-[150px]',
                                chat.unreadCount > 0 ? 'text-emerald-900' : ''
                            )}>
                                {chat.otherUserName || copy.user}
                            </h3>
                            {chat.isVerifiedUser && <ShieldCheck size={12} className="text-blue-500" />}
                        </div>
                    </div>
                    <span className={cn(
                        'text-[9px] font-bold uppercase tracking-widest shrink-0 ml-2',
                        chat.unreadCount > 0 ? 'text-emerald-500' : 'text-slate-400'
                    )}>
                        {safeDate}
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    {isMeLast && (
                        chat.lastMessageRead ?
                        <CheckCheck size={14} className="text-blue-500 shrink-0" /> :
                        <Check size={14} className="text-slate-400 shrink-0" />
                    )}
                    <p className={cn(
                        'text-xs truncate font-medium leading-none',
                        chat.unreadCount > 0 ? 'text-slate-900 font-black' : 'text-slate-500'
                    )}>
                        {chat.lastMessagePreview || copy.startConversation}
                    </p>
                </div>
            </div>

            <div className="flex flex-col items-end gap-2">
                {chat.unreadCount > 0 && (
                    <div className="bg-emerald-500 text-white min-w-[20px] h-5 rounded-full px-1.5 flex items-center justify-center text-[10px] font-black shadow-lg shadow-emerald-500/20 animate-in zoom-in">
                        {chat.unreadCount}
                    </div>
                )}
                <div className="size-8 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-primary group-hover:text-white transition-all">
                    <ChevronRight size={18} />
                </div>
            </div>
        </div>
    );
};

const ChatList = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const { i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];
    const [rawChats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchChats = useCallback(async () => {
        if (!user?.id) return;
        try {
            const data = await getUserChats(user.id);
            setChats(data || []);
        } catch (e) {
            console.error('🛡️ ChatList Error:', e);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchChats();

        if (!user?.id) return;

        const chatChannel = supabase
            .channel(`chat_list_${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chats'
            }, () => fetchChats())
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            }, () => fetchChats())
            .subscribe();

        return () => {
            supabase.removeChannel(chatChannel);
        };
    }, [user?.id, fetchChats]);

    const groupedChats = useMemo(() => {
        const groups = {};

        rawChats.forEach(chat => {
            const otherParticipantId = chat.participants.find(p => p !== user.id);
            if (!otherParticipantId) return;

            if (!groups[otherParticipantId] || new Date(chat.updated_at) > new Date(groups[otherParticipantId].updated_at)) {
                groups[otherParticipantId] = {
                    ...chat,
                    threadCount: (groups[otherParticipantId]?.threadCount || 0) + 1,
                    isGrouped: true
                };
            } else {
                groups[otherParticipantId].threadCount += 1;
            }
        });

        return Object.values(groups).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }, [rawChats, user.id]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{copy.grouping}</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="rounded-2xl bg-slate-50 size-12">
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none text-left">{copy.title}</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 text-left">{copy.subtitle}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 space-y-4">
                {groupedChats.length > 0 ? (
                    groupedChats.map(chat => (
                        <ChatItem
                            key={chat.id}
                            chat={chat}
                            userId={user.id}
                            copy={copy}
                            language={language}
                            onClick={(c) => {
                                if (c.ride_id) {
                                    navigate(`/ride-chat/${c.ride_id}`);
                                } else {
                                    navigate(`/chat/${c.id}`);
                                }
                            }}
                        />
                    ))
                ) : (
                    <div className="py-24 text-center bg-white rounded-[3rem] border border-dashed border-slate-200">
                        <MessageSquare className="h-12 w-12 text-slate-100 mx-auto mb-4" />
                        <h3 className="text-sm font-black text-slate-900 uppercase italic text-center">{copy.empty}</h3>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ChatList;
