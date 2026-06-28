import React from 'react';
import { useOutletContext } from 'react-router-dom';
import NotificationCenterPanel from '@/components/notifications/NotificationCenterPanel.jsx';
import NotificationCleanupActions from '@/components/notifications/NotificationCleanupActions.jsx';

export default function NotificationsPage() {
  const { user } = useOutletContext();

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Centro de actividad</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Notificaciones</h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
            Consulta reservas, mensajes, recordatorios, avisos del sistema y cambios importantes de tus viajes.
          </p>
        </div>

        <NotificationCleanupActions />
        <NotificationCenterPanel user={user} fullPage />
      </div>
    </div>
  );
}
