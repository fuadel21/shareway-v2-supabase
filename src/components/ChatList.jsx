
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getUserChats } from '@/services/chatService';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, MessageSquare, ChevronRight, Sparkles, ShieldCheck, ChevronLeft, User } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

const ChatItem = ({ chat, onClick }) => {
    const date = chat.updated_at ? new Date(chat.updated_at) : null;
    const safeDate = (date && isValid(date)) ? format(date, "d MMM", { locale: es }) : "";

    return (
        <div
            onClick={() => onClick(chat)}
            className="group flex items-center gap-4 p-5 bg-white border border-slate-100 rounded-[2.5rem] hover:shadow-xl hover:scale-[1.01] transition-all cursor-pointer"
        >
            <div className="relative">
                <Avatar className="h-14 w-14 border-2 border-white shadow-md">
                    <AvatarImage src={chat.otherUserPhoto} />
                    <AvatarFallback className="bg-slate-100 font-black text-slate-800">
                        {getInitials(chat.otherUserName)}
                    </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-emerald-500 rounded-full border-2 border-white shadow-sm" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex flex-col text-left">
                        <h3 className="font-black text-slate-900 text-sm uppercase italic tracking-tighter truncate pr-2">
                            {chat.otherUserName || 'Usuario'}
                        </h3>
                        {/* Indicador de múltiples hilos si aplica */}
                        {chat.isGrouped && (
                            <span className="text-[7px] font-black text-primary uppercase tracking-widest px-1.5 py-0.5 bg-primary/5 rounded border border-primary/10 w-fit">
                                Actividad en {chat.threadCount} viajes
                            </span>
                        )}
                    </div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0 ml-2">
                        {safeDate}
                    </span>
                </div>
                <p className="text-xs text-slate-500 truncate font-medium leading-none">
                    {chat.lastMessagePreview || 'Inicia una conversación...'}
                </p>
            </div>

            <div className="size-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-primary group-hover:text-white transition-all">
                <ChevronRight size={20} />
            </div>
        </div>
    );
};

const ChatList = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const [rawChats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.id) return;
        const fetchChats = async () => {
            try {
                const data = await getUserChats(user.id);
                setChats(data || []);
            } catch (e) {
                console.error("🛡️ ChatList Error:", e);
            } finally {
                setLoading(false);
            }
        };
        fetchChats();
    }, [user?.id]);

    // LÓGICA TIPO WHATSAPP: Agrupar por usuario único
    const groupedChats = useMemo(() => {
        const groups = {};
        
        rawChats.forEach(chat => {
            // Buscamos al otro participante
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
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Agrupando mensajes...</p>
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
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none text-left">Mensajes</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 text-left">Bandeja de entrada inteligente</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 space-y-4">
                {groupedChats.length > 0 ? (
                    groupedChats.map(chat => (
                        <ChatItem
                            key={chat.id}
                            chat={chat}
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
                        <h3 className="text-sm font-black text-slate-900 uppercase italic text-center">Sin conversaciones</h3>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ChatList;
