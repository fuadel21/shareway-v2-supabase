
import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck, Info, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2, Handshake, MessageSquare, Wallet } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { getNotifications, markAsRead, markAllAsRead, subscribeToNotifications, getUnreadCount } from '@/services/notificationService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const NotificationItem = ({ notification, onRead, onClick }) => {
    const icons = {
        info: Info,
        success: CheckCircle2,
        warning: AlertTriangle,
        error: XCircle,
        booking: CheckCircle2,
        payment: Wallet,
        match: Handshake,
        chat: MessageSquare
    };

    const colors = {
        info: 'text-blue-500 bg-blue-50',
        success: 'text-emerald-500 bg-emerald-50',
        warning: 'text-amber-500 bg-amber-50',
        error: 'text-red-500 bg-red-50',
        booking: 'text-primary bg-primary/10',
        payment: 'text-purple-500 bg-purple-50',
        match: 'text-indigo-600 bg-indigo-50',
        chat: 'text-orange-500 bg-orange-50'
    };

    const Icon = icons[notification.type] || Info;
    const colorClass = colors[notification.type] || colors.info;

    return (
        <div 
            className={cn(
                "p-4 rounded-2xl border transition-all duration-300 relative group cursor-pointer hover:shadow-md",
                notification.is_read ? "bg-white border-slate-100 opacity-60" : "bg-white border-indigo-100 shadow-sm ring-1 ring-indigo-50"
            )}
            onClick={() => {
                onRead(notification.id);
                if (onClick) onClick(notification);
            }}
        >
            <div className="flex gap-4">
                <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm", colorClass)}>
                    <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-start">
                        <h4 className={cn("text-xs font-black uppercase italic tracking-tighter", notification.is_read ? "text-slate-600" : "text-slate-900")}>
                            {notification.title}
                        </h4>
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest shrink-0 ml-2">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: es })}
                        </span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 leading-tight">
                        {notification.content}
                    </p>
                </div>
            </div>
            {!notification.is_read && (
                <div className="absolute top-4 right-4 h-2 w-2 bg-primary rounded-full animate-pulse" />
            )}
        </div>
    );
};

const NotificationCenter = ({ children, user }) => {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const fetchNotifications = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const data = await getNotifications(user.id);
            setNotifications(data || []);
            const count = (data || []).filter(n => !n.is_read).length;
            setUnreadCount(count);
        } catch (error) {
            console.error("Error fetching notifications:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchNotifications();
            const subscription = subscribeToNotifications(user.id, (newNotification) => {
                setNotifications(prev => [newNotification, ...prev]);
                setUnreadCount(prev => prev + 1);
                
                toast.custom((t) => (
                    <div 
                        className="bg-white p-4 rounded-[2rem] shadow-2xl border-2 border-primary/20 flex gap-4 items-center max-w-sm animate-in slide-in-from-top-10"
                        onClick={() => { toast.dismiss(t); setIsOpen(true); }}
                    >
                        <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <Bell className="animate-bounce" />
                        </div>
                        <div className="text-left">
                            <p className="text-[10px] font-black uppercase tracking-tighter text-slate-900">{newNotification.title}</p>
                            <p className="text-[9px] font-bold text-slate-500 line-clamp-2">{newNotification.content}</p>
                        </div>
                    </div>
                ));
            });

            return () => { subscription.unsubscribe(); };
        }
    }, [user]);

    const handleMarkAsRead = async (id) => {
        try {
            await markAsRead(id);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) { console.error(error); }
    };

    const handleNotificationClick = (n) => {
        setIsOpen(false);
        if (n.type === 'match' && n.related_id) {
            navigate(`/request/${n.related_id}`);
        } else if ((n.type === 'booking' || n.type === 'chat') && n.related_id) {
            navigate(`/ride/${n.related_id}`);
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllAsRead(user.id);
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
            setUnreadCount(0);
            toast.success("Bandeja limpia");
        } catch (error) { toast.error("Error al actualizar"); }
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <div className="relative cursor-pointer active:scale-95 transition-transform">
                    {children}
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-600 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-xl animate-in zoom-in">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </div>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md p-0 bg-slate-50/50 backdrop-blur-3xl border-none">
                <SheetHeader className="p-8 pb-4 border-b border-slate-100 bg-white/80 backdrop-blur-xl sticky top-0 z-10 text-left">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                            <Bell className="h-6 w-6 text-primary" />
                            Elite Alerts
                        </SheetTitle>
                        {unreadCount > 0 && (
                            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="h-8 rounded-full bg-slate-50 text-[9px] font-black uppercase tracking-widest text-primary">
                                <CheckCheck className="h-3 w-3 mr-1" /> Limpiar
                            </Button>
                        )}
                    </div>
                </SheetHeader>

                <ScrollArea className="h-[calc(100vh-120px)] p-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="h-10 w-10 text-primary/20 animate-spin" />
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Escaneando actividad...</p>
                        </div>
                    ) : notifications.length > 0 ? (
                        <div className="space-y-3 pb-20">
                            {notifications.map(n => (
                                <NotificationItem 
                                    key={n.id} 
                                    notification={n} 
                                    onRead={handleMarkAsRead} 
                                    onClick={handleNotificationClick}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
                            <div className="h-24 w-24 bg-white rounded-[2rem] flex items-center justify-center shadow-elite border border-slate-100">
                                <Bell className="h-10 w-10 text-slate-100" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-black uppercase italic italic tracking-tighter">Bandeja Vacía</h3>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Todo en orden por aquí</p>
                            </div>
                        </div>
                    )}
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
};

export default NotificationCenter;
