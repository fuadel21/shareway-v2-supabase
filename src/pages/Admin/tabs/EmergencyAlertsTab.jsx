import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { supabase } from '@/lib/supabase.js';
import { cn } from '@/lib/utils.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'acknowledged', label: 'Reconocidas' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'cancelled', label: 'Canceladas' },
];

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

const formatDate = (value) => {
  if (!value) return 'Fecha pendiente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getPoint = (alert) => {
  const location = alert.current_location || alert.location || null;
  if (!location || typeof location !== 'object') return null;

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.lon ?? location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    accuracy: location.accuracy ?? null,
    capturedAt: location.captured_at ?? null,
  };
};

const getLocationLabel = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.name || value.address || value.formatted_address || fallback;
};

const EmergencyAlertsTab = () => {
  const [alerts, setAlerts] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [ridesById, setRidesById] = useState({});
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  const filteredAlerts = useMemo(() => {
    if (statusFilter === 'all') return alerts;
    return alerts.filter((alert) => alert.status === statusFilter);
  }, [alerts, statusFilter]);

  const activeCount = useMemo(() => alerts.filter((alert) => alert.status === 'active').length, [alerts]);

  const hydrateRelatedData = async (rows) => {
    const userIds = [...new Set(rows.map((item) => item.user_id).filter(Boolean))];
    const rideIds = [...new Set(rows.map((item) => item.ride_id).filter(Boolean))];

    const [profilesRes, ridesRes] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, display_name, email').in('id', userIds)
        : Promise.resolve({ data: [] }),
      rideIds.length
        ? supabase.from('rides').select('id, origin, destination, departure_time, driver_id, status').in('id', rideIds)
        : Promise.resolve({ data: [] }),
    ]);

    if (profilesRes.error) console.warn('[EmergencyAlertsTab] profiles hydration failed:', profilesRes.error);
    if (ridesRes.error) console.warn('[EmergencyAlertsTab] rides hydration failed:', ridesRes.error);

    setProfilesById(Object.fromEntries((profilesRes.data || []).map((item) => [item.id, item])));
    setRidesById(Object.fromEntries((ridesRes.data || []).map((item) => [item.id, item])));
  };

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emergency_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = data || [];
      setAlerts(rows);
      await hydrateRelatedData(rows);
    } catch (error) {
      console.error('[EmergencyAlertsTab] fetch failed:', error);
      toast.error('No se pudieron cargar las alertas SOS', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();

    const channel = supabase
      .channel('admin-emergency-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_alerts' },
        () => fetchAlerts(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateAlertStatus = async (alertId, status) => {
    setUpdatingId(alertId);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const adminId = userRes?.user?.id || null;
      const patch = { status };

      if (status === 'acknowledged') {
        patch.acknowledged_by = adminId;
        patch.acknowledged_at = new Date().toISOString();
      }

      if (status === 'resolved' || status === 'cancelled') {
        patch.resolved_by = adminId;
        patch.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('emergency_alerts')
        .update(patch)
        .eq('id', alertId);

      if (error) throw error;

      toast.success('Alerta actualizada');
      await fetchAlerts();
    } catch (error) {
      console.error('[EmergencyAlertsTab] status update failed:', error);
      toast.error('No se pudo actualizar la alerta', { description: error.message });
    } finally {
      setUpdatingId(null);
    }
  };

  const renderStatusBadge = (status) => {
    const copy = statusCopy[status] || { label: status || 'Desconocida', className: 'bg-slate-100 text-slate-600 border-slate-200' };
    return <Badge variant="outline" className={cn('rounded-full px-3 font-black uppercase tracking-widest text-[9px]', copy.className)}>{copy.label}</Badge>;
  };

  return (
    <div className="space-y-6 text-left">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="rounded-[2rem] border-none bg-slate-900 text-white shadow-xl overflow-hidden">
          <CardHeader className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Badge className="mb-4 w-fit border-none bg-red-500/20 text-red-200 font-black uppercase tracking-widest">SOS Center</Badge>
                <CardTitle className="text-3xl font-black uppercase italic tracking-tighter">Alertas de emergencia</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-slate-400 font-bold">
                  Monitoriza activaciones SOS, ubicación compartida, usuario afectado y estado operativo de cada alerta.
                </CardDescription>
              </div>

              <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 p-5 min-w-[180px]">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-200">Activas</p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-5xl font-black italic leading-none">{activeCount}</span>
                  <AlertTriangle className="mb-1 size-7 text-red-300" />
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card className="rounded-[2rem] border-none bg-white shadow-xl">
          <CardHeader className="p-6 pb-3">
            <CardTitle className="text-sm font-black uppercase italic tracking-tighter">Filtro rápido</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-3">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-black uppercase tracking-widest outline-none focus:border-red-200 focus:bg-white"
            >
              {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={fetchAlerts}
              disabled={loading}
              className="h-12 w-full rounded-2xl border-slate-100 font-black uppercase tracking-widest text-[10px] gap-2"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refrescar
            </Button>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="rounded-[2rem] border border-slate-100 bg-white p-16 text-center shadow-sm">
          <Loader2 className="mx-auto size-10 animate-spin text-red-500" />
          <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando alertas SOS...</p>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-16 text-center">
          <ShieldCheck className="mx-auto mb-4 size-12 text-emerald-400" />
          <h3 className="text-lg font-black uppercase italic tracking-tighter text-slate-900">Sin alertas en este filtro</h3>
          <p className="mt-2 text-xs font-bold text-slate-400">Cuando un usuario active SOS desde un viaje aparecerá aquí.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredAlerts.map((alert) => {
            const profile = profilesById[alert.user_id] || {};
            const ride = ridesById[alert.ride_id] || {};
            const point = getPoint(alert);
            const mapUrl = point ? `https://www.google.com/maps?q=${point.lat},${point.lng}` : null;
            const origin = getLocationLabel(ride.origin, 'Origen no disponible');
            const destination = getLocationLabel(ride.destination, 'Destino no disponible');
            const isUpdating = updatingId === alert.id;

            return (
              <Card key={alert.id} className="rounded-[2rem] border border-slate-100 bg-white shadow-sm hover:shadow-xl transition-all overflow-hidden">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {renderStatusBadge(alert.status)}
                        <Badge variant="outline" className="rounded-full border-red-100 bg-red-50 px-3 text-[9px] font-black uppercase tracking-widest text-red-700">
                          Severidad {severityCopy[alert.severity] || alert.severity || 'Alta'}
                        </Badge>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1 text-[10px] font-bold text-slate-500">
                          <Clock3 className="size-3" /> {formatDate(alert.created_at)}
                        </span>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-3xl bg-slate-50 p-4">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Usuario</p>
                          <div className="mt-2 flex items-center gap-2 min-w-0">
                            <UserRound className="size-4 text-slate-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-slate-900">{profile.display_name || 'Usuario SOS'}</p>
                              <p className="truncate text-[10px] font-bold text-slate-400">{profile.email || alert.user_id}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-3xl bg-slate-50 p-4 md:col-span-2">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Viaje</p>
                          <div className="mt-2 space-y-1 text-sm font-bold text-slate-900">
                            <p className="truncate">{origin}</p>
                            <p className="truncate text-slate-500">→ {destination}</p>
                          </div>
                          <p className="mt-2 text-[10px] font-bold text-slate-400">Salida: {formatDate(ride.departure_time)}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                        <span className="rounded-full bg-slate-50 px-3 py-1">Alerta: {alert.id}</span>
                        <span className="rounded-full bg-slate-50 px-3 py-1">Viaje: {alert.ride_id}</span>
                        {alert.chat_id && <span className="rounded-full bg-slate-50 px-3 py-1">Chat: {alert.chat_id}</span>}
                      </div>
                    </div>

                    <div className="flex w-full flex-col gap-2 xl:w-[230px]">
                      {mapUrl ? (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-red-100 active:scale-95"
                        >
                          <Navigation className="size-4" /> Ver ubicación
                        </a>
                      ) : (
                        <div className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          <MapPin className="size-4" /> Sin GPS
                        </div>
                      )}

                      {alert.chat_id && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-2xl border-slate-100 text-[10px] font-black uppercase tracking-widest gap-2"
                          onClick={() => window.open(`/emergency/${alert.ride_id}`, '_blank')}
                        >
                          <MessageCircle className="size-4" /> Canal SOS
                        </Button>
                      )}

                      {alert.status === 'active' && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isUpdating}
                          onClick={() => updateAlertStatus(alert.id, 'acknowledged')}
                          className="h-11 rounded-2xl border-amber-100 bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest gap-2"
                        >
                          {isUpdating ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
                          Reconocer
                        </Button>
                      )}

                      {alert.status !== 'resolved' && alert.status !== 'cancelled' && (
                        <Button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => updateAlertStatus(alert.id, 'resolved')}
                          className="h-11 rounded-2xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest gap-2"
                        >
                          {isUpdating ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                          Resolver
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EmergencyAlertsTab;
