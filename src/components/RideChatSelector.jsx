import { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Card } from '@/components/ui/card.jsx';
import SubPageHeader from './SubPageHeader';
import { Loader2, MessageCircle, Users, ChevronRight, User } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

function RideChatSelector() {
    const { rideId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const [chats, setChats] = useState([]);
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!rideId || !user?.id) return;

        const loadChats = async () => {
            try {
                // Cargar información del viaje
                const { data: rideData, error: rideError } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('id', rideId)
                    .single();

                if (rideError) throw rideError;
                setRide(rideData);

                // Cargar chats del viaje
                const { data: chatsData, error: chatsError } = await supabase
                    .rpc('get_ride_chats', { p_ride_id: rideId });

                if (chatsError) throw chatsError;
                setChats(chatsData || []);

            } catch (error) {
                console.error('Error loading chats:', error);
                toast.error('Error al cargar conversaciones');
            } finally {
                setLoading(false);
            }
        };

        loadChats();

        // Suscripción en tiempo real para nuevos mensajes
        const subscription = supabase
            .channel(`ride-chats-${rideId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chats',
                filter: `ride_id=eq.${rideId}`
            }, () => {
                loadChats();
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [rideId, user]);

    const getChatTitle = (chat) => {
        if (chat.chat_type === 'group') {
            return 'Chat Grupal del Viaje';
        }

        // Chat individual: mostrar el nombre del otro participante
        const otherUserId = chat.participants.find(id => id !== user.id);
        return chat.participant_names?.[otherUserId] || 'Usuario';
    };

    const getChatSubtitle = (chat) => {
        if (!chat.last_message) return 'Sin mensajes';

        const content = chat.last_message.content || '';
        const maxLength = 50;
        return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
    };

    const getOtherUserAvatar = (chat) => {
        if (chat.chat_type === 'group') return null;

        // Aquí podrías cargar la foto del otro usuario si la tienes en participant_names
        return null;
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans text-left">
            <SubPageHeader title="Conversaciones" />

            <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
                {/* Header del viaje */}
                {ride && (
                    <Card className="p-4 rounded-3xl border-none shadow-lg bg-white">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-2xl bg-primary/10">
                                <MessageCircle className="h-6 w-6 text-primary" />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight italic">
                                    {ride.origin?.address || 'Origen'} → {ride.destination?.address || 'Destino'}
                                </h2>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                    {ride.departure_time && format(new Date(ride.departure_time), "d MMM yyyy, HH:mm", { locale: es })}
                                </p>
                            </div>
                        </div>
                    </Card>
                )}

                {/* Lista de chats */}
                <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4">
                        Tus Conversaciones
                    </h3>

                    {chats.length === 0 ? (
                        <Card className="p-12 rounded-3xl border-2 border-dashed border-slate-200 text-center">
                            <MessageCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                            <p className="text-sm font-bold text-slate-400">No hay conversaciones disponibles</p>
                        </Card>
                    ) : (
                        chats.map((chat) => (
                            <Card
                                key={chat.chat_id}
                                className="p-6 rounded-3xl border-none shadow-md hover:shadow-xl transition-all cursor-pointer bg-white relative overflow-hidden"
                                onClick={() => navigate(`/rides/${rideId}/chat/${chat.chat_id}`)}
                            >
                                <div className="flex items-center gap-4">
                                    {/* Avatar */}
                                    <div className="relative">
                                        <Avatar className="h-14 w-14 border-2 border-white shadow-lg">
                                            {chat.chat_type === 'group' ? (
                                                <div className="h-full w-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                                                    <Users className="h-7 w-7 text-white" />
                                                </div>
                                            ) : (
                                                <>
                                                    <AvatarImage src={getOtherUserAvatar(chat)} />
                                                    <AvatarFallback className="bg-slate-900 text-white font-black text-sm">
                                                        {getInitials(getChatTitle(chat))}
                                                    </AvatarFallback>
                                                </>
                                            )}
                                        </Avatar>
                                        {chat.unread_count > 0 && (
                                            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black rounded-full h-6 w-6 flex items-center justify-center border-2 border-white shadow-lg">
                                                {chat.unread_count > 9 ? '9+' : chat.unread_count}
                                            </div>
                                        )}
                                    </div>

                                    {/* Contenido */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-base font-black text-slate-900 uppercase tracking-tight italic truncate">
                                                {getChatTitle(chat)}
                                            </h3>
                                            {chat.chat_type === 'group' && (
                                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[8px] font-black uppercase tracking-wider rounded-full">
                                                    Grupal
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 font-medium truncate">
                                            {getChatSubtitle(chat)}
                                        </p>
                                        {chat.last_message?.created_at && (
                                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                                                {format(new Date(chat.last_message.created_at), "HH:mm", { locale: es })}
                                            </p>
                                        )}
                                    </div>

                                    {/* Flecha */}
                                    <ChevronRight className="h-5 w-5 text-slate-300" />
                                </div>
                            </Card>
                        ))
                    )}
                </div>

                {/* Botón para volver */}
                <Button
                    variant="ghost"
                    className="w-full rounded-2xl font-black text-xs uppercase tracking-widest text-slate-400 hover:text-slate-900"
                    onClick={() => navigate(`/rides/${rideId}`)}
                >
                    Volver a Detalles del Viaje
                </Button>
            </main>
        </div>
    );
}

export default RideChatSelector;
