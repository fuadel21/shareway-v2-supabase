import { useState } from 'react';
import { Bell, Loader2, Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button.jsx';
import { registerPushSubscription } from '@/services/pushSubscriptionService.js';
import { sendTestPush } from '@/services/pushTestService.js';

export default function BrowserAlertsCard({ userId }) {
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const activate = async () => {
    setLoading(true);
    try {
      await registerPushSubscription(userId);
      toast.success('Avisos activados', {
        description: 'Este dispositivo queda preparado para recibir avisos de ShareWay.',
      });
    } catch (error) {
      toast.error('No se pudieron activar', {
        description: error?.message || 'Revisa la configuración.',
      });
    } finally {
      setLoading(false);
    }
  };

  const testPush = async () => {
    setTesting(true);
    try {
      const result = await sendTestPush();
      toast.success('Prueba enviada', {
        description: `${result?.sent || 0} dispositivo(s) notificado(s).`,
      });
    } catch (error) {
      toast.error('No se pudo enviar prueba', {
        description: error?.message || 'Revisa Supabase Functions.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-[2.5rem] border border-emerald-100 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-5">
        <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-600">
          <Smartphone className="size-6" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="font-black uppercase italic tracking-tight text-slate-900">Avisos del navegador</p>
          <p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-400">
            Activa este dispositivo para recibir avisos importantes de ShareWay.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={activate}
              disabled={loading || testing}
              className="rounded-2xl bg-emerald-600 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-700"
            >
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Bell className="mr-2 size-4" />}
              Activar avisos
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={testPush}
              disabled={loading || testing}
              className="rounded-2xl text-[10px] font-black uppercase tracking-widest"
            >
              {testing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              Enviar prueba
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
