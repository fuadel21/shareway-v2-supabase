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
    Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

const QUICK_MESSAGES = [
    "¡Ya estoy en el punto! 📍",
    "Te veo en 2 min ⌚",
    "He llegado al destino ✅",
    "¿Por dónde vas? 🤔",
    "¡Gracias! 👋"
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
                // Obtener datos del chat
                const { data: chatData, error: chatError } = await supabase
                    .from('chats')
                    .select('*')
                    .eq('id', chatId)
                    .single();

                if (chatError) throw chatError;

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
                        <AvatarFallback className="bg-slate-900 text-white font-black text-sm">
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
                    <div className="size-14 bg-white rounded-[1.5rem] shadow-lg flex items-center justify-center border border-slate-100">
                        <ShieldCheck className="text-indigo-500 size-6" />
                    </div>
                    <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-300 text-center">Protocolo de Mensajería Blindada</p>
                </div>

                <div className="flex flex-col gap-6">
                    {messages.map((msg) => {
                        const isMe = msg.sender_id === user?.id;
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
                                        ? "bg-slate-900 text-white rounded-[2rem] rounded-tr-[0.5rem]" 
                                        : "bg-white text-slate-700 rounded-[2rem] rounded-tl-[0.5rem] border border-slate-100"
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

            <div className="bg-white/50 backdrop-blur-md px-4 py-3 border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar scroll-smooth">
                {QUICK_MESSAGES.map((msg, i) => (
                    <button
                        key={i}
                        onClick={() => handleSendMessage(msg)}
                        disabled={isSending}
                        className="whitespace-nowrap px-4 py-2 bg-white rounded-full border border-slate-100 shadow-sm text-[9px] font-black uppercase tracking-tight text-slate-500 hover:text-primary transition-all active:scale-95 flex items-center gap-2"
                    >
                        <Zap size={10} className="text-amber-400 fill-current" /> {msg}
                    </button>
                ))}
            </div>

            <footer className="p-6 pb-10 bg-white border-t border-slate-100">
                <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="max-w-2xl mx-auto flex items-end gap-3">
                    <div className="flex-1 bg-slate-50 rounded-[2rem] px-6 py-4 shadow-inner">
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
                        className="size-14 rounded-[1.5rem] bg-slate-900 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex-shrink-0"
                    >
                        {isSending ? <Loader2 className="animate-spin size-5" /> : <Send size={20} />}
                    </Button>
                </form>
            </footer>
        </div>
    );
};

export default Chat;
