import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import {
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  markAsUnread,
  subscribeToNotifications,
  togglePinned,
} from '@/services/notificationService.js';

const upsertNotification = (items, next) => {
  if (!next?.id) return items;
  const exists = items.some((item) => item.id === next.id);
  const updated = exists ? items.map((item) => item.id === next.id ? next : item) : [next, ...items];
  return updated.sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
};

export const useNotifications = (userOrId, options = {}) => {
  const userId = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  const { limit = 50, enableToasts = true } = options;
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState(null);

  const refresh = useCallback(async (filters = {}) => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [items, count] = await Promise.all([
        getNotifications(userId, { limit, ...filters }),
        getUnreadCount(userId),
      ]);
      setNotifications(items);
      setUnreadCount(count);
    } catch (err) {
      console.error('[useNotifications] refresh failed:', err);
      setError(err.message || 'No se pudieron cargar las notificaciones');
    } finally {
      setLoading(false);
    }
  }, [limit, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = subscribeToNotifications(userId, async (payload) => {
      if (payload.eventType === 'INSERT') {
        setNotifications((items) => upsertNotification(items, payload.new));
        setUnreadCount((count) => count + (payload.new?.is_read ? 0 : 1));
        if (enableToasts && payload.new?.title) {
          toast(payload.new.title, { description: payload.new.message || undefined });
        }
      }

      if (payload.eventType === 'UPDATE') {
        setNotifications((items) => upsertNotification(items, payload.new));
        const count = await getUnreadCount(userId);
        setUnreadCount(count);
      }

      if (payload.eventType === 'DELETE') {
        setNotifications((items) => items.filter((item) => item.id !== payload.old?.id));
        const count = await getUnreadCount(userId);
        setUnreadCount(count);
      }
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [enableToasts, userId]);

  const readOne = useCallback(async (id) => {
    await markAsRead(id);
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
  }, []);

  const unreadOne = useCallback(async (id) => {
    await markAsUnread(id);
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, is_read: false, read_at: null } : item));
    setUnreadCount((count) => count + 1);
  }, []);

  const readAll = useCallback(async () => {
    if (!userId) return;
    await markAllAsRead(userId);
    setNotifications((items) => items.map((item) => ({ ...item, is_read: true, read_at: item.read_at || new Date().toISOString() })));
    setUnreadCount(0);
  }, [userId]);

  const pinOne = useCallback(async (id, isPinned) => {
    await togglePinned(id, isPinned);
    setNotifications((items) => {
      const current = items.find((item) => item.id === id);
      return upsertNotification(items, current ? { ...current, is_pinned: isPinned } : null);
    });
  }, []);

  const deleteOne = useCallback(async (id) => {
    const current = notifications.find((item) => item.id === id);
    await deleteNotification(id);
    setNotifications((items) => items.filter((item) => item.id !== id));
    if (current && !current.is_read) {
      setUnreadCount((count) => Math.max(0, count - 1));
    }
  }, [notifications]);

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.is_read), [notifications]);

  return {
    notifications,
    unreadNotifications,
    unreadCount,
    loading,
    error,
    refresh,
    readOne,
    unreadOne,
    readAll,
    pinOne,
    deleteOne,
  };
};

export default useNotifications;
