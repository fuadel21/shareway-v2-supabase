import React, { useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Bell, CheckCheck, ChevronLeft, Inbox, Pin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { useNotifications } from '@/hooks/useNotifications.js';
import { cn } from '@/lib/utils';

const filters = [
  ['all', 'Todas'],
  ['unread', 'No leídas'],
  ['ride_request', 'Viajes'],
  ['chat_message', 'Chat'],
  ['system', 'Sistema'],
  ['admin_announcement', 'Avisos'],
];

const NotificationCenter = () => {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { notifications, unreadCount, loading, readOne, unreadOne, readAll, pinOne } = useNotifications(user, { limit: 120, enableToasts: false });

  const visibleNotifications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesFilter = filter === 'all' || (filter === 'unread' ? !item.is_read : item.type === filter);
      const matchesSearch = !term || `${item.title || ''} ${item.message || ''}`.toLowerCase().includes(term);
      return matchesFilter && matchesSearch;
    });
  }, [notifications, filter, search]);

  const handleOpen = async (notification) => {
    if (!notification.is_read) await readOne(notification.id);
    if (notification.action_url) navigate(notification.action_url);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32 text-left">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white px-4 py-5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-2xl bg-slate-50">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-500">Actividad</p>
              <h1 className="text-2xl font-black tracking-tighter text-slate-950">Notificaciones</h1>
            </div>
          </div>
          {unreadCount > 0 && (
            <Button onClick={readAll} className="rounded-2xl bg-primary font-black uppercase tracking-normal text-white hover:bg-primary/90">
              <CheckCheck className="mr-2 h-4 w-4" /> Leer todas
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <Card className="rounded-3xl border-none bg-white p-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar notificaciones" className="h-14 rounded-2xl border-none bg-slate-50 pl-11 font-bold" />
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {filters.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn('shrink-0 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all', filter === key ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-400')}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        {loading && <p className="py-10 text-center text-sm font-bold text-slate-400">Cargando notificaciones...</p>}

        {!loading && visibleNotifications.length === 0 && (
          <Card className="rounded-3xl border-none bg-white p-10 text-center shadow-sm">
            <Inbox className="mx-auto mb-4 h-10 w-10 text-slate-300" />
            <h2 className="text-xl font-black tracking-tight text-slate-950">Sin notificaciones</h2>
            <p className="mt-2 text-sm font-bold text-slate-400">Cuando haya actividad importante aparecerá aquí.</p>
          </Card>
        )}

        <div className="space-y-3">
          {visibleNotifications.map((notification) => (
            <Card key={notification.id} className={cn('rounded-3xl border-none p-5 shadow-sm transition-all', notification.is_read ? 'bg-white' : 'bg-orange-50')}>
              <div className="flex items-start gap-4">
                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', notification.is_read ? 'bg-slate-100 text-slate-400' : 'bg-primary text-white')}>
                  <Bell className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {notification.is_pinned && <Pin className="h-4 w-4 text-orange-500" />}
                    <h3 className="font-black text-slate-950">{notification.title}</h3>
                    {!notification.is_read && <span className="rounded-full bg-orange-500 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white">Nuevo</span>}
                  </div>
                  {notification.message && <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{notification.message}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {notification.action_url && (
                      <Button onClick={() => handleOpen(notification)} className="h-10 rounded-xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] text-xs font-black uppercase tracking-normal text-white">Abrir</Button>
                    )}
                    <Button variant="outline" onClick={() => notification.is_read ? unreadOne(notification.id) : readOne(notification.id)} className="h-10 rounded-xl text-xs font-black uppercase tracking-normal">
                      {notification.is_read ? 'Marcar no leída' : 'Marcar leída'}
                    </Button>
                    <Button variant="ghost" onClick={() => pinOne(notification.id, !notification.is_pinned)} className="h-10 rounded-xl text-xs font-black uppercase tracking-normal">
                      {notification.is_pinned ? 'Desfijar' : 'Fijar'}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default NotificationCenter;
