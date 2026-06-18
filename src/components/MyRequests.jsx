import { useEffect, useMemo, useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, Calendar, Clock, ArrowUpRight, Zap, Target } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
  es: {
    title: 'Solicitudes',
    origin: 'Origen',
    destination: 'Destino',
    budget: 'Presupuesto',
    seats: 'Plazas',
    cancelling: 'CANCELANDO...',
    cancelRequest: 'CANCELAR SOLICITUD',
    cancelledTitle: 'Solicitud cancelada',
    cancelledDesc: 'Tu petición ha sido eliminada correctamente.',
    cancelErrorTitle: 'Error al cancelar',
    cancelErrorDesc: 'No se pudo cancelar la solicitud.',
    technicalError: 'Error técnico',
    technicalErrorDesc: 'Revisa tu conexión e inténtalo de nuevo.',
    radarTitle: 'Radar Activo',
    radarDesc: 'Aquí gestionas tus peticiones de viaje. Cuando un conductor te acepte, recibirás una notificación instantánea.',
    all: 'TODAS',
    expired: 'EXPIRADAS',
    scanning: 'Escaneando radar...',
    noRequests: 'Sin solicitudes',
    noRequestsDesc: 'Lanza una petición al sistema',
    newRequest: 'Nueva Petición',
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
    budget: 'Budget',
    seats: 'Seats',
    cancelling: 'CANCELLING...',
    cancelRequest: 'CANCEL REQUEST',
    cancelledTitle: 'Request cancelled',
    cancelledDesc: 'Your request has been deleted successfully.',
    cancelErrorTitle: 'Cancellation error',
    cancelErrorDesc: 'Could not cancel the request.',
    technicalError: 'Technical error',
    technicalErrorDesc: 'Check your connection and try again.',
    radarTitle: 'Active Radar',
    radarDesc: 'Manage your ride requests here. When a driver accepts you, you will receive an instant notification.',
    all: 'ALL',
    expired: 'EXPIRED',
    scanning: 'Scanning radar...',
    noRequests: 'No requests',
    noRequestsDesc: 'Send a request to the system',
    newRequest: 'New Request',
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
    budget: 'الميزانية',
    seats: 'المقاعد',
    cancelling: 'جارٍ الإلغاء...',
    cancelRequest: 'إلغاء الطلب',
    cancelledTitle: 'تم إلغاء الطلب',
    cancelledDesc: 'تم حذف طلبك بنجاح.',
    cancelErrorTitle: 'خطأ أثناء الإلغاء',
    cancelErrorDesc: 'تعذر إلغاء الطلب.',
    technicalError: 'خطأ تقني',
    technicalErrorDesc: 'تحقق من اتصالك وحاول مرة أخرى.',
    radarTitle: 'الرادار نشط',
    radarDesc: 'هنا تدير طلبات رحلاتك. عندما يقبلك سائق، ستصلك إشعار فوري.',
    all: 'الكل',
    expired: 'المنتهية',
    scanning: 'جارٍ فحص الرادار...',
    noRequests: 'لا توجد طلبات',
    noRequestsDesc: 'أنشئ طلب رحلة جديد',
    newRequest: 'طلب جديد',
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

const RequestCard = ({ request, onOpen, onCancel, cancellingId, index, copy }) => {
  const originName = request.origin?.name || request.origin?.address || copy.origin;
  const destinationName = request.destination?.name || request.destination?.address || copy.destination;
  const depTime = request.departure_time ? format(new Date(request.departure_time), 'HH:mm', { locale: es }) : '—';
  const dateLabel = request.departure_time ? format(new Date(request.departure_time), 'dd MMM', { locale: es }) : '—';
  const status = request.status;

  const STATUS_CONFIG = {
    pending: { label: copy.status.pending, color: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
    accepted: { label: copy.status.accepted, color: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500' },
    confirmed: { label: copy.status.confirmed, color: 'bg-blue-50 text-blue-600 border-blue-100', dot: 'bg-blue-500' },
    on_board: { label: copy.status.on_board, color: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500' },
    completed: { label: copy.status.completed, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500' },
    cancelled: { label: copy.status.cancelled, color: 'bg-red-50 text-red-400 border-red-100', dot: 'bg-red-400' },
    rejected: { label: copy.status.rejected, color: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500' },
    expired: { label: copy.status.expired, color: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500' }
  };

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <div
      className="group relative overflow-hidden rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-primary/5 transition-all duration-500 bg-white flex flex-col animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="p-8 flex items-center justify-between border-b border-slate-50/50">
        <div className="flex items-center gap-5">
          <div className="bg-slate-950 text-white size-14 rounded-[1.5rem] flex flex-col items-center justify-center shadow-xl rotate-3 group-hover:rotate-0 transition-transform duration-500">
            <span className="text-[9px] font-black uppercase opacity-40 leading-none mb-1">{dateLabel.split(' ')[1]}</span>
            <span className="text-2xl font-black italic leading-none">{dateLabel.split(' ')[0]}</span>
          </div>
          <div>
            <div className={cn('px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-2 border mb-2', config.color)}>
              <div className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
              {config.label}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-3 text-slate-400" />
              <p className="text-xs font-black text-slate-900 uppercase italic tracking-tighter">{depTime}</p>
            </div>
          </div>
        </div>
        <button onClick={() => onOpen(request.id)} className="size-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-primary group-hover:text-white transition-all duration-500">
          <ArrowUpRight className="size-6" />
        </button>
      </div>

      <div className="p-8 space-y-4 relative bg-gradient-to-b from-white to-slate-50/30">
        <div className="absolute left-[2.45rem] top-12 bottom-12 w-0.5 bg-slate-100" />

        <div className="flex items-center gap-6 relative z-10">
          <div className="size-4 rounded-full bg-emerald-500 ring-8 ring-emerald-50 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{copy.origin}</p>
            <p className="text-sm font-bold text-slate-600 truncate uppercase tracking-tight">{originName.split(',')[0]}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 relative z-10">
          <div className="size-4 rounded-full bg-primary ring-8 ring-primary/10 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{copy.destination}</p>
            <p className="text-sm font-black text-slate-900 truncate uppercase tracking-tight italic">{destinationName.split(',')[0]}</p>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8 pt-0 flex gap-3">
        <div className="flex-1 flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <Target className="size-4 text-slate-400" />
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{copy.budget}</p>
            <p className="text-xs font-black text-slate-700">{request.suggested_price}€</p>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <Zap className="size-4 text-slate-400" />
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{copy.seats}</p>
            <p className="text-xs font-black text-slate-700">{request.seats_needed}</p>
          </div>
        </div>
      </div>

      {(status === 'pending' || status === 'accepted') && (
        <div className="px-8 pb-8 pt-0">
          <button
            onClick={() => onCancel(request.id)}
            disabled={cancellingId === request.id}
            className="w-full h-12 rounded-xl bg-red-500/10 text-red-600 text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all disabled:opacity-50"
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
  const copy = copyByLanguage[getLanguage(i18n.language)];
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('todos');

  const fetchRequests = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ride_requests')
        .select('*')
        .eq('requester_id', profile.id)
        .order('departure_time', { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    } catch (e) {
      console.error('Error fetching ride requests:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchRequests();
    if (!profile?.id) return;
    const channel = supabase
      .channel(`my_requests_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `requester_id=eq.${profile.id}` }, fetchRequests)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchRequests]);

  const filteredRequests = useMemo(() => {
    switch (activeTab) {
      case 'expiradas':
        return requests.filter(r => ['expired', 'cancelled', 'rejected'].includes(r.status));
      default:
        return requests.filter(r => !['expired', 'cancelled', 'rejected'].includes(r.status));
    }
  }, [requests, activeTab]);

  const handleOpen = (id) => navigate(`/request/${id}`);
  const [cancellingId, setCancellingId] = useState(null);
  const handleCancel = async (id) => {
    try {
      setCancellingId(id);
      const { cancelRideRequest } = await import('@/lib/supabaseRPC');
      const result = await cancelRideRequest(id);

      if (result.success) {
        toast.success(copy.cancelledTitle, {
          description: copy.cancelledDesc
        });
        setRequests(prev => prev.filter(req => req.id !== id));
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

  return (
    <div className="bg-slate-50 min-h-screen pb-40 font-sans">
      <SubPageHeader title={copy.title} />

      <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-8">
        <div className="bg-slate-900 rounded-[3rem] p-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 opacity-10 rotate-12 group-hover:scale-110 transition-transform">
            <Target size={120} className="text-primary" />
          </div>
          <div className="relative z-10 space-y-4">
            <h2 className="text-2xl font-black text-white tracking-tighter italic uppercase leading-none">{copy.radarTitle}</h2>
            <p className="text-xs font-medium text-white/50 leading-relaxed italic">
              {copy.radarDesc}
            </p>
          </div>
        </div>

        <div className="flex p-2 bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
          {['todos', 'expiradas'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 h-14 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all duration-500 relative overflow-hidden group',
                activeTab === tab ? 'bg-slate-950 text-white shadow-2xl scale-[1.02]' : 'text-slate-400 hover:text-slate-600'
              )}
            >
              <span className="relative z-10">{tab === 'todos' ? copy.all : copy.expired}</span>
              {activeTab === tab && (
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900 to-slate-800 animate-pulse opacity-50" />
              )}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="animate-spin text-primary size-8" />
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{copy.scanning}</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-24 bg-white rounded-[3rem] border border-dashed border-slate-200 animate-in fade-in duration-700">
              <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Calendar className="h-10 w-10 text-slate-200" />
              </div>
              <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">{copy.noRequests}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{copy.noRequestsDesc}</p>
              <Button
                onClick={() => navigate('/create-request')}
                className="mt-8 rounded-2xl bg-primary font-black text-[10px] uppercase h-12 px-8 shadow-lg shadow-primary/20"
              >
                {copy.newRequest}
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
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
          Radar Engine v3.0 • ShareWay
        </p>
      </main>
    </div>
  );
};

export default MyRequests;
