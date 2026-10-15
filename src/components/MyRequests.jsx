import { useEffect, useMemo, useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import { Button } from '@/components/ui/button.jsx';
import {
  Loader2, Calendar, Clock, ArrowUpRight, Zap, Target, Plus,
  RefreshCw, CheckCircle2, AlertCircle, XCircle, Filter, Megaphone,
  Search, Route, Euro, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  getEffectiveRequestStatus,
  isAcceptedRequestStatus,
  isClosedActivityStatus,
  RIDE_EXPIRATION_GRACE_MINUTES,
} from '@/utils/activityFilters.js';

const copyByLanguage = {
  es: {
    title: 'Solicitudes',
    origin: 'Origen',
    destination: 'Destino',
    budget: 'Presupuesto / plaza',
    seats: 'Plazas',
    cancelling: 'CANCELANDO...',
    cancelRequest: 'CANCELAR',
    viewRequest: 'VER',
    cancelledTitle: 'Solicitud cancelada',
    cancelledDesc: 'Tu petición ha sido eliminada correctamente.',
    cancelErrorTitle: 'Error al cancelar',
    cancelErrorDesc: 'No se pudo cancelar la solicitud.',
    technicalError: 'Error técnico',
    technicalErrorDesc: 'Revisa tu conexión e inténtalo de nuevo.',
    radarTitle: 'Centro de solicitudes',
    radarDesc: 'Controla tus peticiones, mira cuáles siguen activas y crea una nueva cuando no encuentres viaje.',
    active: 'ACTIVAS',
    accepted: 'ACEPTADAS',
    history: 'HISTORIAL',
    cancelled: 'CANCELADAS',
    expired: 'CADUCADAS',
    all: 'TODAS',
    scanning: 'Escaneando radar...',
    noRequests: 'Sin solicitudes',
    noRequestsDesc: 'Lanza una petición al sistema y los conductores podrán encontrarte.',
    newRequest: 'Nueva Solicitud',
    refresh: 'Actualizar',
    activeLabel: 'Activas',
    acceptedLabel: 'Aceptadas',
    closedLabel: 'Cerradas',
    totalLabel: 'Total',
    quickActions: 'Acciones rápidas',
    publishRequest: 'Publicar solicitud',
    findRide: 'Buscar viaje',
    openHint: 'Pendiente de conductor',
    acceptedHint: 'Conductor interesado',
    closedHint: 'Finalizada o cerrada',
    departedHint: 'La fecha ya pasó',
    status: {
      pending: 'PENDIENTE',
      accepted: 'ACEPTADA',
      confirmed: 'PARA REALIZAR',
      on_board: 'EN VIAJE',
      completed: 'FINALIZADA',
      cancelled: 'CANCELADA',
      rejected: 'RECHAZADA',
      expired: 'EXPIRADA'
    }
  },
  en: {
    title: 'Requests',
    origin: 'Origin',
    destination: 'Destination',
    budget: 'Budget / seat',
    seats: 'Seats',
    cancelling: 'CANCELLING...',
    cancelRequest: 'CANCEL',
    viewRequest: 'VIEW',
    cancelledTitle: 'Request cancelled',
    cancelledDesc: 'Your request has been deleted successfully.',
    cancelErrorTitle: 'Cancellation error',
    cancelErrorDesc: 'Could not cancel the request.',
    technicalError: 'Technical error',
    technicalErrorDesc: 'Check your connection and try again.',
    radarTitle: 'Request center',
    radarDesc: 'Control your requests, see what is still active and create a new one when you cannot find a ride.',
    active: 'ACTIVE',
    accepted: 'ACCEPTED',
    history: 'HISTORY',
    cancelled: 'CANCELLED',
    expired: 'EXPIRED',
    all: 'ALL',
    scanning: 'Scanning radar...',
    noRequests: 'No requests',
    noRequestsDesc: 'Post a request so drivers can find you.',
    newRequest: 'New Request',
    refresh: 'Refresh',
    activeLabel: 'Active',
    acceptedLabel: 'Accepted',
    closedLabel: 'Closed',
    totalLabel: 'Total',
    quickActions: 'Quick actions',
    publishRequest: 'Publish request',
    findRide: 'Find ride',
    openHint: 'Waiting for driver',
    acceptedHint: 'Driver interested',
    closedHint: 'Completed or closed',
    departedHint: 'Date has passed',
    status: {
      pending: 'PENDING',
      accepted: 'ACCEPTED',
      confirmed: 'TO DO',
      on_board: 'ON TRIP',
      completed: 'COMPLETED',
      cancelled: 'CANCELLED',
      rejected: 'REJECTED',
      expired: 'EXPIRED'
    }
  },
  ar: {
    title: 'الطلبات',
    origin: 'نقطة الانطلاق',
    destination: 'الوجهة',
    budget: 'الميزانية / المقعد',
    seats: 'المقاعد',
    cancelling: 'جارٍ الإلغاء...',
    cancelRequest: 'إلغاء',
    viewRequest: 'عرض',
    cancelledTitle: 'تم إلغاء الطلب',
    cancelledDesc: 'تم حذف طلبك بنجاح.',
    cancelErrorTitle: 'خطأ أثناء الإلغاء',
    cancelErrorDesc: 'تعذر إلغاء الطلب.',
    technicalError: 'خطأ تقني',
    technicalErrorDesc: 'تحقق من اتصالك وحاول مرة أخرى.',
    radarTitle: 'مركز الطلبات',
    radarDesc: 'تحكم في طلباتك، واعرف الطلبات النشطة وأنشئ طلبًا جديدًا عند عدم وجود رحلة.',
    active: 'النشطة',
    accepted: 'المقبولة',
    history: 'السجل',
    cancelled: 'الملغاة',
    expired: 'المنتهية',
    all: 'الكل',
    scanning: 'جارٍ فحص الرادار...',
    noRequests: 'لا توجد طلبات',
    noRequestsDesc: 'أنشئ طلبًا ليتمكن السائقون من العثور عليك.',
    newRequest: 'طلب جديد',
    refresh: 'تحديث',
    activeLabel: 'نشطة',
    acceptedLabel: 'مقبولة',
    closedLabel: 'مغلقة',
    totalLabel: 'المجموع',
    quickActions: 'إجراءات سريعة',
    publishRequest: 'نشر طلب',
    findRide: 'البحث عن رحلة',
    openHint: 'بانتظار السائق',
    acceptedHint: 'سائق مهتم',
    closedHint: 'مكتمل أو مغلق',
    departedHint: 'التاريخ مرّ',
    status: {
      pending: 'قيد الانتظار',
      accepted: 'مقبول',
      confirmed: 'جاهز للتنفيذ',
      on_board: 'في الرحلة',
      completed: 'مكتمل',
      cancelled: 'ملغى',
      rejected: 'مرفوض',
      expired: 'منتهي'
    }
  }
};

const getLanguage = (language) => {
  if (language?.startsWith('ar')) return 'ar';
  if (language?.startsWith('en')) return 'en';
  return 'es';
};

const getLocale = (language) => language === 'es' ? es : enUS;

const isClosedStatus = isClosedActivityStatus;
const isAcceptedStatus = isAcceptedRequestStatus;
const getEffectiveStatus = (request) => getEffectiveRequestStatus(request, {
  graceMinutes: RIDE_EXPIRATION_GRACE_MINUTES,
});

const getLocationName = (location, fallback) => location?.name || location?.address || fallback;
const getRequestPrice = (request) => Number(request?.suggested_price ?? request?.price ?? 0);
const getRequestSeats = (request) => Number(request?.seats_needed ?? request?.seats ?? 1);

const RequestStats = ({ stats, copy }) => {
  const cards = [
    { label: copy.activeLabel, value: stats.active, icon: Megaphone, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { label: copy.acceptedLabel, value: stats.accepted, icon: CheckCircle2, tone: 'bg-blue-50 text-blue-700 border-blue-100' },
    { label: copy.closedLabel, value: stats.closed, icon: XCircle, tone: 'bg-slate-50 text-slate-600 border-slate-100' },
    { label: copy.totalLabel, value: stats.total, icon: Target, tone: 'bg-primary/10 text-primary border-primary/10' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <div key={label} className={cn('rounded-3xl border p-3 text-center shadow-sm', tone)}>
          <Icon className="size-4 mx-auto mb-2 opacity-80" />
          <p className="text-lg font-black leading-none">{value}</p>
          <p className="text-[7px] font-black uppercase tracking-widest mt-1 opacity-70">{label}</p>
        </div>
      ))}
    </div>
  );
};

const QuickActions = ({ copy, navigate, loading, onRefresh }) => (
  <div className="bg-white rounded-3xl p-4 shadow-xl border border-slate-100 space-y-3">
    <div className="flex items-center justify-between px-1">
      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">{copy.quickActions}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onRefresh} className="rounded-2xl h-9 px-3 text-[9px] font-black uppercase tracking-normal text-slate-400 gap-1">
        <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> {copy.refresh}
      </Button>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Button onClick={() => navigate('/request')} className="h-12 rounded-2xl bg-primary text-white font-black uppercase text-[10px] sm:text-xs gap-2 px-2 leading-tight">
        <Plus className="size-4 text-primary shrink-0" /> <span className="truncate">{copy.publishRequest}</span>
      </Button>
      <Button onClick={() => navigate('/dashboard')} variant="outline" className="h-12 rounded-2xl bg-white border-slate-200 text-slate-700 font-black uppercase text-[10px] sm:text-xs gap-2 px-2 leading-tight">
        <Search className="size-4 text-primary shrink-0" /> <span className="truncate">{copy.findRide}
      </span>
      </Button>
    </div>
  </div>
);

const RequestCard = ({ request, onOpen, onCancel, cancellingId, index, copy, language }) => {
  const originName = getLocationName(request.origin, copy.origin);
  const destinationName = getLocationName(request.destination, copy.destination);
  const dateObj = request.departure_time ? new Date(request.departure_time) : null;
  const hasDate = dateObj && !Number.isNaN(dateObj.getTime());
  const depTime = hasDate ? format(dateObj, 'HH:mm', { locale: getLocale(language) }) : '—';
  const dateLabel = hasDate ? format(dateObj, 'dd MMM', { locale: getLocale(language) }) : '—';
  const status = getEffectiveStatus(request);

  const STATUS_CONFIG = {
    pending: { label: copy.status.pending, color: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-500 animate-pulse', hint: copy.openHint, icon: AlertCircle },
    accepted: { label: copy.status.accepted, color: 'bg-blue-50 text-blue-700 border-blue-100', dot: 'bg-blue-500', hint: copy.acceptedHint, icon: CheckCircle2 },
    confirmed: { label: copy.status.confirmed, color: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', hint: copy.acceptedHint, icon: CheckCircle2 },
    on_board: { label: copy.status.on_board, color: 'bg-indigo-50 text-indigo-700 border-indigo-100', dot: 'bg-indigo-500 animate-pulse', hint: copy.acceptedHint, icon: Route },
    completed: { label: copy.status.completed, color: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', hint: copy.closedHint, icon: CheckCircle2 },
    cancelled: { label: copy.status.cancelled, color: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500', hint: copy.closedHint, icon: XCircle },
    rejected: { label: copy.status.rejected, color: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500', hint: copy.closedHint, icon: XCircle },
    expired: { label: copy.status.expired, color: 'bg-orange-50 text-orange-700 border-orange-100', dot: 'bg-orange-500', hint: copy.departedHint, icon: Clock }
  };

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;
  const canCancel = status === 'pending' || status === 'accepted';
  const price = getRequestPrice(request);
  const seats = getRequestSeats(request);

  return (
    <div
      className="group relative overflow-hidden rounded-3xl border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-primary/5 transition-all duration-500 bg-white flex flex-col animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="absolute -right-8 -top-8 size-28 rounded-full bg-primary/5 blur-xl group-hover:scale-125 transition-transform" />

      <div className="p-6 flex items-center justify-between border-b border-slate-50/50 relative z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-slate-950 text-white size-14 rounded-2xl flex flex-col items-center justify-center shadow-xl rotate-3 group-hover:rotate-0 transition-transform duration-500 shrink-0">
            <span className="text-[9px] font-black uppercase opacity-40 leading-none mb-1">{String(dateLabel).split(' ')[1] || '---'}</span>
            <span className="text-2xl font-black italic leading-none">{String(dateLabel).split(' ')[0] || '--'}</span>
          </div>
          <div className="min-w-0">
            <div className={cn('px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-2 border mb-2', config.color)}>
              <div className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
              {config.label}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-3 text-slate-400" />
              <p className="text-xs font-black text-slate-900 uppercase italic tracking-tighter">{depTime}</p>
              <span className="text-[9px] font-bold text-slate-300 truncate">· {config.hint}</span>
            </div>
          </div>
        </div>
        <button onClick={() => onOpen(request.id)} className="size-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-primary group-hover:text-white transition-all duration-500 shrink-0">
          <ArrowUpRight className="size-6" />
        </button>
      </div>

      <div className="p-6 space-y-4 relative bg-gradient-to-b from-white to-slate-50/30">
        <div className="absolute left-[2.05rem] top-10 bottom-10 w-0.5 bg-slate-100" />

        <div className="flex items-center gap-5 relative z-10">
          <div className="size-4 rounded-full bg-emerald-500 ring-8 ring-emerald-50 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{copy.origin}</p>
            <p className="text-sm font-bold text-slate-600 truncate uppercase tracking-tight">{String(originName).split(',')[0]}</p>
          </div>
        </div>

        <div className="flex items-center gap-5 relative z-10">
          <div className="size-4 rounded-full bg-primary ring-8 ring-primary/10 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{copy.destination}</p>
            <p className="text-sm font-black text-slate-900 truncate uppercase tracking-tight italic">{String(destinationName).split(',')[0]}</p>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6 pt-0 grid grid-cols-3 gap-2">
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100">
          <Euro className="size-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{copy.budget}</p>
            <p className="text-xs font-black text-slate-700">{price.toFixed(2)}€</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100">
          <Users className="size-4 text-slate-400 shrink-0" />
          <div>
            <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{copy.seats}</p>
            <p className="text-xs font-black text-slate-700">{seats}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" onClick={() => onOpen(request.id)} className="h-12 px-4 rounded-2xl bg-primary text-white font-black text-[9px] uppercase tracking-normal">
            <StatusIcon className="size-3.5 mr-1" /> {copy.viewRequest}
          </Button>
        </div>
      </div>

      {canCancel && (
        <div className="px-6 pb-6 pt-0">
          <button
            onClick={() => onCancel(request.id)}
            disabled={cancellingId === request.id}
            className="w-full h-12 rounded-2xl bg-red-500/10 text-red-600 text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all disabled:opacity-50"
          >
            {cancellingId === request.id ? copy.cancelling : copy.cancelRequest}
          </button>
        </div>
      )}
    </div>
  );
};

const MyRequests = () => {
  const navigate = useNavigate();
  const { profile } = useOutletContext();
  const { i18n } = useTranslation();
  const language = getLanguage(i18n.language);
  const copy = copyByLanguage[language];
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [cancellingId, setCancellingId] = useState(null);

  const fetchRequests = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      // Persist the same 120-minute expiration rule used by the local filters.
      // This is best effort so an older project without the automation RPC can
      // still render the effective status from departure_time/expires_at.
      const { error: expirationError } = await supabase.rpc(
        'sw_expire_past_ride_requests',
        {
          p_grace_minutes: RIDE_EXPIRATION_GRACE_MINUTES,
          p_limit: 100,
        },
      );
      if (expirationError) console.warn('Request expiration sync skipped:', expirationError);

      const { data, error } = await supabase
        .from('ride_requests')
        .select('*')
        .eq('requester_id', profile.id)
        .order('departure_time', { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRequests(data || []);
    } catch (e) {
      console.error('Error fetching ride requests:', e);
      toast.error(copy.technicalError, { description: copy.technicalErrorDesc });
    } finally {
      setLoading(false);
    }
  }, [profile?.id, copy.technicalError, copy.technicalErrorDesc]);

  useEffect(() => {
    fetchRequests();
    if (!profile?.id) return;
    const channel = supabase
      .channel(`my_requests_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `requester_id=eq.${profile.id}` }, fetchRequests)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchRequests]);

  const enrichedRequests = useMemo(() => (requests || []).map((request) => ({
    ...request,
    effective_status: getEffectiveStatus(request)
  })), [requests]);

  const stats = useMemo(() => {
    const active = enrichedRequests.filter(r => r.effective_status === 'pending').length;
    const accepted = enrichedRequests.filter(r => isAcceptedStatus(r.effective_status)).length;
    const cancelled = enrichedRequests.filter(r => ['cancelled', 'rejected'].includes(r.effective_status)).length;
    const expired = enrichedRequests.filter(r => r.effective_status === 'expired').length;
    const closed = enrichedRequests.filter(r => isClosedStatus(r.effective_status)).length;
    return { active, accepted, cancelled, expired, closed, total: enrichedRequests.length };
  }, [enrichedRequests]);

  const filteredRequests = useMemo(() => {
    switch (activeTab) {
      case 'accepted':
        return enrichedRequests.filter(r => isAcceptedStatus(r.effective_status));
      case 'history':
        return enrichedRequests.filter(r => isClosedStatus(r.effective_status));
      case 'cancelled':
        return enrichedRequests.filter(r => ['cancelled', 'rejected'].includes(r.effective_status));
      case 'expired':
        return enrichedRequests.filter(r => r.effective_status === 'expired');
      case 'active':
        return enrichedRequests.filter(r => r.effective_status === 'pending');
      default:
        return enrichedRequests;
    }
  }, [enrichedRequests, activeTab]);

  const handleOpen = (id) => navigate(`/request/${id}`);

  const handleCancel = async (id) => {
    try {
      setCancellingId(id);
      const { cancelRideRequest } = await import('@/lib/supabaseRPC');
      const result = await cancelRideRequest(id);

      if (result.success) {
        toast.success(copy.cancelledTitle, {
          description: copy.cancelledDesc
        });
        await fetchRequests();
      } else {
        const errorMsg = result.error || copy.cancelErrorDesc;
        toast.error(copy.cancelErrorTitle, { description: errorMsg });
      }
    } catch (e) {
      console.error('Error en cancelación:', e);
      toast.error(copy.technicalError, { description: copy.technicalErrorDesc });
    } finally {
      setCancellingId(null);
    }
  };

  const tabs = [
    { id: 'active', label: copy.active, value: stats.active, icon: Megaphone },
    { id: 'accepted', label: copy.accepted, value: stats.accepted, icon: CheckCircle2 },
    { id: 'history', label: copy.history, value: stats.closed, icon: Filter },
    { id: 'cancelled', label: copy.cancelled, value: stats.cancelled, icon: XCircle },
    { id: 'expired', label: copy.expired, value: stats.expired, icon: Clock },
  ];

  return (
    <div className="bg-slate-50 min-h-screen pb-40 font-sans">
      <SubPageHeader title={copy.title} />

      <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-6">
        <div className="bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] rounded-3xl p-5 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 opacity-10 rotate-12 group-hover:scale-110 transition-transform">
            <Target size={120} className="text-primary" />
          </div>
          <div className="relative z-10 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-white tracking-tighter italic uppercase leading-none">{copy.radarTitle}</h2>
                <p className="text-xs font-medium text-white/50 leading-relaxed italic mt-3">
                  {copy.radarDesc}
                </p>
              </div>
              <Button type="button" size="icon" onClick={fetchRequests} className="rounded-2xl bg-white/10 text-white hover:bg-white/20 shrink-0">
                <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </div>

        <RequestStats stats={stats} copy={copy} />
        <QuickActions copy={copy} navigate={navigate} loading={loading} onRefresh={fetchRequests} />

        <div className="grid grid-cols-5 gap-1 p-2 bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-2xl transition-all duration-300 min-w-0',
                  activeTab === tab.id ? 'bg-slate-950 text-white shadow-xl' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                <span className="flex items-center gap-1 min-w-0">
                  <Icon className={cn('size-3.5 shrink-0', activeTab === tab.id ? 'text-primary' : 'text-slate-300')} />
                  <span className={cn('text-[8px] px-1.5 py-0.5 rounded-full shrink-0', activeTab === tab.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-400')}>{tab.value}</span>
                </span>
                <span className="text-[9px] font-black uppercase leading-tight text-center w-full truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="animate-spin text-primary size-8" />
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{copy.scanning}</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200 animate-in fade-in duration-700 px-8">
              <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Calendar className="h-10 w-10 text-slate-200" />
              </div>
              <h3 className="text-sm font-black text-slate-900 uppercase italic mb-2">{copy.noRequests}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">{copy.noRequestsDesc}</p>
              <Button
                onClick={() => navigate('/request')}
                className="mt-8 rounded-2xl bg-primary font-black text-[10px] uppercase h-12 px-8 shadow-lg shadow-primary/20 gap-2"
              >
                <Plus className="size-4" /> {copy.newRequest}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredRequests.map((req, idx) => (
                <RequestCard
                  key={req.id}
                  request={req}
                  onOpen={handleOpen}
                  onCancel={handleCancel}
                  cancellingId={cancellingId}
                  index={idx}
                  copy={copy}
                  language={language}
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
          Radar Engine v4.0 • ShareWay
        </p>
      </main>
    </div>
  );
};

export default MyRequests;
