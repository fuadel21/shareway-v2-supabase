import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getUserChats } from '@/services/chatService';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, MessageSquare, ChevronRight, Sparkles, ShieldCheck, ChevronLeft } from 'lucide-react';
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
            onClick={() => onClick(chat.id)}
            className="group flex items-center gap-4 p-5 bg-white border border-slate-100 rounded-[2.5rem] hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-500"
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
                        {chat.isRideChat && (
                            <div className="flex items-center gap-1 mt-0.5">
                                <div className="px-1.5 py-0.5 bg-primary/10 rounded-md text-[7px] font-black text-primary uppercase tracking-widest border border-primary/20">
                                    VIAJE
                                </div>
                            </div>
                        )}
                    </div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
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
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.id) return;

        const fetchChats = async () => {
            try {
                const data = await getUserChats(user.id);
                setChats((data || []).filter(c => c && c.id));
            } catch (e) {
                console.error("🛡️ ChatList Error:", e);
            } finally {
                setLoading(false);
            }
        };

        fetchChats();
    }, [user?.id]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Sincronizando...</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans">
            {/* CABECERA CON BOTÓN ATRÁS (Corregido) */}
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="rounded-2xl bg-slate-50 size-12">
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none text-left">Mensajes</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 text-left">Elite Coordination Hub</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 space-y-4">
                {chats.length > 0 ? (
                    chats.map(chat => (
                        <ChatItem
                            key={chat.id}
                            chat={chat}
                            onClick={(id) => {
                                // 🛡️ Blindaje de Redirección: Si el chat tiene ride_id, es un chat grupal
                                if (chat.ride_id) {
                                    navigate(`/ride-chat/${chat.ride_id}`);
                                } else {
                                    navigate(`/chat/${id}`);
                                }
                            }}
                        />
                    ))
                ) : (
                    <div className="py-24 text-center bg-white rounded-[3rem] border border-dashed border-slate-200 animate-in fade-in">
                        <MessageSquare className="h-12 w-12 text-slate-100 mx-auto mb-4" />
                        <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1 text-center">Bandeja Vacía</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center px-10">
                            Tus conversaciones aparecerán aquí.
                        </p>
                    </div>
                )}

                <div className="bg-slate-900 p-8 rounded-[3rem] relative overflow-hidden group shadow-2xl mt-8">
                    <div className="absolute top-0 right-0 p-8 opacity-5 transition-transform duration-1000 group-hover:scale-110">
                        <ShieldCheck size={120} className="text-white" />
                    </div>
                    <div className="relative z-10 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="size-8 rounded-xl bg-primary flex items-center justify-center">
                                <Sparkles className="size-4 text-slate-950" />
                            </div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Privacidad Militar</h4>
                        </div>
                        <p className="text-[10px] font-bold text-white/40 leading-relaxed uppercase tracking-widest italic text-left">
                            Tus mensajes están protegidos. ShareWay cifra las comunicaciones entre conductores y pasajeros para tu seguridad.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ChatList;
