import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ShieldAlert,
    Phone,
    Loader2,
    Send,
    ChevronLeft,
    AlertCircle,
    Radio,
    Users,
    Mic,
    RefreshCw,
    MessageCircle,
} from 'lucide-react';
import { getEmergencyContacts, buildGuardianWhatsAppLink } from '../services/safetyService.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

import AudioRecording from './AudioRecording';

const WAITING_MESSAGE = {
    id: 'waiting-for-emergency-chat',
    sender_id: 'system',
    content: 'Alerta registrada. Preparando el canal SOS en tiempo real. Si hay peligro inmediato, llama al 112.',
    created_at: new Date().toISOString(),
};

const FALLBACK_MESSAGE = {
    id: 'fallback-emergency-chat',
    sender_id: 'system',
    content: 'Alerta registrada. Mantén el canal abierto y llama al 112 si hay peligro inmediato.',
    created_at: new Date().toISOString(),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatMessageTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--:--';
    return format(date, 'HH:mm');
};

const EmergencyChat = () => {
    const { user } = useOutletContext();
    const { rideId } = useParams();
    const navigate = useNavigate();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [chatId, setChatId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [showBlackbox, setShowBlackbox] = useState(false);
    const [guardians, setGuardians] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const messagesEndRef = useRef(null);
    const channelRef = useRef(null);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        getEmergencyContacts(user.id).then((contacts) => {
            if (!cancelled) setGuardians((contacts || []).slice(0, 5));
        });
        return () => { cancelled = true; };
    }, [user?.id]);

    const cleanupRealtimeChannel = useCallback(() => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        }
    }, []);

    const loadMessages = useCallback(async (targetChatId) => {
        if (!targetChatId) return [];

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', targetChatId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return data || [];
    }, []);

    const findEmergencyChat = useCallback(async () => {
        const { data, error } = await supabase
            .from('chats')
            .select('id')
            .eq('ride_id', rideId)
            .eq('type', 'emergency')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data;
    }, [rideId]);

    const initEmergencyChat = useCallback(async ({ silent = false } = {}) => {
        if (!user || !rideId) return;

        let isMounted = true;
        setIsLoading(!silent);
        setConnectionStatus('connecting');
        cleanupRealtimeChannel();

        try {
            let chatData = null;

            for (let attempt = 0; attempt < 6; attempt += 1) {
                chatData = await findEmergencyChat();
                if (chatData?.id) break;

                if (!silent) setMessages([WAITING_MESSAGE]);
                await sleep(700);
            }

            if (!isMounted) return;

            if (!chatData?.id) {
                setChatId(null);
                setMessages([FALLBACK_MESSAGE]);
                setConnectionStatus('waiting');
                return;
            }

            setChatId(chatData.id);

            const loadedMessages = await loadMessages(chatData.id);
            if (!isMounted) return;
            setMessages(loadedMessages.length ? loadedMessages : [WAITING_MESSAGE]);

            const channel = supabase
                .channel(`emergency:${chatData.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'messages',
                        filter: `chat_id=eq.${chatData.id}`,
                    },
                    (payload) => {
                        setMessages((prev) => {
                            const current = prev.filter((msg) => !String(msg.id).startsWith('waiting-'));
                            if (current.find((msg) => msg.id === payload.new.id)) return current;
                            return [...current, payload.new];
                        });
                    },
                )
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') setConnectionStatus('online');
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('degraded');
                    if (status === 'CLOSED') setConnectionStatus('closed');
                });

            channelRef.current = channel;
        } catch (error) {
            console.error('🛡️ [Safety] Error loading emergency chat:', error);
            setConnectionStatus('degraded');
            setMessages([FALLBACK_MESSAGE]);
            toast.error('No se pudo conectar con el canal de seguridad.', {
                description: 'La alerta puede estar registrada. Reintenta o llama al 112 si hay peligro inmediato.',
            });
        } finally {
            setIsLoading(false);
        }

        return () => {
            isMounted = false;
        };
    }, [cleanupRealtimeChannel, findEmergencyChat, loadMessages, rideId, user]);

    useEffect(() => {
        let cancelled = false;

        const start = async () => {
            await initEmergencyChat();
            if (cancelled) cleanupRealtimeChannel();
        };

        start();

        return () => {
            cancelled = true;
            cleanupRealtimeChannel();
        };
    }, [cleanupRealtimeChannel, initEmergencyChat]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleManualRefresh = async () => {
        await initEmergencyChat({ silent: true });
        toast.success('Canal SOS actualizado');
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || isSending || !chatId) return;

        setIsSending(true);
        const text = newMessage.trim();
        setNewMessage('');

        try {
            const { error } = await supabase.from('messages').insert({
                sender_id: user.id,
                content: `SOS: ${text}`,
                chat_id: chatId,
            });

            if (error) throw error;
        } catch (error) {
            toast.error('Error al enviar señal.');
            setNewMessage(text);
        } finally {
            setIsSending(false);
        }
    };

    const statusLabel = {
        connecting: 'Conectando',
        online: 'En vivo',
        degraded: 'Reintentar',
        waiting: 'Esperando canal',
        closed: 'Cerrado',
    }[connectionStatus] || 'SOS';

    if (isLoading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-red-50 gap-4 text-center px-8">
                <Loader2 className="animate-spin text-red-600 size-8" />
                <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Conectando canal SOS...</p>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden font-sans">
            <header className="bg-red-600 p-6 text-white flex items-center gap-4 shadow-2xl z-20">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(-1)}
                    className="text-white hover:bg-white/10 rounded-2xl"
                >
                    <ChevronLeft size={24} />
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="size-5 animate-pulse" />
                        <h1 className="text-xl font-black italic uppercase tracking-tighter">Canal SOS</h1>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Conexión de emergencia del viaje</p>
                </div>
                <button
                    type="button"
                    onClick={handleManualRefresh}
                    className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 transition-all active:scale-95',
                        connectionStatus === 'online' ? 'bg-white/20' : 'bg-white text-red-600',
                    )}
                >
                    {connectionStatus === 'connecting' ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} className={connectionStatus === 'online' ? 'animate-pulse' : ''} />}
                    <span className="text-[9px] font-black uppercase">{statusLabel}</span>
                </button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowBlackbox(!showBlackbox)}
                    className={cn(
                        'rounded-2xl transition-all h-12 w-12',
                        showBlackbox ? 'bg-white text-red-600' : 'bg-white/10 text-white hover:bg-white/20',
                    )}
                >
                    <Mic size={24} />
                </Button>
            </header>

            {showBlackbox ? (
                <div className="p-6 bg-slate-50 border-b border-slate-100 animate-in slide-in-from-top duration-300">
                    <AudioRecording rideId={rideId} onRecordingComplete={() => setShowBlackbox(false)} />
                </div>
            ) : (
                <div className="bg-red-50 p-4 border-b border-red-100 flex items-start gap-3">
                    <AlertCircle className="text-red-600 size-5 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-800 font-bold leading-relaxed uppercase tracking-widest">
                        Canal SOS activo. Comparte detalles de tu situación y llama al 112 si hay peligro inmediato.
                    </p>
                </div>
            )}

            <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30 flex flex-col">
                {messages.map((msg) => {
                    const isSystem = msg.sender_id === 'system';
                    const isMe = msg.sender_id === user.id;

                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                'flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2',
                                isMe ? 'self-end items-end' : 'self-start items-start',
                            )}
                        >
                            <div className={cn(
                                'px-6 py-4 rounded-3xl shadow-sm text-sm font-medium leading-relaxed',
                                isSystem ? 'bg-white border-2 border-red-100 text-red-900 italic' :
                                    isMe ? 'bg-slate-900 text-white rounded-tr-md' : 'bg-white text-slate-800 rounded-tl-md border border-slate-100',
                            )}>
                                {msg.content}
                            </div>
                            <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest mt-1 px-2">
                                {formatMessageTime(msg.created_at)}
                            </span>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </main>

            <footer className="p-6 pb-10 bg-white border-t border-slate-100">
                <form onSubmit={handleSendMessage} className="max-w-2xl mx-auto flex items-center gap-4">
                    <div className="flex-1 relative">
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder={chatId ? 'Describe tu situación...' : 'Esperando canal SOS...'}
                            disabled={!chatId}
                            className="w-full bg-slate-50 border-2 border-red-50 rounded-3xl px-8 py-5 text-sm font-bold text-slate-900 focus:border-red-500 focus:ring-4 focus:ring-red-50 transition-all resize-none max-h-32 min-h-[64px] disabled:opacity-60 disabled:cursor-not-allowed"
                            rows={1}
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={isSending || !newMessage.trim() || !chatId}
                        className="h-16 w-16 rounded-3xl bg-red-600 hover:bg-red-700 text-white shadow-2xl shadow-red-200 active:scale-90 transition-all group shrink-0 disabled:opacity-50"
                    >
                        {isSending ? <Loader2 className="animate-spin" /> : <Send className="size-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                    </Button>
                </form>
                {guardians.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5 pb-1">
                        {guardians.map((g) => {
                            const link = buildGuardianWhatsAppLink(g.phone, { name: user?.user_metadata?.full_name || 'ShareWay', rideId });
                            if (!link) return null;
                            return (
                                <a key={g.id} href={link} target="_blank" rel="noopener noreferrer"
                                   className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-normal active:scale-95 transition-transform">
                                    <MessageCircle size={12} /> Avisar a {g.name}
                                </a>
                            );
                        })}
                    </div>
                )}
                <div className="flex justify-center mt-4 gap-6">
                    <a href="tel:112" className="flex items-center gap-2 text-red-600 font-black text-[10px] uppercase tracking-widest hover:underline">
                        <Phone size={14} /> Llamar al 112
                    </a>
                    <button onClick={() => navigate('/settings/emergency')} className="flex items-center gap-2 text-slate-400 font-black text-[10px] uppercase tracking-normal hover:underline">
                        <Users size={14} /> Mis Contactos
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default EmergencyChat;
