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
import { sendMessage, markChatAsRead } from '../services/chatService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase();
};

const QUICK_MESSAGES = [
    "¡Estoy llegando!",
    "Te espero allí",
    "Voy de camino",
    "Hola, ¿cómo vas?",
    "Aparcado, te espero"
];

function RideChat() {
    const { rideId, chatId } = useParams();
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
                let activeChatId = chatId;

                // Si no hay chatId en la URL, crear o recuperar el chat grupal
                if (!chatId) {
                    const { data: chatInit, error: initError } = await supabase.rpc('get_or_create_ride_chat', { p_ride_id: rideId });

                    if (initError || !chatInit?.chatId) {
                        throw new Error(initError?.message || "No se pudo inicializar el chat del viaje.");
                    }
                    activeChatId = chatInit.chatId;
                }

                // Cargar datos del viaje básicos para el header
                const { data: rideData, error: rideError } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('id', rideId)
                    .single();

                if (rideError) throw rideError;
                if (isMounted.current) setRide({ ...rideData, chat: { id: activeChatId } });

                // Cargar mensajes
                const { data: msgs, error: msgsError } = await supabase
                    .from('messages')
                    .select('*, sender:profiles!sender_id(display_name, photo_url)')
                    .eq('chat_id', activeChatId)
                    .order('created_at', { ascending: true });

                if (msgsError) throw msgsError;
                if (isMounted.current) setMessages(msgs || []);

                // MARCAR COMO LEÍDOS AL ENTRAR
                await markChatAsRead(activeChatId);

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

        // 🛡️ FIX TIEMPO REAL: Usamos el chatId real para la suscripción
        const activeChatId = chatId || ride?.chat?.id;
        if (!activeChatId) return;

        console.log("🛡️ [RideChat] Suscribiendo a tiempo real para chat:", activeChatId);

        const channelId = `chat_${activeChatId}`;
        const channel = supabase.channel(channelId)
            .on('postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `chat_id=eq.${activeChatId}`
                },
                async (payload) => {
                    if (!isMounted.current) return;
                    console.log("📨 [RideChat] Nuevo mensaje recibido vía tiempo real");

                    try {
                        // Marcar como leído si no es mío
                        if (payload.new.sender_id !== currentUser?.id) {
                            markChatAsRead(activeChatId);
                        }

                        // Evitar duplicados
                        setMessages(prev => {
                            if (prev.some(m => m.id === payload.new.id)) return prev;

                            // Cargar perfil del remitente de forma asíncrona
                            const fetchSender = async () => {
                                const { data: sender } = await supabase.from('profiles')
                                    .select('display_name, photo_url')
                                    .eq('id', payload.new.sender_id)
                                    .single();

                                if (isMounted.current) {
                                    setMessages(current => current.map(msg =>
                                        msg.id === payload.new.id ? { ...msg, sender } : msg
                                    ));
                                }
                            };
                            fetchSender();

                            return [...prev, payload.new];
                        });
                    } catch (e) {
                        console.error("🛡️ Real-time processing error:", e);
                    }
                }
            )
            .on('postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `chat_id=eq.${activeChatId}`
                },
                (payload) => {
                    if (!isMounted.current) return;
                    setMessages(prev => prev.map(msg =>
                        msg.id === payload.new.id ? { ...msg, ...payload.new } : msg
                    ));
                }
            )
            .subscribe((status) => {
                console.log(`🛡️ [RideChat] Estado suscripción (${activeChatId}):`, status);
            });

        return () => {
            console.log("🛡️ [RideChat] Liberando canal:", channelId);
            supabase.removeChannel(channel);
        };
    }, [rideId, chatId, currentUser?.id, ride?.chat?.id]);

    useEffect(() => {
        if (messages.length > 0) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault();

        // Obtenemos el ID del chat desde el estado local 'ride'
        const activeChatId = ride?.chat?.id;

        if (!newMessage.trim() || !currentUser?.id || !activeChatId || isSending) {
            console.warn("🛡️ Chat: No se cumplen las condiciones para enviar", { activeChatId, userId: currentUser?.id });
            return;
        }

        const textToSend = newMessage.trim();
        setIsSending(true);
        setNewMessage(''); // Limpiar rápido para feedback visual

        try {
            console.log("📨 Enviando mensaje al chat:", activeChatId);
            const { data, error } = await supabase
                .from('messages')
                .insert({
                    chat_id: activeChatId,
                    sender_id: currentUser.id,
                    content: textToSend
                })
                .select()
                .single();

            if (error) throw error;

            // Actualizar timestamp del chat
            await supabase.from('chats')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', activeChatId);

            console.log("✅ Mensaje enviado con éxito");
        } catch (error) {
            console.error("🛡️ stability: RideChat send failed:", error);
            toast.error("Error al enviar", { description: error.message });
            setNewMessage(textToSend); // Recuperar el texto si falla
        } finally {
            setIsSending(false);
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
        <div className="fixed inset-0 flex flex-col bg-[#F8FAFC] z-[1100]">
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-100 p-4 shrink-0 flex items-center gap-4 z-[60] pt-6 lg:pt-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-10 w-10 lg:h-12 lg:w-12 rounded-2xl bg-white shadow-sm border border-slate-100 hover:scale-105">
                    <ChevronLeft className="size-5 lg:size-6 text-slate-900" />
                </Button>

                <div className="flex-1 min-w-0" onClick={() => navigate(`/ride/${rideId}`)}>
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm lg:text-lg font-black text-slate-900 tracking-tighter truncate uppercase italic leading-none">
                            {ride.destination?.name || 'Trayecto Activo'}
                        </h2>
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <Calendar className="size-3 text-primary" />
                        <p className="text-[8px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
                            {ride.departure_time ? format(new Date(ride.departure_time), "EEEE d '•' HH:mm", { locale: es }) : '--:--'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-1 lg:gap-2">
                    <Button variant="ghost" size="icon" className="h-10 w-10 lg:h-12 lg:w-12 rounded-2xl bg-slate-50 text-slate-400 hover:text-primary transition-all">
                        <Phone className="size-4 lg:size-5" />
                    </Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 scroll-smooth bg-slate-50/50">
                <div className="bg-white/60 backdrop-blur-sm p-3 lg:p-4 rounded-3xl border border-white shadow-sm flex items-center gap-4 animate-in fade-in duration-1000">
                    <div className="size-8 lg:size-10 bg-primary/5 rounded-xl flex items-center justify-center shrink-0">
                        <ShieldCheck className="size-4 lg:size-5 text-primary" />
                    </div>
                    <p className="text-[8px] lg:text-[9px] font-black text-slate-400 uppercase tracking-widest leading-relaxed italic">
                        CHAT SEGURO • DATOS PRIVADOS PROTEGIDOS
                    </p>
                </div>

                <div className="flex flex-col gap-6 pb-4">
                    {messages.map((msg, idx) => {
                        const messageSenderId = String(msg.sender_id);
                        const currentUserId = String(currentUser?.id);
                        const isMe = messageSenderId === currentUserId;

                        const prevMsg = messages[idx - 1];
                        const showAvatar = !prevMsg || String(prevMsg.sender_id) !== messageSenderId;
                        const msgDate = new Date(msg.created_at);
                        const safeTime = isValid(msgDate) ? format(msgDate, "HH:mm") : "--:--";

                        return (
                            <div key={msg.id || idx} className={cn(
                                "flex items-end gap-3 transition-all duration-500 animate-in fade-in slide-in-from-bottom-2",
                                isMe ? "flex-row-reverse" : "flex-row"
                            )}>
                                {!isMe && (
                                    <div className="w-8 shrink-0 mb-6">
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
                                        {isMe && (
                                            <CheckCheck className={cn(
                                                "size-3 transition-colors",
                                                (msg.read_by && msg.read_by.some(uid => uid !== currentUserId))
                                                    ? "text-sky-400"
                                                    : "text-slate-300"
                                            )} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={chatEndRef} className="h-2" />
                </div>
            </main>

            <footer className="bg-white border-t border-slate-100 shrink-0 relative z-[60]">
                {/* ⚡ Quick Messages - Más compactos */}
                <div className="px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar scroll-smooth bg-slate-50/50">
                    {QUICK_MESSAGES.map((msg, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                setNewMessage(msg);
                                setTimeout(() => document.getElementById('chat-form-submit')?.click(), 50);
                            }}
                            className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-[9px] font-black text-slate-500 hover:text-primary hover:border-primary/30 transition-all whitespace-nowrap uppercase tracking-widest active:scale-95 shadow-sm"
                        >
                            {msg}
                        </button>
                    ))}
                </div>

                {/* Input Area - Ajustada para no colapsar la vista */}
                <div className="p-3 lg:p-4 pb-6 lg:pb-8 bg-white">
                    <form onSubmit={handleSendMessage} className="flex items-center gap-3 max-w-3xl mx-auto">
                        <div className="flex-1 relative">
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
                                className="w-full bg-slate-50 border-none rounded-[1.8rem] px-6 py-4 text-xs font-bold text-slate-900 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 transition-all resize-none max-h-24 min-h-[52px] shadow-inner no-scrollbar"
                                rows={1}
                            />
                        </div>
                        <Button
                            id="chat-form-submit"
                            type="submit"
                            disabled={!newMessage.trim() || isSending}
                            className="h-12 w-12 lg:h-14 lg:w-14 rounded-2xl bg-slate-900 hover:bg-primary text-white shadow-xl hover:scale-105 active:scale-95 transition-all group shrink-0"
                        >
                            {isSending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5 lg:size-6" />}
                        </Button>
                    </form>
                </div>
            </footer>
        </div>
    );
}

export default RideChat;
