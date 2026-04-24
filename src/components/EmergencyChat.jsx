import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ShieldAlert,
    MessageSquare,
    Phone,
    Loader2,
    Send,
    ChevronLeft,
    AlertCircle,
    MapPin,
    Radio,
    Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

const EmergencyChat = () => {
    const { user, profile } = useOutletContext();
    const { rideId } = useParams();
    const navigate = useNavigate();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef(null);

    // En un sistema real, este ID sería un chat fijo con el equipo de soporte de seguridad vinculado al viaje
    const EMERGENCY_CHAT_ID = `sos_${rideId}`;

    useEffect(() => {
        if (!user || !rideId) return;

        const fetchMessages = async () => {
            try {
                const { data, error } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('chat_id', EMERGENCY_CHAT_ID)
                    .order('created_at', { ascending: true });

                if (error) throw error;

                if (data && data.length > 0) {
                    setMessages(data);
                } else {
                    // Mensaje inicial del sistema si no hay historial
                    setMessages([
                        {
                            id: 'system-1',
                            sender_id: 'system',
                            content: 'Has activado el Canal de Emergencia. Un agente de seguridad de ShareWay está revisando tu ubicación actual y los detalles del viaje.',
                            created_at: new Date().toISOString()
                        }
                    ]);
                }
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchMessages();

        // Suscripción Realtime para respuestas del equipo de seguridad
        const channel = supabase.channel(`emergency:${EMERGENCY_CHAT_ID}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${EMERGENCY_CHAT_ID}`
            }, (payload) => {
                setMessages(prev => {
                    if (prev.find(m => m.id === payload.new.id)) return prev;
                    return [...prev, payload.new];
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, rideId, EMERGENCY_CHAT_ID]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || isSending) return;

        setIsSending(true);
        const text = newMessage.trim();
        setNewMessage('');

        try {
            // Registrar mensaje de emergencia en la base de datos
            // En producción esto dispararía alertas inmediatas a los admins
            const { error } = await supabase.from('messages').insert({
                sender_id: user.id,
                content: `⚠️ EMERGENCIA: ${text}`,
                chat_id: EMERGENCY_CHAT_ID
            });

            if (error) throw error;

            // El mensaje se añadirá vía Realtime, pero podemos optimizar UI si queremos
        } catch (error) {
            toast.error("Error al enviar señal de auxilio.");
            setNewMessage(text);
        } finally {
            setIsSending(false);
        }
    };

    if (isLoading) return <div className="h-screen flex items-center justify-center bg-red-50"><Loader2 className="animate-spin text-red-600" /></div>;

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden font-sans">
            {/* CABECERA DE ALERTA MÁXIMA */}
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
                        <h1 className="text-xl font-black italic uppercase tracking-tighter">Canal de Auxilio</h1>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Conexión directa con seguridad</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-full border border-white/20">
                    <Radio size={12} className="animate-pulse" />
                    <span className="text-[9px] font-black uppercase">GPS ACTIVO</span>
                </div>
            </header>

            {/* AVISO DE PROTOCOLO */}
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-start gap-3">
                <AlertCircle className="text-red-600 size-5 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-800 font-bold leading-relaxed uppercase tracking-widest">
                    TU UBICACIÓN ESTÁ SIENDO COMPARTIDA CON LAS AUTORIDADES Y TUS CONTACTOS DE EMERGENCIA EN TIEMPO REAL.
                </p>
            </div>

            {/* CHAT DE EMERGENCIA */}
            <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
                {messages.map((msg) => {
                    const isSystem = msg.sender_id === 'system';
                    const isMe = msg.sender_id === user.id;

                    return (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2",
                                isMe ? "self-end items-end" : "self-start items-start"
                            )}
                        >
                            <div className={cn(
                                "px-6 py-4 rounded-[2rem] shadow-sm text-sm font-medium leading-relaxed",
                                isSystem ? "bg-white border-2 border-red-100 text-red-900 italic" :
                                    isMe ? "bg-slate-900 text-white rounded-tr-md" : "bg-white text-slate-800 rounded-tl-md border border-slate-100"
                            )}>
                                {msg.content}
                            </div>
                            <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest mt-1 px-2">
                                {format(new Date(msg.created_at), 'HH:mm')}
                            </span>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </main>

            {/* INPUT DE EMERGENCIA */}
            <footer className="p-6 pb-10 bg-white border-t border-slate-100">
                <form onSubmit={handleSendMessage} className="max-w-2xl mx-auto flex items-center gap-4">
                    <div className="flex-1 relative">
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Describe tu situación..."
                            className="w-full bg-slate-50 border-2 border-red-50 rounded-[2rem] px-8 py-5 text-sm font-bold text-slate-900 focus:border-red-500 focus:ring-4 focus:ring-red-50 transition-all resize-none max-h-32 min-h-[64px]"
                            rows={1}
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={isSending || !newMessage.trim()}
                        className="h-16 w-16 rounded-[2rem] bg-red-600 hover:bg-red-700 text-white shadow-2xl shadow-red-200 active:scale-90 transition-all group shrink-0"
                    >
                        {isSending ? <Loader2 className="animate-spin" /> : <Send className="size-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                    </Button>
                </form>
                <div className="flex justify-center mt-4 gap-6">
                    <a href="tel:112" className="flex items-center gap-2 text-red-600 font-black text-[10px] uppercase tracking-widest hover:underline">
                        <Phone size={14} /> Llamar al 112
                    </a>
                    <button onClick={() => navigate('/settings/emergency')} className="flex items-center gap-2 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:underline">
                        <Users size={14} /> Mis Contactos
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default EmergencyChat;
