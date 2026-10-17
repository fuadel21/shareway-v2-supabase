import React, { useState } from 'react';
import { Bell, CheckCheck, Inbox, Pin, Search, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { useNotifications } from '@/hooks/useNotifications.js';
import { cn } from '@/lib/utils';

const typeLabels = {
  all: 'Todas',
  ride_request: 'Viajes',
  request_accepted: 'Aceptadas',
  request_rejected: 'Rechazadas',
  chat_message: 'Chat',
  system: 'Sistema',
};

const NotificationBell = ({ user }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { notifications, unreadCount, loading, readOne, readAll } = useNotifications(user, { limit: 30 });

  const filtered = notifications.filter((item) => {
    const matchesFilter = filter === 'all' || item.type === filter;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || `${item.title || ''} ${item.message || ''}`.toLowerCase().includes(term);
    return matchesFilter && matchesSearch;
  });

  const openNotification = async (notification) => {
    if (!notification.is_read) await readOne(notification.id);
    setOpen(false);
    if (notification.action_url) navigate(notification.action_url);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-100 active:scale-95 transition-all"
        aria-label="Abrir notificaciones"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white shadow-lg">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-[80] w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-500">Centro</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Notificaciones</h3>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={readAll} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:text-slate-950" title="Marcar todas como leídas">
                  <CheckCheck className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:text-slate-950">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" className="h-11 rounded-2xl border-none bg-slate-50 pl-10 text-sm font-bold" />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(typeLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn('min-w-0 rounded-xl px-1.5 py-2 text-[10px] font-black leading-tight transition-all text-center', filter === key ? 'bg-primary text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto px-3 pb-3">
            {loading && <p className="py-8 text-center text-sm font-bold text-slate-400">Cargando...</p>}
            {!loading && filtered.length === 0 && (
              <div className="py-10 text-center text-slate-400">
                <Inbox className="mx-auto mb-3 h-8 w-8" />
                <p className="text-sm font-black">Sin notificaciones</p>
              </div>
            )}
            {filtered.map((notification) => (
              <button
                key={notification.id}
                onClick={() => openNotification(notification)}
                className={cn('mb-2 w-full rounded-2xl p-4 text-left transition-all', notification.is_read ? 'bg-slate-50 text-slate-500' : 'bg-orange-50 text-slate-950')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {notification.is_pinned && <Pin className="h-3.5 w-3.5 text-orange-500" />}
                      <p className="truncate text-sm font-black">{notification.title}</p>
                    </div>
                    {notification.message && <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 opacity-70">{notification.message}</p>}
                  </div>
                  {!notification.is_read && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500" />}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-slate-100 p-3">
            <Button asChild variant="ghost" className="h-12 w-full rounded-2xl font-black uppercase tracking-normal">
              <Link to="/notifications" onClick={() => setOpen(false)}>Ver centro completo</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
