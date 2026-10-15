import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getUserChats } from '@/services/chatService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Check, CheckCheck, Loader2, MessageSquare, ChevronRight, ShieldCheck, ChevronLeft, Inbox, RefreshCw, Route, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        user: 'Usuario',
        startConversation: 'Inicia una conversación...',
        grouping: 'Agrupando mensajes...',
        title: 'Mensajes',
        subtitle: 'Bandeja de entrada inteligente',
        empty: 'Sin conversaciones',
        centerTitle: 'Centro de mensajes',
        centerDesc: 'Aquí aparecen los chats con conductores y pasajeros. Los mensajes nuevos se marcan arriba para que no pierdas ninguna respuesta.',
        unread: 'No leídos',
        conversations: 'Chats',
        activeTrips: 'Viajes',
        refresh: 'Actualizar',
        findRide: 'Buscar viaje',
        myTrips: 'Mis viajes',
        emptyDesc: 'Cuando aceptes una solicitud o tengas un viaje activo, tus conversaciones aparecerán aquí.',
        emptyHint: 'Empieza buscando un viaje o revisando tu actividad.',
    },
    en: {
        user: 'User',
        startConversation: 'Start a conversation...',
        grouping: 'Grouping messages...',
        title: 'Messages',
        subtitle: 'Smart inbox',
        empty: 'No conversations',
        centerTitle: 'Message center',
        centerDesc: 'Chats with drivers and passengers appear here. New messages are highlighted so you do not miss a reply.',
        unread: 'Unread',
        conversations: 'Chats',
        activeTrips: 'Trips',
        refresh: 'Refresh',
        findRide: 'Find ride',
        myTrips: 'My trips',
        emptyDesc: 'When a request is accepted or you have an active ride, your conversations will appear here.',
        emptyHint: 'Start by finding a ride or checking your activity.',
    },
    ar: {
        user: 'مستخدم',
        startConversation: 'ابدأ محادثة...',
        grouping: 'جارٍ تجميع الرسائل...',
        title: 'الرسائل',
        subtitle: 'صندوق وارد ذكي',
        empty: 'لا توجد محادثات',
        centerTitle: 'مركز الرسائل',
        centerDesc: 'تظهر هنا محادثاتك مع السائقين والركاب. يتم إبراز الرسائل الجديدة حتى لا تفوت أي رد.',
        unread: 'غير مقروءة',
        conversations: 'محادثات',
        activeTrips: 'رحلات',
        refresh: 'تحديث',
        findRide: 'البحث عن رحلة',
        myTrips: 'رحلاتي',
        emptyDesc: 'عند قبول طلب أو وجود رحلة نشطة، ستظهر محادثاتك هنا.',
        emptyHint: 'ابدأ بالبحث عن رحلة أو مراجعة نشاطك.',
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

const ChatStats = ({ stats, copy }) => {
    const cards = [
        { label: copy.unread, value: stats.unread, icon: Inbox, tone: stats.unread > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-100' },
        { label: copy.conversations, value: stats.total, icon: MessageSquare, tone: 'bg-white text-slate-700 border-slate-100' },
        { label: copy.activeTrips, value: stats.rideChats, icon: Route, tone: 'bg-primary/10 text-primary border-primary/10' },
    ];

    return (
        <div className="grid grid-cols-3 gap-2">
            {cards.map(({ label, value, icon: Icon, tone }) => (
                <div key={label} className={cn('rounded-3xl border p-3 text-center shadow-sm', tone)}>
                    <Icon className="size-4 mx-auto mb-2 opacity-80" />
                    <p className="text-lg font-black leading-none">{value}</p>
                    <p className="text-[7px] font-black uppercase tracking-widest mt-1 opacity-70">{label}</p>
                </div>
            ))}
        </div>
    );
};

const ChatCommandCard = ({ copy, stats, loading, onRefresh, navigate }) => (
    <div className="rounded-3xl bg-slate-950 text-white p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-32 rounded-full bg-primary/20 blur-2xl" />
        <div className="relative z-10 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 text-left">
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">ShareWay</p>
                    <h2 className="text-2xl font-black italic uppercase tracking-tighter leading-none mt-1">{copy.centerTitle}</h2>
                    <p className="text-xs font-bold text-white/55 leading-relaxed mt-3">{copy.centerDesc}</p>
                </div>
                <Button type="button" size="icon" onClick={onRefresh} className="rounded-2xl bg-white/10 text-white hover:bg-white/20 shrink-0">
                    <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
                </Button>
            </div>

            {stats.unread > 0 && (
                <div className="rounded-2xl bg-emerald-400/10 border border-emerald-400/20 px-4 py-3 flex items-center justify-between text-emerald-100">
                    <span className="text-[10px] font-black uppercase tracking-widest">{copy.unread}</span>
                    <span className="text-2xl font-black leading-none">{stats.unread}</span>
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                <Button type="button" onClick={() => navigate('/dashboard')} className="h-12 rounded-2xl bg-white text-slate-950 hover:bg-white/90 text-[9px] font-black uppercase tracking-normal gap-2">
                    <Search className="size-4 text-primary" /> {copy.findRide}
                </Button>
                <Button type="button" onClick={() => navigate('/my-rides?tab=active')} variant="outline" className="h-12 rounded-2xl border-white/10 bg-white/10 text-white hover:bg-white/15 text-[9px] font-black uppercase tracking-normal gap-2">
                    <Route className="size-4 text-primary" /> {copy.myTrips}
                </Button>
            </div>
        </div>
    </div>
);

const ChatItem = ({ chat, onClick, userId, copy, language }) => {
    const safeDate = formatChatTime(chat.updated_at, language);
    const isMeLast = chat.lastMessageSenderId === userId;

    return (
        <div
            onClick={() => onClick(chat)}
            className={cn(
                'group flex items-center gap-4 p-5 bg-white border border-slate-100 rounded-3xl hover:shadow-xl hover:scale-[1.01] transition-all cursor-pointer relative',
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

    const stats = useMemo(() => ({
        total: groupedChats.length,
        unread: groupedChats.reduce((sum, chat) => sum + Number(chat.unreadCount || 0), 0),
        rideChats: groupedChats.filter((chat) => Boolean(chat.ride_id)).length,
    }), [groupedChats]);

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

            <main className="max-w-xl mx-auto px-4 py-8 space-y-5">
                <ChatCommandCard copy={copy} stats={stats} loading={loading} onRefresh={fetchChats} navigate={navigate} />
                <ChatStats stats={stats} copy={copy} />

                {groupedChats.length > 0 ? (
                    <div className="space-y-4">
                        {groupedChats.map(chat => (
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
                        ))}
                    </div>
                ) : (
                    <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200 px-8 animate-in fade-in duration-700">
                        <MessageSquare className="h-12 w-12 text-slate-100 mx-auto mb-4" />
                        <h3 className="text-sm font-black text-slate-900 uppercase italic text-center">{copy.empty}</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed mt-3">{copy.emptyDesc}</p>
                        <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-2">{copy.emptyHint}</p>
                        <div className="grid grid-cols-2 gap-2 mt-7">
                            <Button type="button" onClick={() => navigate('/dashboard')} className="h-12 rounded-2xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-normal gap-2">
                                <Search className="size-4 text-primary" /> {copy.findRide}
                            </Button>
                            <Button type="button" onClick={() => navigate('/my-rides?tab=active')} variant="outline" className="h-12 rounded-2xl bg-white border-slate-100 text-slate-800 text-[9px] font-black uppercase tracking-normal gap-2">
                                <Route className="size-4 text-primary" /> {copy.myTrips}
                            </Button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ChatList;
