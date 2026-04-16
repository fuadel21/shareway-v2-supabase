import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck, Info, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { getNotifications, markAsRead, markAllAsRead, subscribeToNotifications, getUnreadCount } from '@/services/notificationService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const NotificationItem = ({ notification, onRead }) => {
    const icons = {
        info: Info,
        success: CheckCircle2,
        warning: AlertTriangle,
        error: XCircle,
        booking: CheckCircle2,
        payment: CheckCircle2
    };

    const colors = {
        info: 'text-blue-500 bg-blue-50',
        success: 'text-emerald-500 bg-emerald-50',
        warning: 'text-amber-500 bg-amber-50',
        error: 'text-red-500 bg-red-50',
        booking: 'text-primary bg-primary/10',
        payment: 'text-purple-500 bg-purple-50'
    };

    const Icon = icons[notification.type] || Info;
    const colorClass = colors[notification.type] || colors.info;

    return (
        <div 
            className={cn(
                "p-4 rounded-xl border transition-all duration-300 relative group cursor-pointer hover:scale-[1.01]",
                notification.read ? "bg-white border-slate-100 opacity-60" : "bg-white border-primary/20 shadow-sm"
            )}
            onClick={() => onRead(notification.id)}
        >
            <div className="flex gap-4">
                <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", colorClass)}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-start">
                        <h4 className={cn("text-sm font-bold leading-none", notification.read ? "text-slate-600" : "text-slate-900")}>
                            {notification.title}
                        </h4>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 ml-2">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: es })}
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                        {notification.content}
                    </p>
                </div>
            </div>
            {!notification.read && (
                <div className="absolute top-4 right-4 h-2 w-2 bg-primary rounded-full animate-pulse" />
            )}
        </div>
    );
};

const NotificationCenter = ({ children, user }) => {
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
            const count = await getUnreadCount(user.id);
            setUnreadCount(count || 0);
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
                const isBooking = newNotification.type === 'booking' || newNotification.title?.toLowerCase().includes('reserva');
                const toastFn = isBooking ? toast.success : toast.info;

                toastFn(newNotification.title, {
                    description: newNotification.content,
                    duration: 2000, // Desaparece en 2 segundos
                    action: {
                        label: 'Ver',
                        onClick: () => setIsOpen(true)
                    }
                });
            });

            return () => {
                subscription.unsubscribe();
            };
        }
    }, [user]);

    const handleMarkAsRead = async (id) => {
        try {
            await markAsRead(id);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            toast.error("Error al marcar como leída.");
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllAsRead(user.id);
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
            toast.success("Todas las notificaciones marcadas como leídas.");
        } catch (error) {
            toast.error("Error al actualizar notificaciones.");
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <div className="relative cursor-pointer">
                    {children}
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-sm animate-in zoom-in">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </div>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md p-0 bg-slate-50/50 backdrop-blur-3xl">
                <SheetHeader className="p-6 pb-2 border-b border-slate-100 bg-white/80 backdrop-blur-xl sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-2">
                            <Bell className="h-5 w-5 text-primary" />
                            Notificaciones
                        </SheetTitle>
                        {unreadCount > 0 && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={handleMarkAllRead}
                                className="text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 h-8"
                            >
                                <CheckCheck className="h-3 w-3 mr-1" />
                                Marcar todo
                            </Button>
                        )}
                    </div>
                    <SheetDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Mantente al día con tu actividad reciente.
                    </SheetDescription>
                </SheetHeader>

                <ScrollArea className="h-[calc(100vh-100px)] p-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-4">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando...</p>
                        </div>
                    ) : notifications.length > 0 ? (
                        <div className="space-y-3 pb-20">
                            {notifications.map(notification => (
                                <NotificationItem 
                                    key={notification.id} 
                                    notification={notification} 
                                    onRead={handleMarkAsRead} 
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                            <div className="h-20 w-20 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                                <Bell className="h-8 w-8 text-slate-200" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Estás al día</h3>
                                <p className="text-sm text-slate-400 max-w-[200px] mx-auto mt-1">
                                    No tienes notificaciones nuevas en este momento.
                                </p>
                            </div>
                        </div>
                    )}
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
};

export default NotificationCenter;
