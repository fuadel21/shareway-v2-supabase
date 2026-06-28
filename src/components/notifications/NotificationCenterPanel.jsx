import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck, Clock, MessageSquare, Pin, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';
import { NOTIFICATION_TYPES } from '@/services/notificationService.js';
import useNotifications from '@/hooks/useNotifications.js';

const FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'No leídas' },
  { value: NOTIFICATION_TYPES.RIDE_REQUEST, label: 'Viajes' },
  { value: NOTIFICATION_TYPES.CHAT_MESSAGE, label: 'Chat' },
  { value: NOTIFICATION_TYPES.SYSTEM, label: 'Sistema' },
];

const TYPE_LABELS = {
  [NOTIFICATION_TYPES.SYSTEM]: 'Sistema',
  [NOTIFICATION_TYPES.INFO]: 'Info',
  [NOTIFICATION_TYPES.RIDE_REQUEST]: 'Viaje',
  [NOTIFICATION_TYPES.REQUEST_ACCEPTED]: 'Aceptada',
  [NOTIFICATION_TYPES.REQUEST_REJECTED]: 'Rechazada',
  [NOTIFICATION_TYPES.CHAT_MESSAGE]: 'Chat',
  [NOTIFICATION_TYPES.RIDE_REMINDER]: 'Recordatorio',
  [NOTIFICATION_TYPES.RIDE_CANCELLED]: 'Cancelación',
  [NOTIFICATION_TYPES.REVIEW]: 'Valoración',
  [NOTIFICATION_TYPES.ACHIEVEMENT]: 'Logro',
  [NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT]: 'Admin',
};

const iconForType = (type) => {
  if (type === NOTIFICATION_TYPES.CHAT_MESSAGE) return MessageSquare;
  if ([NOTIFICATION_TYPES.RIDE_REQUEST, NOTIFICATION_TYPES.REQUEST_ACCEPTED, NOTIFICATION_TYPES.REQUEST_REJECTED, NOTIFICATION_TYPES.RIDE_CANCELLED].includes(type)) return Bell;
  return Clock;
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
};

function NotificationRow({ notification, onOpen, onRead, onPin }) {
  const Icon = iconForType(notification.type);

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        'w-full rounded-2xl border p-3 text-left transition-all hover:shadow-md active:scale-[0.99]',
        notification.is_read ? 'border-slate-100 bg-white' : 'border-emerald-100 bg-emerald-50',
      )}
    >
      <div className="flex gap-3">
        <div className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
          notification.is_read ? 'bg-slate-100 text-slate-500' : 'bg-emerald-500 text-white',
        )}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="line-clamp-1 text-sm font-black text-slate-900">{notification.title}</h4>
            <span className="shrink-0 text-[10px] font-bold text-slate-400">{formatDate(notification.created_at)}</span>
          </div>

          {(notification.message || notification.content || notification.body) && (
            <p className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-500">
              {notification.message || notification.content || notification.body}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
              {TYPE_LABELS[notification.type] || notification.type || 'Sistema'}
            </span>

            <div className="flex items-center gap-1">
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onPin(notification.id, !notification.is_pinned);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onPin(notification.id, !notification.is_pinned);
                  }
                }}
                className={cn('rounded-full p-1.5 transition-colors hover:bg-slate-100', notification.is_pinned ? 'text-amber-500' : 'text-slate-300')}
                title={notification.is_pinned ? 'Desfijar' : 'Fijar'}
              >
                <Pin className="h-3.5 w-3.5" />
              </span>

              {!notification.is_read && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRead(notification.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onRead(notification.id);
                    }
                  }}
                  className="rounded-full p-1.5 text-emerald-600 transition-colors hover:bg-emerald-100"
                  title="Marcar como leída"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function NotificationCenterPanel({ user, children }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');

  const {
    notifications,
    unreadCount,
    loading,
    readOne,
    readAll,
    pinOne,
  } = useNotifications(user, { limit: 80, enableToasts: !open });

  const filteredNotifications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notifications.filter((notification) => {
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'unread' && !notification.is_read)
        || notification.type === activeFilter;

      const message = notification.message || notification.content || notification.body || '';
      const matchesSearch = !term
        || notification.title?.toLowerCase().includes(term)
        || message.toLowerCase().includes(term);

      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, notifications, search]);

  const openNotification = async (notification) => {
    if (!notification.is_read) await readOne(notification.id);

    const destination = notification.action_url || notification.link || notification.url;
    if (destination) {
      setOpen(false);
      navigate(destination);
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="relative block" aria-label="Abrir notificaciones">
        {children || (
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-sm">
            <Bell className="h-5 w-5 text-slate-600" />
          </span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black text-white shadow-lg">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-[1200] w-[min(92vw,420px)] overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl shadow-slate-900/10">
          <div className="border-b border-slate-100 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black tracking-tight text-slate-900">Notificaciones</h2>
                <p className="text-xs font-semibold text-slate-500">{unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al día'}</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={readAll} className="rounded-2xl text-[11px] font-black uppercase tracking-widest">
                    Leer todo
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} className="rounded-2xl">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar aviso..."
                className="w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setActiveFilter(filter.value)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors',
                    activeFilter === filter.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-100',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[460px] space-y-2 overflow-y-auto p-3">
            {loading && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">
                Cargando notificaciones...
              </div>
            )}

            {!loading && filteredNotifications.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                  <Bell className="h-5 w-5 text-slate-400" />
                </div>
                <h3 className="text-sm font-black text-slate-800">Sin notificaciones</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">Aquí aparecerán reservas, mensajes, avisos y recordatorios.</p>
              </div>
            )}

            {!loading && filteredNotifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onOpen={openNotification}
                onRead={readOne}
                onPin={pinOne}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
