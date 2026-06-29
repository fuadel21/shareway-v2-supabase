import { Bell, Radio } from 'lucide-react';

import useNotifications from '@/hooks/useNotifications.js';
import { cn } from '@/lib/utils.js';

export default function NotificationBellShortcut({ user }) {
  const { unreadCount } = useNotifications(user, { limit: 12, enableToasts: false });
  const hasUnread = unreadCount > 0;

  return (
    <div
      className={cn(
        'relative flex h-9 items-center justify-center gap-2 rounded-xl border px-3 shadow-sm transition-all active:scale-95 lg:h-11 lg:rounded-2xl lg:px-4',
        hasUnread
          ? 'border-emerald-100 bg-emerald-50 text-emerald-700 shadow-emerald-100/60'
          : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      <div className="relative">
        <Bell className={cn('h-4 w-4 lg:h-5 lg:w-5', hasUnread ? 'text-emerald-600' : 'text-slate-600')} />
        {hasUnread && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />
        )}
      </div>

      <div className="hidden min-w-0 text-left xl:block">
        <p className="text-[9px] font-black uppercase leading-none tracking-widest">Avisos</p>
        <p className="mt-1 flex items-center gap-1 text-[8px] font-black uppercase leading-none tracking-widest text-slate-400">
          <Radio className="h-2.5 w-2.5" />
          {hasUnread ? `${unreadCount} nuevo(s)` : 'Al día'}
        </p>
      </div>
    </div>
  );
}
