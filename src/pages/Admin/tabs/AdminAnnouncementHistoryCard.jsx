import { useEffect, useState } from 'react';
import { BellRing, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { getAdminNotificationHistory } from '@/services/adminNotificationService.js';

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

export default function AdminAnnouncementHistoryCard({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await getAdminNotificationHistory(20);
      setItems(rows || []);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [refreshKey]);

  return (
    <Card className="rounded-[2rem] border-none bg-white shadow-xl text-left">
      <CardHeader className="p-6 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl font-black uppercase italic tracking-tighter text-slate-900">Historial</CardTitle>
            <CardDescription className="text-xs font-bold text-slate-500">Últimos avisos enviados desde administración.</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={loadHistory} disabled={loading} className="rounded-2xl">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {error && (
          <div className="rounded-2xl bg-amber-50 p-4 text-xs font-bold text-amber-700">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-400">
            Todavía no hay historial disponible.
          </div>
        )}

        {items.map((item) => (
          <div key={item.id || `${item.created_at}-${item.title}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{item.message}</p>
              </div>
              <Badge className="shrink-0 border-none bg-white text-slate-700 font-black uppercase tracking-widest">
                {item.target || 'all'}
              </Badge>
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span>{formatDate(item.created_at)}</span>
              <span>{item.sent_count ?? 0} creadas</span>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <BellRing className="size-3" />
              <span>{item.priority || 'normal'}</span>
              <span>·</span>
              <span>{item.action_url || '/notifications'}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
