
import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck, Info, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2, Handshake, MessageSquare, Wallet, Car } from 'lucide-react';
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
        booking: Car,
        payment: Wallet,
        match: Handshake,
        chat: MessageSquare
    };

    const gradientColors = {
        info: 'from-blue-500 to-cyan-400 shadow-blue-200',
        success: 'from-emerald-500 to-teal-400 shadow-emerald-200',
        warning: 'from-amber-500 to-orange-400 shadow-amber-200',
        error: 'from-red-500 to-rose-400 shadow-red-200',
        booking: 'from-indigo-600 to-blue-500 shadow-indigo-200',
        payment: 'from-purple-600 to-fuchsia-500 shadow-purple-200',
        match: 'from-primary to-orange-400 shadow-primary/30',
        chat: 'from-orange-500 to-amber-400 shadow-orange-200'
    };

    const Icon = icons[notification.type] || Info;
    const gradient = gradientColors[notification.type] || gradientColors.info;

    return (
        <div 
            className={cn(
                "p-4 rounded-[2rem] border-2 transition-all duration-500 relative group cursor-pointer active:scale-95",
                notification.is_read
                    ? "bg-white/40 border-slate-100/50 opacity-70 grayscale-[0.5]"
                    : "bg-white border-white shadow-[0_10px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1"
            )}
            onClick={() => {
                onRead(notification.id);
                if (onClick) onClick(notification);
            }}
        >
            <div className="flex gap-4 items-center">
                <div className={cn(
                    "h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg bg-gradient-to-br text-white transition-transform group-hover:rotate-6",
                    gradient
                )}>
                    <Icon className="h-7 w-7 stroke-[2.5px]" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                        <h4 className={cn(
                            "text-[11px] font-black uppercase italic tracking-tighter leading-none",
                            notification.is_read ? "text-slate-500" : "text-slate-900"
                        )}>
                            {notification.title}
                        </h4>
                        <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest shrink-0 ml-2">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: false, locale: es })}
                        </span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 leading-tight line-clamp-2">
                        {notification.content || notification.message || notification.body}
                    </p>
                </div>
            </div>
            {!notification.is_read && (
                <div className="absolute top-4 right-4 flex gap-1">
                    <span className="h-2 w-2 bg-primary rounded-full animate-ping" />
                    <span className="h-2 w-2 bg-primary rounded-full" />
                </div>
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
        <Sheet open={isOpen} onOpenChange={setIsOpen} modal={false}>
            {/* DISPARADOR MANUAL PARA SOPORTAR TOGGLE (ABRIR/CERRAR) */}
            <div
                className="relative cursor-pointer active:scale-95 transition-transform z-[1001]"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                {children}
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-600 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-xl animate-in zoom-in">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </div>

            <SheetContent className="w-full sm:max-w-md p-0 bg-slate-50/80 backdrop-blur-3xl border-none shadow-[-20px_0_50px_rgba(0,0,0,0.1)] flex flex-col">
                <SheetHeader className="p-8 pb-6 bg-white/40 backdrop-blur-md border-b border-white/20 sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <SheetTitle className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3 text-slate-900">
                                <div className="size-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg rotate-3 group-hover:rotate-0 transition-transform">
                                    <Bell className="h-5 w-5 text-primary" />
                                </div>
                                Actividad
                            </SheetTitle>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Centro de Control Elite</p>
                        </div>

                        {unreadCount > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleMarkAllRead}
                                className="h-10 rounded-2xl bg-white/50 hover:bg-white text-[9px] font-black uppercase tracking-widest text-primary shadow-sm border border-slate-100 active:scale-95 transition-all"
                            >
                                <CheckCheck className="h-3.5 w-3.5 mr-2" />
                                Leer Todo
                            </Button>
                        )}
                    </div>
                </SheetHeader>

                <ScrollArea className="flex-1 px-6 py-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-6">
                            <div className="relative">
                                <Loader2 className="h-12 w-12 text-primary animate-spin stroke-[3px]" />
                                <div className="absolute inset-0 h-12 w-12 text-primary/20 blur-sm animate-pulse">
                                    <Loader2 className="h-12 w-12 stroke-[3px]" />
                                </div>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 animate-pulse">Sincronizando...</p>
                        </div>
                    ) : notifications.length > 0 ? (
                        <div className="space-y-4 pb-12">
                            {notifications.map((n, index) => (
                                <div key={n.id} className="animate-in slide-in-from-right-10 fade-in duration-500" style={{ transitionDelay: `${index * 50}ms` }}>
                                    <NotificationItem
                                        notification={n}
                                        onRead={handleMarkAsRead}
                                        onClick={handleNotificationClick}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-40 text-center space-y-8 animate-in fade-in zoom-in duration-700">
                            <div className="relative">
                                <div className="h-32 w-32 bg-white rounded-[3rem] flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.05)] border-2 border-slate-50 relative z-10">
                                    <Bell className="h-12 w-12 text-slate-100" />
                                </div>
                                <div className="absolute -top-4 -right-4 h-12 w-12 bg-emerald-50 rounded-2xl flex items-center justify-center shadow-sm border border-emerald-100 rotate-12">
                                    <CheckCheck className="h-6 w-6 text-emerald-300" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-xl font-black uppercase italic tracking-tighter text-slate-900">Estás al día</h3>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 max-w-[200px] leading-relaxed">No hay nuevas alertas en tu radar ahora mismo</p>
                            </div>
                        </div>
                    )}
                </ScrollArea>

                <div className="p-6 bg-white/40 backdrop-blur-xl border-t border-white/20">
                    <Button
                        variant="outline"
                        className="w-full h-12 rounded-[1.5rem] border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        Cerrar Panel
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
};

export default NotificationCenter;
