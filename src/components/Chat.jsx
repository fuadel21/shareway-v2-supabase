import React, { useState, useEffect, useRef, useCallback } from 'react'; // ✅ CORREGIDO: useCallback añadido
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { sendMessage as sendMessageService } from '@/services/chatService';
import { toast } from 'sonner';

// --- UI & Icons ---
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
    Loader2, Send, ShieldCheck, MoreVertical,
    Phone, ChevronLeft, Sparkles, CheckCheck,
    Zap, Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

const QUICK_MESSAGES_CATEGORIES = [
    {
        label: "Estado",
        items: [
            "¡Ya estoy en el punto! 📍",
            "Te veo en 2 min ⌚",
            "¿Por dónde vas? 🤔",
            "He llegado al punto de encuentro 👋",
            "Ya estoy en el coche 🚗",
            "Salgo ahora mismo 🏃‍♂️",
            "Estoy bajando 🛗"
        ]
    },
    {
        label: "Retrasos",
        items: [
            "Llego 5 min tarde, perdón 🙏",
            "Hay un poco de tráfico 🚦",
            "Me he perdido un poco, ahora llego 🧭",
            "Espérame un minuto por favor, llego ya 🙇‍♂️"
        ]
    },
    {
        label: "Cortesía",
        items: [
            "¡Muchas gracias! ✨",
            "¡Buen viaje! 👋",
            "Ok, perfecto 👍",
            "Entendido ✅",
            "¡Genial! 🌟",
            "Sin problema 👌"
        ]
    }
];

const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) return '?';
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const Chat = () => {
    const { chatId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();

    const [otherUser, setOtherUser] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [isChatActive, setIsChatActive] = useState(true);
    const [expirationMessage, setExpirationMessage] = useState('');

    const messagesEndRef = useRef(null);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    // 1. Carga Inicial de Datos (Fetch & Sync)
    useEffect(() => {
        if (!user || !chatId) return;

        const fetchChatData = async () => {
            try {
                // Obtener datos del chat y del ride asociado
                const { data: chatData, error: chatError } = await supabase
                    .from('chats')
                    .select(`
                        *,
                        ride:rides(status, completed_at, cancelled_at)
                    `)
                    .eq('id', chatId)
                    .single();

                if (chatError) throw chatError;

                // REGLA DE 24 HORAS
                if (chatData.ride) {
                    const ride = chatData.ride;
                    const finishedAt = ride.completed_at || ride.cancelled_at;

                    if (finishedAt && (ride.status === 'completed' || ride.status === 'cancelled')) {
                        const expiryDate = new Date(finishedAt);
                        expiryDate.setHours(expiryDate.getHours() + 24);

                        if (new Date() > expiryDate) {
                            setIsChatActive(false);
                            setExpirationMessage("Este chat se ha cerrado automáticamente 24h después del viaje.");
                        }
                    }
                }

                // Identificar al otro usuario
                const otherId = chatData?.participants?.find(p => p !== user.id);
                if (otherId) {
                    const { data: profileData } = await supabase
                        .from('profiles')
                        .select('id, display_name, photo_url')
                        .eq('id', otherId)
                        .single();
                    if (isMounted.current) setOtherUser(profileData);
                }

                // Cargar mensajes previos
                const { data: msgs, error: msgsError } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('chat_id', chatId)
                    .order('created_at', { ascending: true });

                if (msgsError) throw msgsError;
                if (isMounted.current) {
                    setMessages(msgs || []);
                    setTimeout(() => scrollToBottom('auto'), 100);
                }

            } catch (error) {
                console.error("🛡️ stability: Chat initialization failed:", error);
                toast.error("No se pudo cargar la conversación");
            } finally {
                if (isMounted.current) setIsLoading(false);
            }
        };

        fetchChatData();

        // SUSCRIPCIÓN REALTIME MEJORADA
        const channel = supabase.channel(`realtime_chat_${chatId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
                (payload) => {
                    if (isMounted.current && payload.new) {
                        setMessages(prev => {
                            const exists = prev.some(m => m.id === payload.new.id);
                            if (exists) return prev;
                            return [...prev, payload.new];
                        });
                    }
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [chatId, user, scrollToBottom]);

    // Auto-scroll al recibir mensajes
    useEffect(() => {
        if (messages.length > 0) scrollToBottom();
    }, [messages, scrollToBottom]);

    const handleSendMessage = async (text) => {
        if (!isChatActive) {
            toast.error("Este chat ha expirado.");
            return;
        }
        const messageContent = typeof text === 'string' ? text : newMessage.trim();
        if (!messageContent || isSending || !chatId) return;

        setIsSending(true);
        if (typeof text !== 'string') setNewMessage('');

        try {
            await sendMessageService(chatId, user.id, messageContent);
        } catch (error) {
            console.error("🛡️ stability: sendMessage failed:", error);
            toast.error("Error al enviar mensaje");
            if (typeof text !== 'string') setNewMessage(messageContent);
        } finally {
            if (isMounted.current) setIsSending(false);
        }
    };

    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="animate-spin text-primary h-8 w-8 opacity-20" />
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-[#F8FAFC] overflow-hidden text-left">
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-100 p-4 sticky top-0 z-50 flex items-center gap-4 shadow-sm">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-12 w-12 rounded-2xl bg-slate-50 border border-slate-100">
                    <ChevronLeft className="size-6 text-slate-900" />
                </Button>

                <div className="flex-1 flex items-center gap-3">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={otherUser?.photo_url} />
                        <AvatarFallback className="bg-gradient-to-br from-[#1267FF] to-[#0FC6A6] text-white font-black text-sm">
                            {getInitials(otherUser?.display_name || 'U')}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <h2 className="font-black text-slate-900 text-sm tracking-tight uppercase italic truncate">
                            {otherUser?.display_name || 'Chat Privado'}
                        </h2>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse" />
                            <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Chat Activo</p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400"><Phone size={18} /></Button>
                    <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400"><MoreVertical size={18} /></Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="flex flex-col items-center py-8 space-y-3">
                    <div className="size-14 bg-white rounded-2xl shadow-lg flex items-center justify-center border border-slate-100">
                        <ShieldCheck className="text-indigo-500 size-6" />
                    </div>
                    <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-300 text-center">Protocolo de Mensajería Blindada</p>
                </div>

                <div className="flex flex-col gap-6">
                    {messages.map((msg) => {
                        const isMe = String(msg.sender_id) === String(user?.id);
                        const dateObj = new Date(msg.created_at);
                        const safeTime = isValid(dateObj) ? format(dateObj, "HH:mm", { locale: es }) : '--:--';

                        return (
                            <div key={msg.id} className={cn(
                                "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2",
                                isMe ? "self-end items-end text-right" : "self-start items-start text-left"
                            )}>
                                <div className={cn(
                                    "px-6 py-4 shadow-xl relative group transition-all",
                                    isMe
                                        ? "bg-slate-900 text-white rounded-3xl rounded-tr-[0.5rem]"
                                        : "bg-white text-slate-700 rounded-3xl rounded-tl-[0.5rem] border border-slate-100"
                                )}>
                                    <p className="text-sm font-bold tracking-tight leading-relaxed">{msg.content}</p>
                                </div>
                                <div className="flex items-center gap-1 mt-1.5 px-2">
                                    <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">{safeTime}</span>
                                    {isMe && <CheckCheck size={10} className="text-primary/40" />}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} className="h-4" />
                </div>
            </main>

            {isChatActive ? (
                <>
                    <div className="bg-white/80 backdrop-blur-xl px-4 py-4 border-t border-slate-100 flex flex-col gap-3 overflow-hidden">
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                            {QUICK_MESSAGES_CATEGORIES.map((cat, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <span className="text-[7px] font-black uppercase tracking-[0.2em] text-slate-400 bg-slate-100 px-2 py-1 rounded-md mb-0.5 whitespace-nowrap">
                                        {cat.label}
                                    </span>
                                    {cat.items.map((msg, i) => (
                                        <button
                                            key={`${idx}-${i}`}
                                            onClick={() => handleSendMessage(msg)}
                                            disabled={isSending}
                                            className="whitespace-nowrap px-4 py-2 bg-white rounded-2xl border border-slate-100 shadow-sm text-[10px] font-bold tracking-tight text-slate-600 hover:text-primary hover:border-primary/30 transition-all active:scale-95 flex items-center gap-2 group shrink-0"
                                        >
                                            <Zap size={10} className="text-amber-400 group-hover:scale-125 transition-transform" /> {msg}
                                        </button>
                                    ))}
                                    {idx < QUICK_MESSAGES_CATEGORIES.length - 1 && <div className="w-px h-6 bg-slate-100 mx-2" />}
                                </div>
                            ))}
                        </div>
                    </div>

                    <footer className="p-6 pb-10 bg-white border-t border-slate-100">
                        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="max-w-2xl mx-auto flex items-end gap-3">
                            <div className="flex-1 bg-slate-50 rounded-3xl px-6 py-4 shadow-inner">
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    placeholder="Escribe un mensaje..."
                                    className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-900 resize-none max-h-32 min-h-[24px]"
                                    rows={1}
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={isSending || !newMessage.trim()}
                                className="size-14 rounded-2xl bg-primary text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex-shrink-0"
                            >
                                {isSending ? <Loader2 className="animate-spin size-5" /> : <Send size={20} />}
                            </Button>
                        </form>
                    </footer>
                </>
            ) : (
                <div className="p-10 mb-10 text-center animate-in fade-in slide-in-from-bottom-5">
                    <div className="max-w-xs mx-auto bg-slate-100/80 backdrop-blur-md p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="size-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                            <Lock className="text-slate-400 size-6" />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 leading-tight">Canal Cerrado</p>
                        <p className="text-[11px] font-medium text-slate-400 italic">
                            {expirationMessage || "Este chat ha sido desactivado automáticamente tras el periodo de gracia de 24h."}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Chat;
