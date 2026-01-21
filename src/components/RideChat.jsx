import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import SubPageHeader from './SubPageHeader';
import {
    Loader2,
    Send,
    Phone,
    Info,
    ChevronLeft,
    MapPin,
    ShieldCheck,
    Sparkles,
    MoreVertical,
    CheckCheck,
    Calendar,
    ArrowRight
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendMessage } from '../services/chatService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase();
};

function RideChat() {
    const { rideId } = useParams();
    const navigate = useNavigate();
    const { profile: currentUserProfile, user: currentUser } = useOutletContext();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const chatEndRef = useRef(null);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    useEffect(() => {
        if (!rideId || !currentUser?.id) return;

        const initChat = async () => {
            try {
                const { data: rideData, error: rideError } = await supabase
                    .from('rides')
                    .select('*, chat:chats!inner(id)')
                    .eq('id', rideId)
                    .single();

                if (rideError || !rideData?.chat) throw rideError || new Error("Chat no disponible.");
                if (isMounted.current) setRide(rideData);

                const { data: msgs, error: msgsError } = await supabase
                    .from('messages')
                    .select('*, sender:profiles!sender_id(display_name, photo_url)')
                    .eq('chat_id', rideData.chat.id)
                    .order('created_at', { ascending: true });

                if (msgsError) throw msgsError;
                if (isMounted.current) setMessages(msgs || []);

            } catch (error) {
                console.error("🛡️ stability: RideChat init failed:", error);
                if (isMounted.current) {
                    toast.error("Error de conexión", { description: "No pudimos cargar la conversación del trayecto." });
                }
            } finally {
                if (isMounted.current) setLoading(false);
            }
        };

        initChat();

        const channelId = `ride_chat_${rideId}_${Date.now()}`;
        const channel = supabase.channel(channelId)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                async (payload) => {
                    if (isMounted.current && ride?.chat && payload.new.chat_id === ride.chat.id) {
                        try {
                            const { data: sender } = await supabase.from('profiles').select('display_name, photo_url').eq('id', payload.new.sender_id).single();
                            if (isMounted.current) {
                                setMessages(prev => {
                                    if (prev.some(m => m.id === payload.new.id)) return prev;
                                    return [...prev, { ...payload.new, sender }];
                                });
                            }
                        } catch (e) { console.error(e); }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId, currentUser?.id, ride?.chat?.id]);

    useEffect(() => {
        if (messages.length > 0) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        const chat_id = ride?.chat?.id;
        if (!newMessage.trim() || !currentUser || !chat_id || isSending) return;

        const textToSend = newMessage.trim();
        if (isMounted.current) {
            setNewMessage('');
            setIsSending(true);
        }

        try {
            await sendMessage(chat_id, currentUser.id, textToSend);
        } catch (error) {
            console.error("🛡️ stability: RideChat send failed:", error);
            if (isMounted.current) {
                toast.error("Error de envío");
                setNewMessage(textToSend);
            }
        } finally {
            if (isMounted.current) setIsSending(false);
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="animate-spin h-10 w-10 text-primary" strokeWidth={1.5} />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Entrando a la sala...</p>
            </div>
        );
    }

    if (!ride?.chat?.id) {
        return (
            <div className="h-screen flex flex-col bg-slate-50">
                <SubPageHeader title="Chat No Disponible" />
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
                    <div className="size-24 bg-white rounded-[2rem] shadow-xl flex items-center justify-center">
                        <Info className="size-10 text-slate-200" />
                    </div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                        El chat para este viaje aún no está activo o ha sido finalizado.
                    </p>
                    <Button onClick={() => navigate(-1)} variant="outline" className="rounded-xl font-black text-[10px] uppercase h-12">Volver</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-[#F8FAFC] overflow-hidden">
            <header className="bg-white/70 backdrop-blur-3xl border-b border-slate-100 p-4 sticky top-0 z-50 flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-12 w-12 rounded-2xl bg-white shadow-sm border border-slate-100 hover:scale-105">
                    <ChevronLeft className="size-6 text-slate-900" />
                </Button>

                <div className="flex-1 min-w-0" onClick={() => navigate(`/ride/${rideId}`)}>
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900 tracking-tighter truncate uppercase italic leading-none">
                            {ride.destination?.name || 'Trayecto Activo'}
                        </h2>
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <Calendar className="size-3 text-primary" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
                            {ride.departure_time ? format(new Date(ride.departure_time), "EEEE d '•' HH:mm", { locale: es }) : '--:--'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 hover:text-primary transition-all">
                        <Phone className="size-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 hover:text-slate-900">
                        <MoreVertical className="size-5" />
                    </Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4 animate-in fade-in duration-1000">
                    <div className="size-10 bg-primary/5 rounded-xl flex items-center justify-center shrink-0">
                        <ShieldCheck className="size-5 text-primary" />
                    </div>
                    <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest leading-relaxed">
                        COMUNICACIÓN CIFRADA PUNTO A PUNTO. TUS DATOS PERSONALES NO SON VISIBLES.
                    </p>
                </div>

                <div className="flex flex-col gap-6">
                    {(messages || []).map((msg, idx) => {
                        const isMe = msg.sender_id === currentUser.id;
                        const prevMsg = messages[idx - 1];
                        const showAvatar = !prevMsg || prevMsg.sender_id !== msg.sender_id;
                        const msgDate = new Date(msg.created_at);
                        const safeTime = isValid(msgDate) ? format(msgDate, "HH:mm") : "--:--";

                        return (
                            <div key={msg.id || idx} className={cn(
                                "flex items-end gap-3 transition-all duration-500 animate-in fade-in slide-in-from-bottom-2",
                                isMe ? "flex-row-reverse" : "flex-row"
                            )}>
                                {!isMe && (
                                    <div className="w-8 shrink-0">
                                        {showAvatar ? (
                                            <Avatar className="h-8 w-8 border-2 border-white shadow-md">
                                                <AvatarImage src={msg.sender?.photo_url} />
                                                <AvatarFallback className="bg-slate-100 text-slate-400 text-[10px] font-black">
                                                    {getInitials(msg.sender?.display_name)}
                                                </AvatarFallback>
                                            </Avatar>
                                        ) : null}
                                    </div>
                                )}

                                <div className={cn("flex flex-col max-w-[75%] space-y-1", isMe ? "items-end" : "items-start")}>
                                    {!isMe && showAvatar && (
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-0.5">
                                            {msg.sender?.display_name || 'Usuario'}
                                        </p>
                                    )}
                                    <div className={cn(
                                        "px-5 py-4 text-sm font-bold shadow-xl transition-all hover:scale-[1.01]",
                                        isMe
                                            ? "bg-navy text-white rounded-[2rem] rounded-tr-[0.5rem] shadow-slate-200/50"
                                            : "bg-white text-slate-800 rounded-[2rem] rounded-bl-[0.5rem] shadow-slate-100/50 border border-slate-100"
                                    )}>
                                        <p className="leading-relaxed tracking-tight">{msg.content || ''}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-1">
                                        <span className="text-[8px] font-black text-slate-300 uppercase letter-spacing-widest">
                                            {safeTime}
                                        </span>
                                        {isMe && <CheckCheck className="size-3 text-primary/40" />}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={chatEndRef} className="h-2" />
                </div>
            </main>

            <footer className="bg-white/80 backdrop-blur-2xl p-6 border-t border-slate-100 pb-10">
                <form onSubmit={handleSendMessage} className="flex items-center gap-4 max-w-xl mx-auto">
                    <div className="flex-1 relative group">
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage(e);
                                }
                            }}
                            placeholder="Escribe un mensaje..."
                            className="w-full bg-slate-50 border-none rounded-[2rem] px-8 py-5 text-sm font-bold text-slate-900 placeholder:text-slate-300 focus:ring-4 focus:ring-primary/10 transition-all resize-none max-h-32 min-h-[64px] shadow-inner"
                            rows={1}
                        />
                    </div>
                    <Button type="submit" disabled={!newMessage.trim() || isSending} className="h-16 w-16 rounded-[2rem] bg-navy hover:bg-navy-600 text-white shadow-2xl shadow-slate-900/40 hover:scale-110 active:scale-90 transition-all group shrink-0">
                        {isSending ? <Loader2 className="size-6 animate-spin" /> : <Send className="size-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                    </Button>
                </form>
            </footer >
        </div>
    );
}

export default RideChat;
