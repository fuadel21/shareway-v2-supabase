import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { BellRing, CheckCheck, Loader2, RefreshCcw, Send, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import SubPageHeader from '@/components/SubPageHeader.jsx';
import useNotifications from '@/hooks/useNotifications.js';
import { createNotification, NOTIFICATION_TYPES } from '@/services/notificationService.js';

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const NotificationTestPage = () => {
  const { user, profile, isAdmin } = useOutletContext();
  const [sending, setSending] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    readAll,
  } = useNotifications(user, { limit: 12, enableToasts: false });

  const canRunTest = Boolean(user?.id);
  const testLabel = useMemo(() => {
    const name = profile?.display_name || user?.email?.split('@')[0] || 'Usuario';
    return `${name} · ${isAdmin ? 'admin' : 'usuario'}`;
  }, [isAdmin, profile?.display_name, user?.email]);

  const handleCreateTestNotification = async () => {
    if (!canRunTest) {
      toast.error('Sesión no válida');
      return;
    }

    setSending(true);
    const toastId = toast.loading('Creando notificación de prueba...');

    try {
      const created = await createNotification({
        userId: user.id,
        actorId: user.id,
        type: NOTIFICATION_TYPES.SYSTEM,
        title: 'Prueba de notificaciones ShareWay',
        message: `Realtime activo para ${testLabel}.`,
        actionUrl: '/settings/notification-test',
        entityType: 'notification_test',
        entityId: crypto.randomUUID?.() || String(Date.now()),
        priority: 'normal',
        metadata: {
          source: 'NotificationTestPage',
          createdFromClient: true,
          timestamp: new Date().toISOString(),
        },
      });

      if (!created) {
        throw new Error('La notificación no se creó. Revisa RLS, preferencias o sesión.');
      }

      toast.success('Notificación creada', {
        id: toastId,
        description: 'Si Realtime está activo, aparecerá arriba automáticamente.',
      });

      await refresh();
    } catch (err) {
      console.error('Notification test failed:', err);
      toast.error('No se pudo crear la prueba', {
        id: toastId,
        description: err?.message || 'Revisa RLS, migraciones y sesión.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await readAll();
      toast.success('Notificaciones marcadas como leídas');
    } catch (err) {
      toast.error('No se pudieron marcar como leídas', {
        description: err?.message,
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32 text-left">
      <SubPageHeader title="Test Notificaciones" backPath="/settings" />

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <Card className="rounded-[2rem] border-none bg-white p-6 shadow-xl space-y-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black tracking-tight text-slate-900">Prueba segura de notificaciones</h1>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                Esta pantalla crea una notificación únicamente para tu propio usuario. Sirve para validar RLS, inserción, lectura y Realtime sin tocar viajes reales.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.5rem] bg-slate-50 p-4 text-xs font-bold text-slate-600 sm:grid-cols-3">
            <div>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">Usuario</span>
              {testLabel}
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">No leídas</span>
              {unreadCount}
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">Estado</span>
              {loading ? 'Cargando' : error ? 'Error' : 'Operativo'}
            </div>
          </div>

          {error && (
            <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-600">
              {error || 'Error cargando notificaciones'}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={handleCreateTestNotification}
              disabled={sending || !canRunTest}
              className="h-12 rounded-2xl font-black uppercase tracking-tight"
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Crear prueba
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => refresh()}
              disabled={loading}
              className="h-12 rounded-2xl font-black uppercase tracking-tight"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refrescar
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0}
              className="h-12 rounded-2xl font-black uppercase tracking-tight"
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Marcar leídas
            </Button>
          </div>
        </Card>

        <Card className="rounded-[2rem] border-none bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">Últimas notificaciones</h2>
              <p className="text-xs font-semibold text-slate-400">Las nuevas deberían aparecer sin recargar si Realtime está activo.</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          </div>

          <div className="space-y-3">
            {loading && notifications.length === 0 && (
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando notificaciones...
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-400">
                No hay notificaciones todavía. Pulsa “Crear prueba”.
              </div>
            )}

            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-2xl border p-4 transition-all ${notification.is_read ? 'border-slate-100 bg-white' : 'border-primary/20 bg-primary/5'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">{notification.title}</p>
                    <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">{notification.message || 'Sin mensaje'}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500">
                    {notification.type}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <span>{formatDate(notification.created_at)}</span>
                  <span>{notification.is_read ? 'Leída' : 'No leída'}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
};

export default NotificationTestPage;
