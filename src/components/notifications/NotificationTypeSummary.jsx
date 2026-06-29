import { Bell, CheckCircle2, Clock, MessageSquare, Megaphone, Star } from 'lucide-react';

import { NOTIFICATION_TYPES } from '@/services/notificationService.js';
import useNotifications from '@/hooks/useNotifications.js';

const rideTypes = new Set([
  NOTIFICATION_TYPES.RIDE_REQUEST,
  NOTIFICATION_TYPES.REQUEST_ACCEPTED,
  NOTIFICATION_TYPES.REQUEST_REJECTED,
  NOTIFICATION_TYPES.RIDE_CANCELLED,
]);

const statDefinitions = [
  {
    key: 'unread',
    label: 'No leídas',
    icon: Bell,
    count: (items) => items.filter((item) => !item.is_read).length,
  },
  {
    key: 'rides',
    label: 'Viajes',
    icon: CheckCircle2,
    count: (items) => items.filter((item) => rideTypes.has(item.type)).length,
  },
  {
    key: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    count: (items) => items.filter((item) => item.type === NOTIFICATION_TYPES.CHAT_MESSAGE).length,
  },
  {
    key: 'reminders',
    label: 'Recordatorios',
    icon: Clock,
    count: (items) => items.filter((item) => item.type === NOTIFICATION_TYPES.RIDE_REMINDER).length,
  },
  {
    key: 'reviews',
    label: 'Valoraciones',
    icon: Star,
    count: (items) => items.filter((item) => item.type === NOTIFICATION_TYPES.REVIEW).length,
  },
  {
    key: 'announcements',
    label: 'Avisos',
    icon: Megaphone,
    count: (items) => items.filter((item) => item.type === NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT).length,
  },
];

export default function NotificationTypeSummary({ user }) {
  const { notifications, loading } = useNotifications(user, { limit: 200, enableToasts: false });

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {statDefinitions.map((stat) => {
        const Icon = stat.icon;
        const value = loading ? '...' : stat.count(notifications);

        return (
          <div key={stat.key} className="rounded-[1.35rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-black tracking-tight text-slate-900">{value}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}
