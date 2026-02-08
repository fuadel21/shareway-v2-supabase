/**
 * Notification Center Enhanced - Centro de Notificaciones Completo
 * Interfaz completa para gestionar notificaciones con preferencias
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellRing, Check, CheckCheck, Settings, X, Trash2, Clock, AlertCircle, MessageSquare, CreditCard, Star, Trophy, Car } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { Separator } from '@/components/ui/separator.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { toast } from 'sonner';
import { 
    getUnreadNotifications, 
    markNotificationRead, 
    markAllNotificationsRead,
    getNotificationPreferences,
    updateNotificationPreferences,
    subscribeToNotifications,
    unsubscribeFromNotifications,
    requestPushPermission,
    showLocalNotification
} from '../services/notificationServiceEnhanced.js';

const getNotificationIcon = (type) => {
    const icons = {
        ride_request: { icon: Car, color: 'text-blue-500' },
        ride_accepted: { icon: Check, color: 'text-green-500' },
        ride_cancelled: { icon: X, color: 'text-red-500' },
        ride_completed: { icon: CheckCheck, color: 'text-emerald-500' },
        payment_required: { icon: CreditCard, color: 'text-orange-500' },
        payment_confirmed: { icon: Check, color: 'text-green-500' },
        payment_failed: { icon: AlertCircle, color: 'text-red-500' },
        review_reminder: { icon: Star, color: 'text-purple-500' },
        new_review: { icon: Star, color: 'text-yellow-500' },
        badge_earned: { icon: Trophy, color: 'text-amber-500' },
        message_received: { icon: MessageSquare, color: 'text-blue-500' },
        trip_reminder: { icon: Clock, color: 'text-orange-500' },
        driver_arriving: { icon: Car, color: 'text-green-500' },
        emergency_alert: { icon: AlertCircle, color: 'text-red-500' },
        system_update: { icon: Settings, color: 'text-gray-500' },
        promotion: { icon: Trophy, color: 'text-purple-500' }
    };
    
    return icons[type] || { icon: Bell, color: 'text-gray-500' };
};

const formatNotificationTime = (createdAt) => {
    const now = new Date();
    const notificationTime = new Date(createdAt);
    const diffInMinutes = Math.floor((now - notificationTime) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Ahora';
    if (diffInMinutes < 60) return `Hace ${diffInMinutes} min`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `Hace ${diffInHours} h`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `Hace ${diffInDays} d`;
    
    return notificationTime.toLocaleDateString('es-ES');
};

const NotificationItem = ({ notification, onRead, onAction }) => {
    const { icon: Icon, color } = getNotificationIcon(notification.type);
    const [isExpanded, setIsExpanded] = useState(false);
    
    const handleClick = async () => {
        if (notification.status !== 'read') {
            await onRead(notification.id);
        }
        
        if (notification.data?.action_url) {
            onAction(notification.data.action_url);
        }
    };
    
    return (
        <div 
            className={`
                p-4 border-b cursor-pointer transition-all hover:bg-slate-50
                ${notification.status === 'read' ? 'opacity-60' : 'bg-blue-50/30'}
            `}
            onClick={handleClick}
        >
            <div className="flex items-start gap-3">
                <div className={`p-2 rounded-full bg-slate-100 ${color}`}>
                    <Icon className="h-4 w-4" />
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-slate-900 truncate">
                                {notification.title}
                            </h4>
                            <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                                {notification.body}
                            </p>
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                            <span className="text-xs text-slate-500 whitespace-nowrap">
                                {formatNotificationTime(notification.created_at)}
                            </span>
                            
                            {notification.priority === 'urgent' && (
                                <Badge variant="destructive" className="text-xs">
                                    Urgente
                                </Badge>
                            )}
                        </div>
                    </div>
                    
                    {/* Datos adicionales */}
                    {notification.data && Object.keys(notification.data).length > 0 && (
                        <div className="mt-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs p-0 h-auto"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded(!isExpanded);
                                }}
                            >
                                {isExpanded ? 'Ocultar detalles' : 'Ver detalles'}
                            </Button>
                            
                            {isExpanded && (
                                <div className="mt-2 p-2 bg-slate-100 rounded text-xs">
                                    <pre className="whitespace-pre-wrap text-slate-600">
                                        {JSON.stringify(notification.data, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* Acciones rápidas */}
                    {notification.data?.action_url && (
                        <div className="mt-2">
                            <Button
                                size="sm"
                                className="text-xs"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAction(notification.data.action_url);
                                }}
                            >
                                Ver detalles
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const NotificationPreferences = ({ preferences, onPreferencesChange }) => {
    const [localPrefs, setLocalPrefs] = useState(preferences || {});
    
    const handleToggle = (key, value) => {
        const updatedPrefs = { ...localPrefs, [key]: value };
        setLocalPrefs(updatedPrefs);
        onPreferencesChange(updatedPrefs);
    };
    
    return (
        <div className="space-y-6">
            <div>
                <h4 className="text-sm font-medium text-slate-900 mb-4">Tipos de Notificación</h4>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Solicitudes de viaje</label>
                            <p className="text-xs text-slate-500">Nuevas solicitudes de plaza</p>
                        </div>
                        <Switch
                            checked={localPrefs.ride_requests}
                            onCheckedChange={(checked) => handleToggle('ride_requests', checked)}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Pagos</label>
                            <p className="text-xs text-slate-500">Recordatorios y confirmaciones</p>
                        </div>
                        <Switch
                            checked={localPrefs.payment_notifications}
                            onCheckedChange={(checked) => handleToggle('payment_notifications', checked)}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Valoraciones</label>
                            <p className="text-xs text-slate-500">Recordatorios para valorar</p>
                        </div>
                        <Switch
                            checked={localPrefs.review_notifications}
                            onCheckedChange={(checked) => handleToggle('review_notifications', checked)}
                        />
                    </div>
                </div>
            </div>
            
            <Separator />
            
            <div>
                <h4 className="text-sm font-medium text-slate-900 mb-4">Métodos de Entrega</h4>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Notificaciones Push</label>
                            <p className="text-xs text-slate-500">En tu dispositivo</p>
                        </div>
                        <Switch
                            checked={localPrefs.push_enabled}
                            onCheckedChange={(checked) => handleToggle('push_enabled', checked)}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Email</label>
                            <p className="text-xs text-slate-500">Notificaciones por correo</p>
                        </div>
                        <Switch
                            checked={localPrefs.email_enabled}
                            onCheckedChange={(checked) => handleToggle('email_enabled', checked)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

const NotificationCenterEnhanced = ({ userId, onNavigate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [preferences, setPreferences] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('notifications');
    const [subscription, setSubscription] = useState(null);
    
    // Cargar notificaciones iniciales
    const loadNotifications = useCallback(async () => {
        if (!userId) return;
        
        setLoading(true);
        try {
            const result = await getUnreadNotifications(userId);
            setNotifications(result.notifications || []);
            setUnreadCount(result.unread_count || 0);
        } catch (error) {
            console.error('Error loading notifications:', error);
            toast.error('Error al cargar notificaciones');
        } finally {
            setLoading(false);
        }
    }, [userId]);
    
    // Cargar preferencias
    const loadPreferences = useCallback(async () => {
        if (!userId) return;
        
        try {
            const prefs = await getNotificationPreferences(userId);
            setPreferences(prefs);
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }, [userId]);
    
    // Marcar notificación como leída
    const handleMarkAsRead = async (notificationId) => {
        try {
            await markNotificationRead(notificationId);
            
            setNotifications(prev => 
                prev.map(n => 
                    n.id === notificationId 
                        ? { ...n, status: 'read', read_at: new Date().toISOString() }
                        : n
                )
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    };
    
    // Marcar todas como leídas
    const handleMarkAllAsRead = async () => {
        try {
            const result = await markAllNotificationsRead(userId);
            
            setNotifications(prev => 
                prev.map(n => ({ ...n, status: 'read', read_at: new Date().toISOString() }))
            );
            setUnreadCount(0);
            
            toast.success(`${result.marked_count} notificaciones marcadas como leídas`);
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            toast.error('Error al marcar notificaciones');
        }
    };
    
    // Actualizar preferencias
    const handlePreferencesChange = async (newPreferences) => {
        try {
            const updated = await updateNotificationPreferences(userId, newPreferences);
            setPreferences(updated);
            toast.success('Preferencias actualizadas');
        } catch (error) {
            console.error('Error updating preferences:', error);
            toast.error('Error al actualizar preferencias');
        }
    };
    
    // Manejar acción de notificación
    const handleNotificationAction = (url) => {
        if (onNavigate) {
            onNavigate(url);
        }
        setIsOpen(false);
    };
    
    // Suscripción a notificaciones en tiempo real
    useEffect(() => {
        if (!userId) return;
        
        const channel = subscribeToNotifications(userId, (newNotification) => {
            setNotifications(prev => [newNotification, ...prev]);
            setUnreadCount(prev => prev + 1);
            
            // Mostrar notificación local si el navegador lo permite
            if (Notification.permission === 'granted') {
                showLocalNotification({
                    title: newNotification.title,
                    body: newNotification.body,
                    tag: newNotification.id,
                    onClick: () => handleNotificationAction(newNotification.data?.action_url)
                });
            }
        });
        
        setSubscription(channel);
        
        return () => {
            if (channel) {
                unsubscribeFromNotifications(channel);
            }
        };
    }, [userId]);
    
    // Cargar datos iniciales
    useEffect(() => {
        if (userId) {
            loadNotifications();
            loadPreferences();
        }
    }, [userId, loadNotifications, loadPreferences]);
    
    // Solicitar permisos de notificación
    useEffect(() => {
        requestPushPermission();
    }, []);
    
    const NotificationButton = () => (
        <Button
            variant="ghost"
            size="sm"
            className="relative p-2"
            onClick={() => setIsOpen(!isOpen)}
        >
            {unreadCount > 0 ? (
                <BellRing className="h-5 w-5" />
            ) : (
                <Bell className="h-5 w-5" />
            )}
            
            {unreadCount > 0 && (
                <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
                >
                    {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
            )}
        </Button>
    );
    
    if (!userId) {
        return <NotificationButton />;
    }
    
    return (
        <div className="relative">
            <NotificationButton />
            
            {isOpen && (
                <div className="absolute right-0 top-12 w-96 bg-white rounded-lg shadow-lg border border-slate-200 z-50">
                    {/* Header */}
                    <div className="p-4 border-b">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Notificaciones</h3>
                            <div className="flex items-center gap-2">
                                {unreadCount > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleMarkAllAsRead}
                                        className="text-xs"
                                    >
                                        Marcar todas como leídas
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        
                        {/* Tabs */}
                        <div className="flex gap-2 mt-3">
                            <Button
                                variant={activeTab === 'notifications' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setActiveTab('notifications')}
                                className="text-xs"
                            >
                                Notificaciones ({unreadCount})
                            </Button>
                            <Button
                                variant={activeTab === 'preferences' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setActiveTab('preferences')}
                                className="text-xs"
                            >
                                Preferencias
                            </Button>
                        </div>
                    </div>
                    
                    {/* Content */}
                    <div className="max-h-96 overflow-hidden">
                        {activeTab === 'notifications' ? (
                            loading ? (
                                <div className="p-8 text-center text-slate-500">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-2"></div>
                                    Cargando...
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">
                                    <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
                                    <p>No tienes notificaciones</p>
                                </div>
                            ) : (
                                <ScrollArea className="h-96">
                                    {notifications.map((notification) => (
                                        <NotificationItem
                                            key={notification.id}
                                            notification={notification}
                                            onRead={handleMarkAsRead}
                                            onAction={handleNotificationAction}
                                        />
                                    ))}
                                </ScrollArea>
                            )
                        ) : (
                            <ScrollArea className="h-96 p-4">
                                {preferences ? (
                                    <NotificationPreferences
                                        preferences={preferences}
                                        onPreferencesChange={handlePreferencesChange}
                                    />
                                ) : (
                                    <div className="text-center text-slate-500">
                                        Cargando preferencias...
                                    </div>
                                )}
                            </ScrollArea>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationCenterEnhanced;
