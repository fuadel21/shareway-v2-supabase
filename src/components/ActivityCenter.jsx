import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Bell, CheckCheck, Info, AlertTriangle, CheckCircle2,
    XCircle, Loader2, Trash2, Handshake, MessageSquare,
    Wallet, Car, Check, Archive
} from 'lucide-react';
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from '@/services/notificationService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import SubPageHeader from './SubPageHeader';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        title: 'Centro de Actividad',
        activity: 'Actividad',
        pending: 'Pendientes',
        cancel: 'Cancelar',
        all: 'Todo',
        unread: 'Sin leer',
        selected: 'Seleccionados',
        read: 'Leídos',
        delete: 'Borrar',
        syncing: 'Sincronizando...',
        emptyTitle: 'Bandeja Vacía',
        emptyDescAll: 'No tienes notificaciones en este momento',
        emptyDescUnread: 'No tienes notificaciones sin leer en este momento',
        loadError: 'Error al cargar notificaciones',
        allReadSuccess: 'Todas marcadas como leídas',
        updateError: 'Error al actualizar',
        bulkReadSuccess: '{{count}} marcadas como leídas',
        bulkReadError: 'Error al marcar como leídas',
        bulkDeleteSuccess: '{{count}} eliminadas',
        bulkDeleteError: 'Error al eliminar',
        relative: {
            justNow: 'ahora',
            minute: 'min',
            hour: 'h',
            day: 'd'
        }
    },
    en: {
        title: 'Activity Center',
        activity: 'Activity',
        pending: 'Pending',
        cancel: 'Cancel',
        all: 'All',
        unread: 'Unread',
        selected: 'Selected',
        read: 'Read',
        delete: 'Delete',
        syncing: 'Syncing...',
        emptyTitle: 'Empty Inbox',
        emptyDescAll: 'You have no notifications right now',
        emptyDescUnread: 'You have no unread notifications right now',
        loadError: 'Error loading notifications',
        allReadSuccess: 'All marked as read',
        updateError: 'Update error',
        bulkReadSuccess: '{{count}} marked as read',
        bulkReadError: 'Error marking as read',
        bulkDeleteSuccess: '{{count}} deleted',
        bulkDeleteError: 'Error deleting',
        relative: {
            justNow: 'now',
            minute: 'min',
            hour: 'h',
            day: 'd'
        }
    },
    ar: {
        title: 'مركز النشاط',
        activity: 'النشاط',
        pending: 'قيد الانتظار',
        cancel: 'إلغاء',
        all: 'الكل',
        unread: 'غير مقروءة',
        selected: 'محددة',
        read: 'مقروءة',
        delete: 'حذف',
        syncing: 'جارٍ المزامنة...',
        emptyTitle: 'الصندوق فارغ',
        emptyDescAll: 'لا توجد لديك إشعارات في الوقت الحالي',
        emptyDescUnread: 'لا توجد لديك إشعارات غير مقروءة في الوقت الحالي',
        loadError: 'حدث خطأ أثناء تحميل الإشعارات',
        allReadSuccess: 'تم تحديد الكل كمقروء',
        updateError: 'حدث خطأ أثناء التحديث',
        bulkReadSuccess: 'تم تحديد {{count}} كمقروءة',
        bulkReadError: 'حدث خطأ أثناء تحديدها كمقروءة',
        bulkDeleteSuccess: 'تم حذف {{count}}',
        bulkDeleteError: 'حدث خطأ أثناء الحذف',
        relative: {
            justNow: 'الآن',
            minute: 'د',
            hour: 'س',
            day: 'ي'
        }
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const interpolate = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);

const formatRelativeTime = (dateValue, copy) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return copy.relative.justNow;
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.max(0, Math.floor(diffMs / 60000));
    if (minutes < 1) return copy.relative.justNow;
    if (minutes < 60) return `${minutes}${copy.relative.minute}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${copy.relative.hour}`;
    const days = Math.floor(hours / 24);
    return `${days}${copy.relative.day}`;
};

const NotificationItem = ({ notification, isSelected, onSelect, onRead, onClick, selectionMode, copy }) => {
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
                'p-4 rounded-3xl border-2 transition-all duration-500 relative group cursor-pointer flex items-center gap-4',
                isRead
                    ? 'bg-white/40 border-slate-100/50 opacity-75'
                    : 'bg-white border-white shadow-[0_10px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)]',
                isSelected && 'border-primary/30 bg-primary/5'
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
                'h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg bg-gradient-to-br text-white transition-transform group-hover:rotate-6',
                gradient
            )}>
                <Icon className="h-6 w-6 stroke-[2.5px]" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-0.5">
                    <h4 className={cn(
                        'text-[11px] font-black uppercase italic tracking-tighter leading-none',
                        isRead ? 'text-slate-500' : 'text-slate-900'
                    )}>
                        {notification.title}
                    </h4>
                    <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest shrink-0 ml-2">
                        {formatRelativeTime(notification.created_at, copy)}
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
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [filter, setFilter] = useState('all');

    const fetchNotifications = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const data = await getNotifications(user.id);
            setNotifications(data || []);
        } catch (error) {
            console.error('Error fetching notifications:', error);
            toast.error(copy.loadError);
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
            toast.success(copy.allReadSuccess);
        } catch (error) { toast.error(copy.updateError); }
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
            const count = selectedIds.length;
            setSelectedIds([]);
            setSelectionMode(false);
            toast.success(interpolate(copy.bulkReadSuccess, { count }));
        } catch (error) {
            toast.error(copy.bulkReadError);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map(id => deleteNotification(id)));
            const count = selectedIds.length;
            setNotifications(prev => prev.filter(n => !selectedIds.includes(n.id)));
            setSelectedIds([]);
            setSelectionMode(false);
            toast.success(interpolate(copy.bulkDeleteSuccess, { count }));
        } catch (error) {
            toast.error(copy.bulkDeleteError);
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
            <SubPageHeader title={copy.title} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-xl shadow-slate-200/50 border border-slate-100 flex items-center justify-between">
                    <div className="flex gap-4 items-center">
                        <div className="h-14 w-14 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg rotate-3">
                            <Bell className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{copy.activity}</p>
                            <h2 className="text-xl font-black text-slate-900 tracking-tighter italic uppercase leading-tight">
                                {unreadCount} {copy.pending}
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
                                {copy.cancel}
                            </Button>
                        )}
                    </div>
                </div>

                <div className="flex gap-2 px-2 overflow-x-auto pb-2 custom-scrollbar">
                    {[
                        { id: 'all', label: copy.all, icon: Bell },
                        { id: 'unread', label: copy.unread, icon: Info },
                    ].map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={cn(
                                'flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border-2',
                                filter === f.id
                                    ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200 scale-105'
                                    : 'bg-white border-white text-slate-400 hover:border-slate-100'
                            )}
                        >
                            <f.icon className="size-3.5" />
                            {f.label}
                        </button>
                    ))}
                </div>

                {selectionMode && selectedIds.length > 0 && (
                    <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm bg-slate-900 rounded-3xl p-4 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom-10">
                        <p className="text-white text-[10px] font-black uppercase tracking-widest ml-4">
                            {selectedIds.length} {copy.selected}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                className="rounded-xl bg-white/10 hover:bg-white/20 text-white border-none"
                                onClick={handleBulkMarkRead}
                            >
                                <Check className="size-4 mr-2" />
                                <span className="text-[9px] font-black uppercase tracking-widest">{copy.read}</span>
                            </Button>
                            <Button
                                size="sm"
                                className="rounded-xl bg-red-500 hover:bg-red-600 text-white border-none"
                                onClick={handleBulkDelete}
                            >
                                <Trash2 className="size-4 mr-2" />
                                <span className="text-[9px] font-black uppercase tracking-widest">{copy.delete}</span>
                            </Button>
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="size-10 text-primary animate-spin" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">{copy.syncing}</p>
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
                                    copy={copy}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="bg-white rounded-3xl p-12 text-center space-y-6 border border-slate-100">
                            <div className="size-24 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                                <Bell className="size-10 text-slate-200" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-black text-slate-900 uppercase italic tracking-tighter">{copy.emptyTitle}</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                                    {filter === 'unread' ? copy.emptyDescUnread : copy.emptyDescAll}
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
