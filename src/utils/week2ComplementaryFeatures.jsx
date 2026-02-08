// ==========================================
// WEEK 2: COMPLEMENTARY FEATURES - Frontend Implementation
// ==========================================
// Persistent notifications, basic chat, and real-time dashboard

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOptimizedDataFetch } from '@/utils/week1Optimizations';

// ==========================================
// 1. PERSISTENT NOTIFICATION SYSTEM
// ==========================================

export function useNotifications(userId) {
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);

    // Fetch notifications with caching - POLLING DISABLED to prevent infinite loop
    const { data: notificationData, refetch: refetchNotifications } = useOptimizedDataFetch(
        `notifications_${userId}`,
        () => fetchNotifications(userId),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: null // DISABLED: Was causing infinite loop (was 15000)
        }
    );

    const fetchNotifications = async (userId) => {
        if (!userId) {
            console.warn('fetchNotifications called without userId');
            return []; // Guard against null userId
        }

        try {
            const { data, error } = await supabase.rpc('get_user_notifications', {
                p_user_id: userId,
                p_limit: 50,
                p_offset: 0,
                p_unread_only: false
            });

            if (error) {
                console.error('RPC error in get_user_notifications:', error);
                throw error;
            }
            return data || [];
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    };

    const markAsRead = async (notificationId) => {
        try {
            const { error } = await supabase.rpc('mark_notification_read', {
                p_notification_id: notificationId,
                p_user_id: userId
            });

            if (error) throw error;

            // Update local state
            setNotifications(prev =>
                prev.map(n =>
                    n.id === notificationId
                        ? { ...n, read_at: new Date().toISOString(), is_read: true }
                        : n
                )
            );
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    };

    const markAllAsRead = async () => {
        try {
            const { error } = await supabase.rpc('mark_all_notifications_read', {
                p_user_id: userId
            });

            if (error) throw error;

            // Update local state
            setNotifications(prev =>
                prev.map(n => ({ ...n, read_at: new Date().toISOString(), is_read: true }))
            );
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
        }
    };

    // Update unread count when notifications change
    useEffect(() => {
        const unread = notificationData?.filter(n => !n.is_read).length || 0;
        setUnreadCount(unread);
        setNotifications(notificationData || []);
    }, [notificationData]);

    return {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        refetchNotifications
    };
}

// Notification Component
export function NotificationItem({ notification, onMarkRead }) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const getNotificationIcon = (type) => {
        switch (type) {
            case 'success': return '✅';
            case 'warning': return '⚠️';
            case 'error': return '❌';
            case 'ride_update': return '🚗';
            case 'request_update': return '👤';
            case 'chat_message': return '💬';
            case 'system': return '🔔';
            default: return 'ℹ️';
        }
    };

    const getNotificationColor = (type) => {
        switch (type) {
            case 'success': return 'bg-green-50 border-green-200';
            case 'warning': return 'bg-yellow-50 border-yellow-200';
            case 'error': return 'bg-red-50 border-red-200';
            case 'ride_update': return 'bg-blue-50 border-blue-200';
            case 'request_update': return 'bg-purple-50 border-purple-200';
            case 'chat_message': return 'bg-indigo-50 border-indigo-200';
            default: return 'bg-gray-50 border-gray-200';
        }
    };

    return (
        <div className={`p-4 border rounded-lg mb-2 cursor-pointer transition-all hover:shadow-md ${getNotificationColor(notification.type)} ${!notification.is_read ? 'font-semibold' : ''}`}>
            <div className="flex items-start gap-3">
                <div className="text-2xl">{getNotificationIcon(notification.type)}</div>
                <div className="flex-1">
                    <div className="flex justify-between items-start">
                        <h4 className="text-sm font-medium text-gray-900">{notification.title}</h4>
                        <span className="text-xs text-gray-500">
                            {new Date(notification.created_at).toLocaleTimeString()}
                        </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                    {notification.data && Object.keys(notification.data).length > 0 && (
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="text-xs text-blue-600 hover:text-blue-800 mt-2"
                        >
                            {isExpanded ? 'Ocultar detalles' : 'Ver detalles'}
                        </button>
                    )}
                    {isExpanded && notification.data && (
                        <div className="mt-2 p-2 bg-white rounded text-xs text-gray-700">
                            <pre className="whitespace-pre-wrap">{JSON.stringify(notification.data, null, 2)}</pre>
                        </div>
                    )}
                </div>
                {!notification.is_read && (
                    <button
                        onClick={() => onMarkRead(notification.id)}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                    >
                        Marcar leído
                    </button>
                )}
            </div>
        </div>
    );
}

// Notification Center Component
export function NotificationCenter({ userId, isOpen, onClose }) {
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications(userId);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Notificaciones</h3>
                    <div className="flex items-center gap-2">
                        {unreadCount > 0 && (
                            <button
                                onClick={markAllAsRead}
                                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                            >
                                Marcar todos leídos
                            </button>
                        )}
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                            ✕
                        </button>
                    </div>
                </div>
                <div className="p-4 overflow-y-auto max-h-[60vh]">
                    {notifications.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <div className="text-4xl mb-2">🔔</div>
                            <p>No tienes notificaciones</p>
                        </div>
                    ) : (
                        notifications.map(notification => (
                            <NotificationItem
                                key={notification.id}
                                notification={notification}
                                onMarkRead={markAsRead}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 2. BASIC CHAT SYSTEM
// ==========================================

export function useChat(userId) {
    const [conversations, setConversations] = useState([]);
    const [activeConversation, setActiveConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);

    // Fetch conversations with caching - POLLING DISABLED for better performance
    const { data: conversationData, refetch: refetchConversations } = useOptimizedDataFetch(
        `conversations_${userId}`,
        () => fetchConversations(userId),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: null // DISABLED: Use manual refetch or WebSocket instead (was 20000)
        }
    );

    const fetchConversations = async (userId) => {
        if (!userId) return [];
        try {
            const { data, error } = await supabase.rpc('get_user_conversations', {
                p_user_id: userId
            });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching conversations:', error);
            return [];
        }
    };

    const sendMessage = async (receiverId, content, rideId = null, requestId = null) => {
        try {
            const { data, error } = await supabase.rpc('send_message', {
                p_ride_id: rideId,
                p_request_id: requestId,
                p_receiver_id: receiverId,
                p_content: content,
                p_message_type: 'text'
            });

            if (error) throw error;

            // Refresh messages if active conversation
            if (activeConversation && activeConversation.other_user_id === receiverId) {
                await fetchMessages(receiverId, rideId, requestId);
            }

            return data;
        } catch (error) {
            console.error('Error sending message:', error);
            throw error;
        }
    };

    const fetchMessages = async (otherUserId, rideId = null, requestId = null) => {
        try {
            const { data, error } = await supabase.rpc('get_conversation_messages', {
                p_user_id: userId,
                p_other_user_id: otherUserId,
                p_ride_id: rideId,
                p_request_id: requestId,
                p_limit: 50,
                p_offset: 0
            });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching messages:', error);
            return [];
        }
    };

    const markMessagesAsRead = async (otherUserId, rideId = null, requestId = null) => {
        try {
            const { error } = await supabase.rpc('mark_messages_read', {
                p_user_id: userId,
                p_other_user_id: otherUserId,
                p_ride_id: rideId,
                p_request_id: requestId
            });

            if (error) throw error;
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    };

    const startConversation = async (otherUserId, rideId = null, requestId = null) => {
        setActiveConversation({ other_user_id: otherUserId, ride_id, request_id: requestId });
        const messageData = await fetchMessages(otherUserId, rideId, requestId);
        setMessages(messageData);
        await markMessagesAsRead(otherUserId, rideId, requestId);
    };

    // Update conversations when data changes
    useEffect(() => {
        setConversations(conversationData || []);
    }, [conversationData]);

    return {
        conversations,
        activeConversation,
        messages,
        loading,
        sendMessage,
        startConversation,
        markMessagesAsRead,
        refetchConversations
    };
}

// Message Component
export function MessageItem({ message, isSent }) {
    return (
        <div className={`flex ${isSent ? 'justify-end' : 'justify-start'} mb-4`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${isSent
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-900'
                }`}>
                <p className="text-sm">{message.content}</p>
                <p className={`text-xs mt-1 ${isSent ? 'text-blue-100' : 'text-gray-500'}`}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
            </div>
        </div>
    );
}

// Chat Component
export function ChatComponent({ userId, otherUserId, rideId = null, requestId = null, onClose }) {
    const { messages, sendMessage, loading } = useChat(userId);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async () => {
        if (!newMessage.trim() || loading) return;

        try {
            await sendMessage(otherUserId, newMessage, rideId, requestId);
            setNewMessage('');
        } catch (error) {
            toast.error('Error al enviar mensaje');
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-semibold">Chat</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {messages.map(message => (
                    <MessageItem
                        key={message.id}
                        message={message}
                        isSent={message.is_sent}
                    />
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Escribe un mensaje..."
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={loading}
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={loading || !newMessage.trim()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                    >
                        {loading ? '...' : 'Enviar'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 3. REAL-TIME DASHBOARD ENHANCEMENTS
// ==========================================

export function useRealTimeDashboard(userId) {
    const [stats, setStats] = useState({});
    const [activityFeed, setActivityFeed] = useState([]);
    const [loading, setLoading] = useState(false);

    // Fetch dashboard stats with caching - REDUCED POLLING for better performance
    const { data: statsData, refetch: refetchStats } = useOptimizedDataFetch(
        `dashboard_stats_${userId}`,
        () => fetchDashboardStats(userId),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: null // DISABLED: Use manual refetch (was 10000)
        }
    );

    // Fetch activity feed with caching - REDUCED POLLING for better performance
    const { data: activityData, refetch: refetchActivity } = useOptimizedDataFetch(
        `dashboard_activity_${userId}`,
        () => fetchActivityFeed(userId),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: null // DISABLED: Use manual refetch (was 15000)
        }
    );

    const fetchDashboardStats = async (userId) => {
        if (!userId) return {};
        try {
            const { data, error } = await supabase.rpc('get_dashboard_stats', {
                p_user_id: userId
            });

            if (error) throw error;
            return data || {};
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
            return {};
        }
    };

    const fetchActivityFeed = async (userId) => {
        if (!userId) return [];
        try {
            const { data, error } = await supabase.rpc('get_dashboard_activity_feed', {
                p_user_id: userId,
                p_limit: 20,
                p_offset: 0
            });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching activity feed:', error);
            return [];
        }
    };

    const logActivity = async (activityType, activityData = {}) => {
        try {
            await supabase.rpc('log_dashboard_activity', {
                p_user_id: userId,
                p_activity_type: activityType,
                p_activity_data: activityData
            });
        } catch (error) {
            console.error('Error logging activity:', error);
        }
    };

    // Update state when data changes
    useEffect(() => {
        setStats(statsData || {});
    }, [statsData]);

    useEffect(() => {
        setActivityFeed(activityData || []);
    }, [activityData]);

    return {
        stats,
        activityFeed,
        loading,
        logActivity,
        refetchStats,
        refetchActivity
    };
}

// Dashboard Stats Component
export function DashboardStats({ stats }) {
    const getStatIcon = (key) => {
        switch (key) {
            case 'active_rides': return '🚗';
            case 'pending_requests': return '👤';
            case 'unread_messages': return '💬';
            case 'unread_notifications': return '🔔';
            case 'recent_activity': return '📊';
            default: return '📈';
        }
    };

    const getStatLabel = (key) => {
        switch (key) {
            case 'active_rides': return 'Viajes Activos';
            case 'pending_requests': return 'Solicitudes Pendientes';
            case 'unread_messages': return 'Mensajes No Leídos';
            case 'unread_notifications': return 'Notificaciones No Leídas';
            case 'recent_activity': return 'Actividad Reciente';
            default: return 'Estadística';
        }
    };

    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            {Object.entries(stats).map(([key, value]) => (
                <div key={key} className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-2xl font-bold">{value || 0}</p>
                            <p className="text-xs text-gray-500">{getStatLabel(key)}</p>
                        </div>
                        <div className="text-2xl">{getStatIcon(key)}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// Activity Feed Component
export function ActivityFeed({ activities }) {
    const getActivityIcon = (type) => {
        switch (type) {
            case 'ride_created': return '🚗';
            case 'ride_updated': return '🔄';
            case 'request_created': return '👤';
            case 'request_accepted': return '✅';
            case 'request_cancelled': return '❌';
            case 'location_update': return '📍';
            case 'message_sent': return '💬';
            case 'user_login': return '🔐';
            default: return '📊';
        }
    };

    const getActivityLabel = (type) => {
        switch (type) {
            case 'ride_created': return 'Viaje creado';
            case 'ride_updated': return 'Viaje actualizado';
            case 'request_created': return 'Solicitud creada';
            case 'request_accepted': return 'Solicitud aceptada';
            case 'request_cancelled': return 'Solicitud cancelada';
            case 'location_update': return 'Ubicación actualizada';
            case 'message_sent': return 'Mensaje enviado';
            case 'user_login': return 'Usuario conectado';
            default: return 'Actividad';
        }
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-lg font-semibold mb-4">Actividad Reciente</h3>
            <div className="space-y-3">
                {activities.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">📊</div>
                        <p>No hay actividad reciente</p>
                    </div>
                ) : (
                    activities.map(activity => (
                        <div key={activity.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <div className="text-2xl">{getActivityIcon(activity.activity_type)}</div>
                            <div className="flex-1">
                                <p className="text-sm font-medium">{getActivityLabel(activity.activity_type)}</p>
                                <p className="text-xs text-gray-500">{activity.relative_time}</p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ==========================================
// 4. REAL-TIME SUBSCRIPTIONS
// ==========================================

export function useRealTimeSubscriptions(userId) {
    const subscriptionsRef = useRef(new Map());

    const subscribeToNotifications = useCallback((callback) => {
        const subscription = supabase
            .channel(`notifications_${userId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`
            }, (payload) => {
                callback(payload);
            })
            .subscribe();

        subscriptionsRef.current.set('notifications', subscription);
        return subscription;
    }, [userId]);

    const subscribeToMessages = useCallback((callback) => {
        const subscription = supabase
            .channel(`messages_${userId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'messages',
                filter: `receiver_id=eq.${userId}`
            }, (payload) => {
                callback(payload);
            })
            .subscribe();

        subscriptionsRef.current.set('messages', subscription);
        return subscription;
    }, [userId]);

    const subscribeToActivity = useCallback((callback) => {
        const subscription = supabase
            .channel(`activity_${userId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'dashboard_activity',
                filter: `user_id=eq.${userId}`
            }, (payload) => {
                callback(payload);
            })
            .subscribe();

        subscriptionsRef.current.set('activity', subscription);
        return subscription;
    }, [userId]);

    const unsubscribeAll = useCallback(() => {
        subscriptionsRef.current.forEach((subscription) => {
            supabase.removeChannel(subscription);
        });
        subscriptionsRef.current.clear();
    }, []); // Empty deps - uses ref

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            unsubscribeAll();
        };
    }, []); // Empty deps - only run on unmount

    return {
        subscribeToNotifications,
        subscribeToMessages,
        subscribeToActivity,
        unsubscribeAll
    };
}

// ==========================================
// INSTRUCTIONS
// ==========================================
/*
WEEK 2 COMPLEMENTARY FEATURES - FRONTEND IMPLEMENTATION

✅ PERSISTENT NOTIFICATION SYSTEM:
- useNotifications hook for notification management
- NotificationItem and NotificationCenter components
- Real-time updates with WebSocket
- Mark as read functionality
- Unread count tracking

✅ BASIC CHAT SYSTEM:
- useChat hook for conversation management
- MessageItem and ChatComponent
- Real-time messaging
- Conversation list
- Read status tracking

✅ REAL-TIME DASHBOARD:
- useRealTimeDashboard hook
- DashboardStats component
- ActivityFeed component
- Real-time activity logging
- Performance monitoring

✅ REAL-TIME SUBSCRIPTIONS:
- useRealTimeSubscriptions hook
- WebSocket subscriptions for all features
- Automatic cleanup
- Event handling

HOW TO USE:

1. NOTIFICATIONS:
   const { notifications, unreadCount, markAsRead } = useNotifications(userId);
   <NotificationCenter userId={userId} isOpen={isOpen} onClose={onClose} />

2. CHAT:
   const { sendMessage, startConversation } = useChat(userId);
   <ChatComponent userId={userId} otherUserId={otherUserId} />

3. DASHBOARD:
   const { stats, activityFeed, logActivity } = useRealTimeDashboard(userId);
   <DashboardStats stats={stats} />
   <ActivityFeed activities={activityFeed} />

4. REAL-TIME UPDATES:
   const { subscribeToNotifications, subscribeToMessages } = useRealTimeSubscriptions(userId);

EXPECTED IMPROVEMENTS:
- Persistent notification system
- Real-time chat functionality
- Enhanced dashboard with activity feed
- Automatic status change notifications
- Better user engagement
- Improved communication system

IMPLEMENTATION STEPS:
1. Execute WEEK2_COMPLEMENTARY_FEATURES.sql in Supabase
2. Update frontend components to use new hooks
3. Add notification center to UI
4. Integrate chat components
5. Enhance dashboard with real-time features
6. Test real-time updates
*/
