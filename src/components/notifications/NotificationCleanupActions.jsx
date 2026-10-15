import { useState } from 'react';
import { Eraser, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button.jsx';
import { clearMyReadNotifications } from '@/services/notificationCleanupService.js';

export default function NotificationCleanupActions() {
  const [loading, setLoading] = useState(false);

  const handleClearRead = async () => {
    setLoading(true);
    try {
      const deleted = await clearMyReadNotifications();
      toast.success('Notificaciones limpiadas', {
        description: `${deleted} notificación(es) leídas eliminadas.`,
      });
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      toast.error('No se pudieron limpiar', {
        description: error?.message || 'Revisa la función SQL en Supabase.',
      });
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-black text-slate-900">Limpieza rápida</p>
        <p className="text-xs font-semibold text-slate-500">Elimina notificaciones leídas que no estén fijadas ni sean críticas.</p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={handleClearRead}
        disabled={loading}
        className="h-11 rounded-2xl font-black uppercase tracking-widest"
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eraser className="mr-2 h-4 w-4" />}
        Limpiar leídas
      </Button>
    </div>
  );
}
