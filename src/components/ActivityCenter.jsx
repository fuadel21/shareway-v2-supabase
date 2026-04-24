
import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Bell, CheckCheck, Info, AlertTriangle, CheckCircle2,
    XCircle, Loader2, Trash2, Handshake, MessageSquare,
    Wallet, Car, ChevronLeft, MoreVertical,
    Filter, Archive, Check
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { getNotifications, markAsRead, markAllAsRead, deleteNotification, subscribeToNotifications } from '@/services/notificationService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import SubPageHeader from './SubPageHeader';

const NotificationItem = ({ notification, isSelected, onSelect, onRead, onClick, selectionMode }) => {
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
        info: 'from-blue-500 to-cyan-400',
        success: 'from-emerald-500 to-teal-400',
        warning: 'from-amber-500 to-orange-400',
        error: 'from-red-500 to-rose-400',
        booking: 'from-indigo-600 to-blue-500',
        payment: 'from-purple-600 to-fuchsia-500',
        match: 'from-primary to-orange-400',
        chat: 'from-orange-500 to-amber-400'
    };

    const Icon = icons[notification.type] || Info;
    const gradient = gradientColors[notification.type] || gradientColors.info;
    const isRead = notification.read || notification.is_read;

    return (
        <div
            className={cn(
                "p-4 rounded-[2rem] border-2 transition-all duration-500 relative group cursor-pointer flex items-center gap-4",
                isRead
                    ? "bg-white/40 border-slate-100/50 opacity-75"
                    : "bg-white border-white shadow-[0_10px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)]",
                isSelected && "border-primary/30 bg-primary/5"
            )}
            onClick={() => {
                if (selectionMode) {
                    onSelect(notification.id);
                } else {
                    onRead(notification.id);
                    if (onClick) onClick(notification);
                }
            }}
        >
            {selectionMode && (
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelect(notification.id)}
                        className="rounded-full border-slate-300 data-[state=checked]:bg-primary"
                    />
                </div>
            )}

            <div className={cn(
                "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg bg-gradient-to-br text-white transition-transform group-hover:rotate-6",
                gradient
            )}>
                <Icon className="h-6 w-6 stroke-[2.5px]" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-0.5">
                    <h4 className={cn(
                        "text-[11px] font-black uppercase italic tracking-tighter leading-none",
                        isRead ? "text-slate-500" : "text-slate-900"
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

            {!isRead && !selectionMode && (
                <div className="flex gap-1">
                    <span className="h-2 w-2 bg-primary rounded-full animate-pulse" />
                </div>
            )}
        </div>
    );
};

const ActivityCenter = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [filter, setFilter] = useState('all'); // all, unread

    const fetchNotifications = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const data = await getNotifications(user.id);
            setNotifications(data || []);
        } catch (error) {
            console.error("Error fetching notifications:", error);
            toast.error("Error al cargar notificaciones");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchNotifications();
    }, [user]);

    const handleMarkAsRead = async (id) => {
        try {
            await markAsRead(id);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true, is_read: true } : n));
        } catch (error) { console.error(error); }
    };

    const handleNotificationClick = (n) => {
        if (n.type === 'match' && n.related_id) {
            navigate(`/request/${n.related_id}`);
        } else if ((n.type === 'booking' || n.type === 'chat') && n.related_id) {
            navigate(`/ride/${n.related_id}`);
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllAsRead(user.id);
            setNotifications(prev => prev.map(n => ({ ...n, read: true, is_read: true })));
            toast.success("Todas marcadas como leídas");
        } catch (error) { toast.error("Error al actualizar"); }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleBulkMarkRead = async () => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map(id => markAsRead(id)));
            setNotifications(prev => prev.map(n => selectedIds.includes(n.id) ? { ...n, read: true, is_read: true } : n));
            setSelectedIds([]);
            setSelectionMode(false);
            toast.success(`${selectedIds.length} marcadas como leídas`);
        } catch (error) {
            toast.error("Error al marcar como leídas");
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map(id => deleteNotification(id)));
            setNotifications(prev => prev.filter(n => !selectedIds.includes(n.id)));
            setSelectedIds([]);
            setSelectionMode(false);
            toast.success(`${selectedIds.length} eliminadas`);
        } catch (error) {
            toast.error("Error al eliminar");
        }
    };

    const filteredNotifications = notifications.filter(n => {
        const isRead = n.read || n.is_read;
        if (filter === 'unread') return !isRead;
        return true;
    });

    const unreadCount = notifications.filter(n => !(n.read || n.is_read)).length;

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="Centro de Actividad" backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-6">
                {/* Stats & Actions Card */}
                <div className="bg-white rounded-[2.5rem] p-6 shadow-xl shadow-slate-200/50 border border-slate-100 flex items-center justify-between">
                    <div className="flex gap-4 items-center">
                        <div className="h-14 w-14 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg rotate-3">
                            <Bell className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Actividad</p>
                            <h2 className="text-xl font-black text-slate-900 tracking-tighter italic uppercase leading-tight">
                                {unreadCount} Pendientes
                            </h2>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {!selectionMode ? (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-xl bg-slate-50"
                                    onClick={() => setSelectionMode(true)}
                                >
                                    <CheckCheck className="size-5 text-slate-600" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-xl bg-slate-50"
                                    onClick={handleMarkAllRead}
                                    disabled={unreadCount === 0}
                                >
                                    <Archive className="size-5 text-slate-600" />
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-xl bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-widest px-4"
                                onClick={() => {
                                    setSelectionMode(false);
                                    setSelectedIds([]);
                                }}
                            >
                                Cancelar
                            </Button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="flex gap-2 px-2 overflow-x-auto pb-2 custom-scrollbar">
                    {[
                        { id: 'all', label: 'Todo', icon: Bell },
                        { id: 'unread', label: 'Sin leer', icon: Info },
                    ].map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={cn(
                                "flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border-2",
                                filter === f.id
                                    ? "bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200 scale-105"
                                    : "bg-white border-white text-slate-400 hover:border-slate-100"
                            )}
                        >
                            <f.icon className="size-3.5" />
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Bulk Actions Floating Bar */}
                {selectionMode && selectedIds.length > 0 && (
                    <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm bg-slate-900 rounded-[2rem] p-4 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom-10">
                        <p className="text-white text-[10px] font-black uppercase tracking-widest ml-4">
                            {selectedIds.length} Seleccionados
                        </p>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                className="rounded-xl bg-white/10 hover:bg-white/20 text-white border-none"
                                onClick={handleBulkMarkRead}
                            >
                                <Check className="size-4 mr-2" />
                                <span className="text-[9px] font-black uppercase tracking-widest">Leídos</span>
                            </Button>
                            <Button
                                size="sm"
                                className="rounded-xl bg-red-500 hover:bg-red-600 text-white border-none"
                                onClick={handleBulkDelete}
                            >
                                <Trash2 className="size-4 mr-2" />
                                <span className="text-[9px] font-black uppercase tracking-widest">Borrar</span>
                            </Button>
                        </div>
                    </div>
                )}

                {/* Notifications List */}
                <div className="space-y-3">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="size-10 text-primary animate-spin" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Sincronizando...</p>
                        </div>
                    ) : filteredNotifications.length > 0 ? (
                        filteredNotifications.map((n, idx) => (
                            <div key={n.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                <NotificationItem
                                    notification={n}
                                    selectionMode={selectionMode}
                                    isSelected={selectedIds.includes(n.id)}
                                    onSelect={toggleSelect}
                                    onRead={handleMarkAsRead}
                                    onClick={handleNotificationClick}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="bg-white rounded-[3rem] p-12 text-center space-y-6 border border-slate-100">
                            <div className="size-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-inner">
                                <Bell className="size-10 text-slate-200" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-black text-slate-900 uppercase italic tracking-tighter">Bandeja Vacía</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                                    No tienes notificaciones {filter === 'unread' ? 'sin leer ' : ''}en este momento
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center pb-10">
                    <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">
                        Push Cloud Engine v2.0 • ShareWay
                    </p>
                </div>
            </main>
        </div>
    );
};

export default ActivityCenter;
