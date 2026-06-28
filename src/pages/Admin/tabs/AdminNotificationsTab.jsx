import { useMemo, useState } from 'react';
import { BellRing, Loader2, Mail, MapPin, Megaphone, Send, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { supabase } from '@/lib/supabase.js';
import {
  sendAdminNotificationBySegment,
  sendAdminNotificationToUser,
} from '@/services/adminNotificationService.js';
import { cn } from '@/lib/utils.js';

const SEGMENTS = [
  { id: 'all', label: 'Todos', description: 'Toda la comunidad ShareWay', icon: Users },
  { id: 'drivers', label: 'Conductores', description: 'Usuarios con perfil conductor', icon: BellRing },
  { id: 'passengers', label: 'Pasajeros', description: 'Usuarios pasajeros', icon: Megaphone },
  { id: 'city', label: 'Ciudad', description: 'Filtrar por ciudad', icon: MapPin },
  { id: 'single', label: 'Usuario', description: 'Enviar por email concreto', icon: Mail },
];

const PRIORITIES = [
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
  { id: 'critical', label: 'Crítica' },
];

export default function AdminNotificationsTab() {
  const [segment, setSegment] = useState('all');
  const [priority, setPriority] = useState('normal');
  const [city, setCity] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [actionUrl, setActionUrl] = useState('/notifications');
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const selectedSegment = useMemo(
    () => SEGMENTS.find((item) => item.id === segment) || SEGMENTS[0],
    [segment],
  );

  const resolveUserByEmail = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error('Introduce el email del usuario');

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .ilike('email', cleanEmail)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error('No se encontró ningún usuario con ese email');
    return data;
  };

  const handleSend = async () => {
    if (!title.trim()) return toast.error('El título es obligatorio');
    if (!message.trim()) return toast.error('El mensaje es obligatorio');
    if (segment === 'city' && !city.trim()) return toast.error('Introduce una ciudad');

    setIsSending(true);
    setLastResult(null);

    try {
      let result;

      if (segment === 'single') {
        const userProfile = await resolveUserByEmail();
        result = await sendAdminNotificationToUser({
          userId: userProfile.id,
          title: title.trim(),
          message: message.trim(),
          actionUrl: actionUrl.trim() || '/notifications',
          priority,
          metadata: {
            channel: 'admin_panel',
            target_email: userProfile.email,
          },
        });
        setLastResult({ count: result ? 1 : 0, mode: 'single' });
      } else {
        result = await sendAdminNotificationBySegment({
          segment,
          city: city.trim() || null,
          title: title.trim(),
          message: message.trim(),
          actionUrl: actionUrl.trim() || '/notifications',
          priority,
          limit: 1000,
        });
        setLastResult({ count: result.length, mode: segment });
      }

      toast.success('Aviso enviado', {
        description: segment === 'single' ? 'Notificación enviada al usuario indicado.' : `Notificaciones creadas: ${result.length}`,
      });

      setTitle('');
      setMessage('');
    } catch (error) {
      console.error('[AdminNotificationsTab] send failed:', error);
      toast.error('No se pudo enviar el aviso', { description: error.message });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="rounded-[2rem] border-none bg-white shadow-xl text-left">
        <CardHeader className="p-6 sm:p-8 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl font-black uppercase italic tracking-tighter text-slate-900">Enviar aviso</CardTitle>
              <CardDescription className="mt-2 text-xs font-bold text-slate-500">
                Comunicación interna para usuarios, ciudades o segmentos completos.
              </CardDescription>
            </div>
            <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Megaphone className="size-6" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Segmento</label>
            <div className="grid gap-2 sm:grid-cols-5">
              {SEGMENTS.map((item) => {
                const Icon = item.icon;
                const active = segment === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSegment(item.id)}
                    className={cn(
                      'rounded-2xl border p-3 text-left transition-all active:scale-95',
                      active ? 'border-primary bg-primary/10 text-primary shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-500 hover:bg-white',
                    )}
                  >
                    <Icon className="mb-2 size-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest">{item.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {segment === 'city' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ciudad</label>
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Barcelona, Girona, Valencia..."
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-primary/30 focus:bg-white"
              />
            </div>
          )}

          {segment === 'single' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email del usuario</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario@email.com"
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-primary/30 focus:bg-white"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Título</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={90}
                placeholder="Ej. Nuevo piloto activo en Barcelona"
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-primary/30 focus:bg-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prioridad</label>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-primary/30 focus:bg-white"
              >
                {PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mensaje</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              placeholder="Escribe el aviso que verá el usuario en su campana de notificaciones..."
              className="min-h-[150px] w-full resize-none rounded-3xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm font-semibold leading-relaxed outline-none focus:border-primary/30 focus:bg-white"
            />
            <p className="text-right text-[10px] font-bold text-slate-400">{message.length}/500</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enlace interno</label>
            <input
              value={actionUrl}
              onChange={(event) => setActionUrl(event.target.value)}
              placeholder="/notifications"
              className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-primary/30 focus:bg-white"
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={isSending}
            className="h-14 w-full rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest gap-3 shadow-xl active:scale-95"
          >
            {isSending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            Enviar aviso
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-[2rem] border-none bg-slate-900 text-white shadow-xl overflow-hidden text-left">
          <CardHeader className="p-6 sm:p-8">
            <Badge className="mb-4 w-fit border-none bg-primary/20 text-primary font-black uppercase tracking-widest">Canal admin</Badge>
            <CardTitle className="text-2xl font-black uppercase italic tracking-tighter">{selectedSegment.label}</CardTitle>
            <CardDescription className="text-slate-400 font-bold">{selectedSegment.description}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 sm:px-8 pb-8 space-y-4">
            <div className="rounded-3xl bg-white/10 p-5 border border-white/10">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Previsualización</p>
              <h3 className="mt-3 text-lg font-black text-white">{title || 'Título del aviso'}</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-300">{message || 'El mensaje aparecerá aquí antes de enviarlo a los usuarios seleccionados.'}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <Badge className="border-none bg-white text-slate-900 font-black uppercase tracking-widest">{priority}</Badge>
                <span className="text-[10px] font-bold text-slate-500">{actionUrl || '/notifications'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {lastResult && (
          <Card className="rounded-[2rem] border-none bg-emerald-50 text-emerald-800 shadow-sm text-left">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="size-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center">
                <BellRing className="size-6" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-tight">Último envío completado</p>
                <p className="text-xs font-bold text-emerald-600">{lastResult.count} notificación(es) creadas · modo {lastResult.mode}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
