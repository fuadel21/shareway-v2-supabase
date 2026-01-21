import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { getUserChats } from '@/services/chatService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, MessageSquare, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase();
};

function ConversationsList() {
    const { user } = useOutletContext();
    const { chatId: activeChatId } = useParams();
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchConversations = async () => {
        if (!user?.id) return;
        try {
            const chats = await getUserChats(user.id);
            setConversations(chats);
        } catch (error) {
            console.error("Error fetching conversations: ", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConversations();
    }, [user]);

    if (loading) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-10 space-y-4">
                <div className="h-16 w-16 bg-slate-50 rounded-3xl flex items-center justify-center animate-pulse">
                    <Loader2 className="animate-spin h-8 w-8 text-primary" />
                </div>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Sincronizando chats...</p>
            </div>
        );
    }

    if (conversations.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-6">
                <div className="h-24 w-24 bg-white rounded-[2rem] shadow-xl flex items-center justify-center border border-slate-50 relative group transition-transform hover:scale-110">
                    <MessageSquare className="h-12 w-12 text-slate-100 group-hover:text-primary/10 transition-colors" />
                    <div className="absolute inset-0 bg-primary/5 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="space-y-2">
                    <h3 className="font-black text-slate-950 text-xl tracking-tighter uppercase italic">Silencio en la Red</h3>
                    <p className="text-xs font-bold text-slate-400 max-w-[200px] mx-auto leading-relaxed">Cuando contactes con un conductor o pasajero, tus mensajes aparecerán aquí.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            <header className="p-8 border-b border-slate-50">
                <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Mensajes</h2>
                <p className="text-[9px] font-black text-primary uppercase tracking-[0.3em] mt-1">Tu centro de comunicación</p>
            </header>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
                {conversations.map((convo, idx) => (
                    <Link
                        to={`/chat/${convo.id}`}
                        key={convo.id}
                        className={cn(
                            "block p-6 transition-all duration-300 border-b border-slate-50/50 relative group",
                            activeChatId === convo.id ? 'bg-primary/5 after:content-[\'\'] after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-primary' : 'hover:bg-slate-50'
                        )}
                        style={{ animationDelay: `${idx * 50}ms` }}
                    >
                        <div className="flex items-center gap-5">
                            <div className="relative">
                                <Avatar className="h-16 w-16 border-2 border-white shadow-lg transition-transform group-hover:scale-105">
                                    <AvatarImage src={convo.otherUserPhoto} />
                                    <AvatarFallback className="bg-navy text-white font-black">{getInitials(convo.otherUserName)}</AvatarFallback>
                                </Avatar>
                                {convo.unreadCount > 0 && (
                                    <div className="absolute -top-1 -right-1 h-6 w-6 bg-primary text-white text-[10px] font-black rounded-full border-4 border-white flex items-center justify-center shadow-lg">
                                        {convo.unreadCount}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-1">
                                    <p className="font-black text-slate-900 truncate tracking-tight text-lg">{convo.otherUserName}</p>
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                        <Clock className="h-3 w-3" />
                                        <p className="text-[9px] font-black uppercase tracking-widest">
                                            {formatDistanceToNow(new Date(convo.lastActivity), { addSuffix: true, locale: es })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className={cn(
                                        "text-sm truncate pr-8",
                                        convo.unreadCount > 0 ? "font-black text-slate-900" : "font-medium text-slate-400"
                                    )}>
                                        {convo.lastMessagePreview}
                                    </p>
                                    {convo.unreadCount > 0 && <span className="h-2.5 w-2.5 bg-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]" />}
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

export default ConversationsList;
