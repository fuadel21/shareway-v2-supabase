import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { supabase } from '@/lib/supabase.js';
import { cn } from '@/lib/utils.js';

const parseRideIdFromPath = (pathname) => {
  const match = pathname.match(/^\/ride\/([^/]+)/);
  return match?.[1] || null;
};

const statusCopy = {
  active: { label: 'Activa', className: 'bg-red-50 text-red-700 border-red-100' },
  acknowledged: { label: 'Reconocida', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  resolved: { label: 'Resuelta', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  cancelled: { label: 'Cancelada', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const severityCopy = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

const getPoint = (alert) => {
  const location = alert.current_location || alert.metadata?.current_location || null;
  if (!location || typeof location !== 'object') return null;

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.lon ?? location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    accuracy: location.accuracy ?? null,
  };
};

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getStatusBadge = (status) => {
  const copy = statusCopy[status] || { label: status || 'Desconocida', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <Badge variant="outline" className={cn('rounded-full px-2.5 text-[8px] font-black uppercase tracking-widest', copy.className)}>
      {copy.label}
    </Badge>
  );
};

export default function RideEmergencyHistoryPanel() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [user, setUser] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const rideId = useMemo(() => parseRideIdFromPath(pathname), [pathname]);
  const activeAlerts = useMemo(() => alerts.filter((alert) => alert.status === 'active'), [alerts]);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    const timer = window.setInterval(syncPath, 1000);

    window.addEventListener('popstate', syncPath);
    window.addEventListener('hashchange', syncPath);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener('hashchange', syncPath);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data?.user || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  const loadAlerts = async ({ silent = false } = {}) => {
    if (!rideId || !user?.id) {
      setAlerts([]);
      return;
    }

    if (!silent) setLoading(true);

    try {
      const { data, error } = await supabase
        .from('emergency_alerts')
        .select('id, ride_id, user_id, chat_id, status, severity, current_location, metadata, acknowledged_at, resolved_at, created_at, updated_at')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setAlerts(data || []);
      setLastLoadedAt(new Date());
    } catch (error) {
      console.warn('[RideEmergencyHistoryPanel] load failed:', error);
      setAlerts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [rideId, user?.id]);

  useEffect(() => {
    if (!rideId || !user?.id) return undefined;

    const channel = supabase
      .channel(`ride-emergency-history:${rideId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_alerts', filter: `ride_id=eq.${rideId}` },
        () => loadAlerts({ silent: true }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, user?.id]);

  const handleRefresh = async () => {
    await loadAlerts({ silent: true });
    toast.success('Historial SOS actualizado');
  };

  if (!rideId || !user || (!loading && alerts.length === 0)) return null;

  return (
    <div className="fixed left-4 top-[5.25rem] z-[55] max-w-[calc(100vw-2rem)] sm:left-6 sm:top-24">
      <div className="w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] border border-slate-100 bg-white shadow-2xl shadow-slate-200/70">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="flex w-full items-center gap-3 bg-slate-900 px-4 py-3 text-left text-white active:scale-[0.99]"
        >
          <div className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-2xl',
            activeAlerts.length ? 'bg-red-500/20 text-red-200' : 'bg-white/10 text-white',
          )}>
            {loading ? <Loader2 className="size-5 animate-spin" /> : <ShieldAlert className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Auditoría del viaje</p>
            <h3 className="truncate text-sm font-black uppercase italic leading-tight">
              {alerts.length} alerta{alerts.length === 1 ? '' : 's'} SOS
            </h3>
          </div>
          {activeAlerts.length > 0 && (
            <span className="rounded-full bg-red-500 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-white">
              {activeAlerts.length} activa{activeAlerts.length === 1 ? '' : 's'}
            </span>
          )}
          {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {isOpen && (
          <div className="max-h-[65vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold leading-relaxed text-slate-500">
                Historial visible según permisos del viaje. Útil para soporte, seguimiento y revisión posterior.
              </p>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                className="h-10 w-10 shrink-0 rounded-2xl border-slate-100"
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>

            <div className="space-y-3">
              {alerts.map((alert) => {
                const point = getPoint(alert);
                const mapUrl = point ? `https://www.google.com/maps?q=${point.lat},${point.lng}` : null;
                const actorLabel = alert.user_id === user.id ? 'Tú' : `Usuario ${String(alert.user_id || '').slice(0, 8)}`;

                return (
                  <div key={alert.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusBadge(alert.status)}
                      <Badge variant="outline" className="rounded-full border-red-100 bg-red-50 px-2.5 text-[8px] font-black uppercase tracking-widest text-red-700">
                        {severityCopy[alert.severity] || alert.severity || 'Alta'}
                      </Badge>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[9px] font-bold text-slate-500">
                        <Clock3 className="size-3" /> {formatDate(alert.created_at)}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-xs font-bold text-slate-600">
                      <p>Activada por: <span className="font-black text-slate-900">{actorLabel}</span></p>
                      {alert.acknowledged_at && <p>Reconocida: {formatDate(alert.acknowledged_at)}</p>}
                      {alert.resolved_at && <p>Resuelta: {formatDate(alert.resolved_at)}</p>}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {mapUrl ? (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-red-600 px-3 text-[9px] font-black uppercase tracking-widest text-white active:scale-95"
                        >
                          <Navigation className="size-3.5" /> GPS
                        </a>
                      ) : (
                        <div className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">
                          <MapPin className="size-3.5" /> Sin GPS
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={!alert.chat_id}
                        onClick={() => window.location.assign(`/emergency/${rideId}`)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                      >
                        <MessageCircle className="size-3.5" /> Canal
                      </button>
                    </div>

                    <p className="mt-3 truncate text-[8px] font-bold uppercase tracking-widest text-slate-300">
                      ID alerta: {alert.id}
                    </p>
                  </div>
                );
              })}
            </div>

            {lastLoadedAt && (
              <p className="mt-3 text-center text-[8px] font-black uppercase tracking-widest text-slate-300">
                Actualizado {formatDate(lastLoadedAt.toISOString())}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
