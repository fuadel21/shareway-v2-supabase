
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

const config = {
    info: {
        gradient: 'from-blue-600 to-cyan-500',
        bg: 'bg-blue-50/80',
        border: 'border-blue-100',
        text: 'text-blue-900',
        subtext: 'text-blue-700/70',
        iconBg: 'bg-white/90 text-blue-600'
    },
    success: {
        gradient: 'from-emerald-600 to-teal-500',
        bg: 'bg-emerald-50/80',
        border: 'border-emerald-100',
        text: 'text-emerald-900',
        subtext: 'text-emerald-700/70',
        iconBg: 'bg-white/90 text-emerald-600'
    },
    warning: {
        gradient: 'from-amber-600 to-orange-500',
        bg: 'bg-amber-50/80',
        border: 'border-amber-100',
        text: 'text-amber-900',
        subtext: 'text-amber-700/70',
        iconBg: 'bg-white/90 text-amber-600'
    },
    error: {
        gradient: 'from-red-600 to-rose-500',
        bg: 'bg-red-50/80',
        border: 'border-red-100',
        text: 'text-red-900',
        subtext: 'text-red-700/70',
        iconBg: 'bg-white/90 text-red-600'
    },
    booking: {
        gradient: 'from-indigo-600 to-violet-500',
        bg: 'bg-indigo-50/80',
        border: 'border-indigo-100',
        text: 'text-indigo-900',
        subtext: 'text-indigo-700/70',
        iconBg: 'bg-white/90 text-indigo-600'
    },
    payment: {
        gradient: 'from-purple-600 to-fuchsia-500',
        bg: 'bg-purple-50/80',
        border: 'border-purple-100',
        text: 'text-purple-900',
        subtext: 'text-purple-700/70',
        iconBg: 'bg-white/90 text-purple-600'
    },
    match: {
        gradient: 'from-primary to-orange-500',
        bg: 'bg-orange-50/80',
        border: 'border-orange-100',
        text: 'text-orange-900',
        subtext: 'text-orange-700/70',
        iconBg: 'bg-white/90 text-primary'
    },
    chat: {
        gradient: 'from-sky-600 to-blue-500',
        bg: 'bg-sky-50/80',
        border: 'border-sky-100',
        text: 'text-sky-900',
        subtext: 'text-sky-700/70',
        iconBg: 'bg-white/90 text-sky-600'
    }
};

const NotificationItem = ({ notification, onRead, onClick }) => {
    const type = notification.type || 'info';
    const style = config[type] || config.info;
    const Icon = icons[type] || Info;

    return (
        <div 
            className={cn(
                "p-5 rounded-2xl border-2 transition-all duration-500 relative group cursor-pointer active:scale-95 overflow-hidden",
                notification.is_read
                    ? "bg-white/40 border-slate-100/50 opacity-60 grayscale-[0.8]"
                    : cn(style.bg, style.border, "shadow-[0_15px_35px_rgba(0,0,0,0.05)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] hover:-translate-y-1.5")
            )}
            onClick={() => {
                onRead(notification.id);
                if (onClick) onClick(notification);
            }}
        >
            {/* GRADIENT DECORATIVO DE FONDO */}
            {!notification.is_read && (
                <div className={cn(
                    "absolute -right-8 -top-8 size-32 bg-gradient-to-br blur-3xl opacity-20 group-hover:opacity-40 transition-opacity",
                    style.gradient
                )} />
            )}

            <div className="flex gap-5 items-center relative z-10">
                <div className={cn(
                    "h-16 w-16 rounded-2xl flex items-center justify-center shrink-0 shadow-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
                    notification.is_read ? "bg-slate-100 text-slate-400" : cn("bg-gradient-to-br text-white", style.gradient)
                )}>
                    <Icon className="h-8 w-8 stroke-[2.5px]" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1.5">
                        <h4 className={cn(
                            "text-xs font-black uppercase italic tracking-tighter leading-none",
                            notification.is_read ? "text-slate-500" : style.text
                        )}>
                            {notification.title}
                        </h4>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0 ml-2 opacity-60">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: false, locale: es })}
                        </span>
                    </div>
                    <p className={cn(
                        "text-[11px] font-bold leading-snug line-clamp-2",
                        notification.is_read ? "text-slate-400" : style.subtext
                    )}>
                        {notification.content || notification.message || notification.body}
                    </p>
                </div>
            </div>

            {!notification.is_read && (
                <div className="absolute top-5 right-5 flex gap-1">
                    <span className={cn("h-2.5 w-2.5 rounded-full animate-ping opacity-75", style.iconBg.split(' ')[0])} />
                    <span className={cn("h-2.5 w-2.5 rounded-full shadow-sm", style.iconBg.split(' ')[0])} />
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
                
                const type = newNotification.type || 'info';
                const Icon = icons[type] || Bell;
                const style = config[type] || config.info;

                toast.custom((t) => (
                    <div 
                        className={cn(
                            "w-full max-w-sm p-5 rounded-3xl shadow-2xl border-2 flex gap-4 items-center animate-in slide-in-from-top-10 cursor-pointer backdrop-blur-2xl",
                            style.bg, style.border
                        )}
                        onClick={() => { toast.dismiss(t); setIsOpen(true); }}
                    >
                        <div className={cn(
                            "size-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg bg-gradient-to-br text-white",
                            style.gradient
                        )}>
                            <Icon className="h-7 w-7 animate-bounce" />
                        </div>
                        <div className="flex-1 text-left">
                            <p className={cn("text-[11px] font-black uppercase italic tracking-tighter", style.text)}>
                                {newNotification.title}
                            </p>
                            <p className={cn("text-[10px] font-bold line-clamp-2", style.subtext)}>
                                {newNotification.content}
                            </p>
                        </div>
                        <div className="h-8 w-1 bg-slate-200/20 rounded-full" />
                    </div>
                ), { duration: 5000 });
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
                                <div className="h-32 w-32 bg-white rounded-3xl flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.05)] border-2 border-slate-50 relative z-10">
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
                        className="w-full h-12 rounded-2xl border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-sm"
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
