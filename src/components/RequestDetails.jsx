import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { fulfillRequest } from '@/services/rideService';
import { getOrCreateChat } from '@/lib/supabaseRPC';
import { extractChatId, getRequestChatPath, getRequestChatPeerId } from '@/lib/requestChat';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar.jsx';
import MapComponent from './MapComponent';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SubPageHeader from './SubPageHeader';
import {
    Calendar, Users, Loader2, MessageCircle, Phone,
    MapPin, Share2, Star, BadgeCheck, Euro,
    CheckCircle, ShieldCheck, ChevronRight, ArrowLeft,
    RefreshCw, XCircle, Car, Clock, WalletCards, AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const copyByLanguage = {
    es: {
        user: 'Usuario',
        loadError: 'No se pudo cargar la solicitud',
        alreadyAccepted: 'Esta solicitud ya ha sido aceptada por otro conductor.',
        noPhone: 'El pasajero no ha facilitado su teléfono',
        invalidPrice: 'Precio no válido',
        minSeats: 'Debes ofrecer al menos {{seats}} plazas.',
        creatingRide: 'Creando viaje y aceptando pasajero...',
        accepted: '¡Solicitud aceptada!',
        pageTitle: 'Detalle de Solicitud',
        activeRequest: 'Solicitud activa',
        budget: 'Presupuesto',
        call: 'Llamar',
        passengerElite: 'Pasajero Élite',
        viewProfile: 'Ver Perfil',
        requestedSeats: 'Plazas Pedidas',
        person: 'persona',
        people: 'personas',
        insurance: 'Seguro',
        included: 'Incluido',
        pickup: 'Recogida',
        destination: 'Destino',
        acceptAndCreate: 'Aceptar y crear viaje',
        ownRequest: 'Esta es tu propia solicitud',
        acceptPassenger: '¿Aceptar pasajero?',
        acceptDescription: 'Confirmarás tu compromiso de recoger a {{name}}.',
        finalPrice: 'Precio final acordado (€)',
        totalCapacity: 'Tu Capacidad Total (Asientos)',
        includingSeats: 'Incluyendo las {{seats}} plazas del pasajero',
        confirmJoin: 'Confirmar incorporación',
        locale: 'es-ES',
        statusTitle: 'Estado de la solicitud',
        statusDesc: 'Revisa qué puedes hacer ahora con esta petición.',
        pending: 'Pendiente',
        acceptedStatus: 'Aceptada',
        fulfilled: 'Convertida en viaje',
        confirmed: 'Confirmada',
        completed: 'Finalizada',
        cancelled: 'Cancelada',
        rejected: 'Rechazada',
        expired: 'Expirada',
        openMyRequests: 'Mis solicitudes',
        backToSearch: 'Buscar viaje',
        refresh: 'Actualizar',
        viewRide: 'Ver viaje asociado',
        cancelRequest: 'Cancelar solicitud',
        cancelling: 'Cancelando...',
        cancelConfirm: '¿Cancelar esta solicitud?',
        cancelConfirmDesc: 'La solicitud dejará de aparecer como activa para conductores.',
        keepRequest: 'Mantener',
        confirmCancel: 'Sí, cancelar',
        cancelledOk: 'Solicitud cancelada',
        cancelledOkDesc: 'Se ha actualizado el estado de la solicitud.',
        cancelledError: 'No se pudo cancelar',
        waitingDriver: 'Aún estás esperando que un conductor acepte esta solicitud.',
        driverCanAccept: 'Puedes aceptar esta solicitud y crear un viaje para el pasajero.',
        closedRequest: 'Esta solicitud ya no admite cambios rápidos.',
        acceptedHint: 'La solicitud ya tiene actividad asociada. Revisa el viaje o espera confirmación.',
        tripData: 'Datos del trayecto',
        quickActions: 'Acciones rápidas',
        seatsShort: 'Plazas',
        departure: 'Salida',
        priceProtected: 'Importe protegido',
        routePreview: 'Vista de ruta',
        shareUnavailable: 'No se pudo compartir esta solicitud',
        shareTitle: 'Solicitud ShareWay',
        shareText: 'Mira esta solicitud de viaje en ShareWay',
        chat: 'Chat',
        chatError: 'No se pudo abrir la conversación',
        chatUnavailable: 'Aún no hay un conductor con quien chatear'
    },
    en: {
        user: 'User',
        loadError: 'Could not load the request',
        alreadyAccepted: 'This request has already been accepted by another driver.',
        noPhone: 'The passenger has not provided a phone number',
        invalidPrice: 'Invalid price',
        minSeats: 'You must offer at least {{seats}} seats.',
        creatingRide: 'Creating ride and accepting passenger...',
        accepted: 'Request accepted!',
        pageTitle: 'Request Details',
        activeRequest: 'Active request',
        budget: 'Budget',
        call: 'Call',
        passengerElite: 'Elite Passenger',
        viewProfile: 'View Profile',
        requestedSeats: 'Requested Seats',
        person: 'person',
        people: 'people',
        insurance: 'Insurance',
        included: 'Included',
        pickup: 'Pickup',
        destination: 'Destination',
        acceptAndCreate: 'Accept and create ride',
        ownRequest: 'This is your own request',
        acceptPassenger: 'Accept passenger?',
        acceptDescription: 'You will confirm your commitment to pick up {{name}}.',
        finalPrice: 'Final agreed price (€)',
        totalCapacity: 'Your Total Capacity (Seats)',
        includingSeats: 'Including the passenger’s {{seats}} requested seats',
        confirmJoin: 'Confirm passenger',
        locale: 'en-US',
        statusTitle: 'Request status',
        statusDesc: 'Check what you can do with this request now.',
        pending: 'Pending',
        acceptedStatus: 'Accepted',
        fulfilled: 'Converted to ride',
        confirmed: 'Confirmed',
        completed: 'Completed',
        cancelled: 'Cancelled',
        rejected: 'Rejected',
        expired: 'Expired',
        openMyRequests: 'My requests',
        backToSearch: 'Find a ride',
        refresh: 'Refresh',
        viewRide: 'View linked ride',
        cancelRequest: 'Cancel request',
        cancelling: 'Cancelling...',
        cancelConfirm: 'Cancel this request?',
        cancelConfirmDesc: 'This request will stop appearing as active for drivers.',
        keepRequest: 'Keep it',
        confirmCancel: 'Yes, cancel',
        cancelledOk: 'Request cancelled',
        cancelledOkDesc: 'The request status has been updated.',
        cancelledError: 'Could not cancel',
        waitingDriver: 'You are still waiting for a driver to accept this request.',
        driverCanAccept: 'You can accept this request and create a ride for the passenger.',
        closedRequest: 'This request no longer supports quick changes.',
        acceptedHint: 'This request already has linked activity. Check the ride or wait for confirmation.',
        tripData: 'Trip data',
        quickActions: 'Quick actions',
        seatsShort: 'Seats',
        departure: 'Departure',
        priceProtected: 'Protected amount',
        routePreview: 'Route preview',
        shareUnavailable: 'Could not share this request',
        shareTitle: 'ShareWay request',
        shareText: 'Check this ride request on ShareWay',
        chat: 'Chat',
        chatError: 'Could not open the conversation',
        chatUnavailable: 'There is no driver to chat with yet'
    },
    ar: {
        user: 'مستخدم',
        loadError: 'تعذر تحميل الطلب',
        alreadyAccepted: 'تم قبول هذا الطلب بالفعل من طرف سائق آخر.',
        noPhone: 'لم يضف الراكب رقم هاتفه',
        invalidPrice: 'السعر غير صالح',
        minSeats: 'يجب أن توفر على الأقل {{seats}} مقاعد.',
        creatingRide: 'جارٍ إنشاء الرحلة وقبول الراكب...',
        accepted: 'تم قبول الطلب!',
        pageTitle: 'تفاصيل الطلب',
        activeRequest: 'طلب نشط',
        budget: 'الميزانية',
        call: 'اتصال',
        passengerElite: 'راكب مميز',
        viewProfile: 'عرض الملف',
        requestedSeats: 'المقاعد المطلوبة',
        person: 'شخص',
        people: 'أشخاص',
        insurance: 'التأمين',
        included: 'مشمول',
        pickup: 'نقطة الاستلام',
        destination: 'الوجهة',
        acceptAndCreate: 'قبول وإنشاء رحلة',
        ownRequest: 'هذا هو طلبك الخاص',
        acceptPassenger: 'قبول الراكب؟',
        acceptDescription: 'ستؤكد التزامك باستلام {{name}}.',
        finalPrice: 'السعر النهائي المتفق عليه (€)',
        totalCapacity: 'السعة الإجمالية لديك (مقاعد)',
        includingSeats: 'بما في ذلك {{seats}} من مقاعد الراكب',
        confirmJoin: 'تأكيد الإضافة',
        locale: 'ar-SA',
        statusTitle: 'حالة الطلب',
        statusDesc: 'راجع ما يمكنك فعله الآن مع هذا الطلب.',
        pending: 'قيد الانتظار',
        acceptedStatus: 'مقبول',
        fulfilled: 'تحول إلى رحلة',
        confirmed: 'مؤكد',
        completed: 'مكتمل',
        cancelled: 'ملغى',
        rejected: 'مرفوض',
        expired: 'منتهي',
        openMyRequests: 'طلباتي',
        backToSearch: 'البحث عن رحلة',
        refresh: 'تحديث',
        viewRide: 'عرض الرحلة المرتبطة',
        cancelRequest: 'إلغاء الطلب',
        cancelling: 'جارٍ الإلغاء...',
        cancelConfirm: 'إلغاء هذا الطلب؟',
        cancelConfirmDesc: 'لن يظهر هذا الطلب كنشط للسائقين.',
        keepRequest: 'إبقاء الطلب',
        confirmCancel: 'نعم، إلغاء',
        cancelledOk: 'تم إلغاء الطلب',
        cancelledOkDesc: 'تم تحديث حالة الطلب.',
        cancelledError: 'تعذر الإلغاء',
        waitingDriver: 'ما زلت تنتظر قبول سائق لهذا الطلب.',
        driverCanAccept: 'يمكنك قبول هذا الطلب وإنشاء رحلة للراكب.',
        closedRequest: 'هذا الطلب لم يعد يقبل تغييرات سريعة.',
        acceptedHint: 'هذا الطلب لديه نشاط مرتبط. راجع الرحلة أو انتظر التأكيد.',
        tripData: 'بيانات الرحلة',
        quickActions: 'إجراءات سريعة',
        seatsShort: 'مقاعد',
        departure: 'المغادرة',
        priceProtected: 'المبلغ محمي',
        routePreview: 'معاينة المسار',
        shareUnavailable: 'تعذر مشاركة هذا الطلب',
        shareTitle: 'طلب ShareWay',
        shareText: 'شاهد طلب الرحلة هذا على ShareWay',
        chat: 'الدردشة',
        chatError: 'تعذر فتح المحادثة',
        chatUnavailable: 'لا يوجد سائق للدردشة معه بعد'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const interpolate = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);

const formatRequestDate = (date, copy) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    return new Intl.DateTimeFormat(copy.locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    }).format(value);
};

const formatRequestTime = (date, copy) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return '--:--';
    return new Intl.DateTimeFormat(copy.locale, {
        hour: '2-digit',
        minute: '2-digit'
    }).format(value);
};

const getLocationLabel = (location, fallback = '') => location?.name || location?.address || location?.formatted_address || fallback;
const getRequestedSeats = (request) => Number(request?.requested_seats ?? request?.seats_needed ?? request?.seats ?? 1);
const getLinkedRideId = (request) => request?.ride_id || request?.matched_ride_id || request?.accepted_ride_id || null;

const getEffectiveStatus = (request) => {
    if (!request) return 'pending';
    const raw = request.status || 'pending';
    if (['cancelled', 'rejected', 'expired', 'completed', 'fulfilled', 'confirmed', 'accepted', 'on_board'].includes(raw)) return raw;
    const departure = request.departure_time ? new Date(request.departure_time) : null;
    if (departure && !Number.isNaN(departure.getTime()) && departure < new Date()) return 'expired';
    return raw;
};

const getStatusConfig = (status, copy) => {
    const map = {
        pending: { label: copy.pending, icon: Clock, className: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-500', hint: copy.waitingDriver },
        accepted: { label: copy.acceptedStatus, icon: CheckCircle, className: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', hint: copy.acceptedHint },
        fulfilled: { label: copy.fulfilled, icon: Car, className: 'bg-blue-50 text-blue-700 border-blue-100', dot: 'bg-blue-500', hint: copy.acceptedHint },
        confirmed: { label: copy.confirmed, icon: CheckCircle, className: 'bg-blue-50 text-blue-700 border-blue-100', dot: 'bg-blue-500', hint: copy.acceptedHint },
        on_board: { label: copy.acceptedStatus, icon: Car, className: 'bg-indigo-50 text-indigo-700 border-indigo-100', dot: 'bg-indigo-500', hint: copy.acceptedHint },
        completed: { label: copy.completed, icon: CheckCircle, className: 'bg-slate-50 text-slate-600 border-slate-100', dot: 'bg-slate-400', hint: copy.closedRequest },
        cancelled: { label: copy.cancelled, icon: XCircle, className: 'bg-red-50 text-red-700 border-red-100', dot: 'bg-red-500', hint: copy.closedRequest },
        rejected: { label: copy.rejected, icon: XCircle, className: 'bg-red-50 text-red-700 border-red-100', dot: 'bg-red-500', hint: copy.closedRequest },
        expired: { label: copy.expired, icon: AlertTriangle, className: 'bg-orange-50 text-orange-700 border-orange-100', dot: 'bg-orange-500', hint: copy.closedRequest }
    };
    return map[status] || map.pending;
};

const StatCard = ({ icon: Icon, label, value }) => (
    <div className="rounded-3xl bg-slate-50 border border-slate-100 p-4 flex items-center gap-3">
        <div className="size-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-primary shrink-0">
            <Icon size={17} />
        </div>
        <div className="min-w-0 text-left">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 truncate">{label}</p>
            <p className="text-sm font-black text-slate-900 truncate mt-0.5">{value}</p>
        </div>
    </div>
);

const RequestDetails = () => {
    const { id: requestId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];

    const [request, setRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showAcceptDialog, setShowAcceptDialog] = useState(false);
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [price, setPrice] = useState('');
    const [totalSeats, setTotalSeats] = useState('4');
    const [isOpeningChat, setIsOpeningChat] = useState(false);

    const fetchRequestDetails = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id (*)')
                .eq('id', requestId)
                .single();

            if (error) throw error;

            setRequest({
                ...data,
                dateTime: data.departure_time ? new Date(data.departure_time) : new Date(),
                requester: {
                    ...data.requester,
                    photoURL: data.requester?.photo_url,
                    displayName: data.requester?.full_name || data.requester?.display_name || copy.user,
                    rating: data.requester?.rating || 5.0,
                    phone: data.requester?.phone
                }
            });
            setPrice(String(data.suggested_price || data.price || ''));
        } catch (error) {
            console.error('Request details load error:', error);
            toast.error(copy.loadError);
            navigate('/my-requests');
        } finally {
            setLoading(false);
        }
    }, [requestId, navigate, copy.loadError, copy.user]);

    useEffect(() => {
        if (!requestId) return;
        fetchRequestDetails();

        const channel = supabase
            .channel(`request_updates_${requestId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'ride_requests',
                filter: `id=eq.${requestId}`
            }, () => fetchRequestDetails())
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [requestId, fetchRequestDetails]);

    const handleCallRequester = () => {
        if (request?.requester?.phone) {
            window.location.href = `tel:${request.requester.phone}`;
        } else {
            toast.error(copy.noPhone);
        }
    };

    const handleShare = async () => {
        const url = `${window.location.origin}/request/${requestId}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: copy.shareTitle, text: copy.shareText, url });
            } else {
                await navigator.clipboard.writeText(url);
                toast.success(copy.shareTitle);
            }
        } catch (error) {
            if (error?.name !== 'AbortError') toast.error(copy.shareUnavailable);
        }
    };

    const handleOpenChat = async () => {
        const isMyRequest = user?.id === request?.requester_id;
        const peerId = getRequestChatPeerId({
            isMyRequest,
            requesterId: request?.requester_id,
            driverId: request?.driver_id || request?.accepted_driver_id,
        });

        if (!peerId || peerId === String(user?.id || '')) {
            toast.error(copy.chatUnavailable);
            return;
        }

        setIsOpeningChat(true);
        try {
            const linkedRideId = getLinkedRideId(request);
            const { data, success, error } = await getOrCreateChat(peerId, linkedRideId);
            if (!success) throw new Error(error || copy.chatError);
            const chatId = extractChatId(data);
            const path = getRequestChatPath({ linkedRideId, chatId });
            if (!path) throw new Error(copy.chatError);
            navigate(path);
        } catch (error) {
            toast.error(copy.chatError, { description: error.message });
        } finally {
            setIsOpeningChat(false);
        }
    };

    const handleCancelRequest = async () => {
        setIsCancelling(true);
        try {
            const { cancelRideRequest } = await import('@/lib/supabaseRPC');
            const result = await cancelRideRequest(requestId);
            if (!result?.success) throw new Error(result?.error || copy.cancelledError);
            toast.success(copy.cancelledOk, { description: copy.cancelledOkDesc });
            setShowCancelDialog(false);
            await fetchRequestDetails();
        } catch (error) {
            toast.error(copy.cancelledError, { description: error.message });
        } finally {
            setIsCancelling(false);
        }
    };

    const handleConfirmAcceptance = async () => {
        const numericPrice = Number(price.replace(',', '.'));
        if (isNaN(numericPrice) || numericPrice <= 0) return toast.error(copy.invalidPrice);

        const numericSeats = parseInt(totalSeats);
        const requestedSeats = getRequestedSeats(request);
        if (isNaN(numericSeats) || numericSeats < requestedSeats) {
            return toast.error(interpolate(copy.minSeats, { seats: requestedSeats }));
        }

        setIsSubmitting(true);
        const toastId = toast.loading(copy.creatingRide);
        try {
            await fulfillRequest(request, numericPrice, numericSeats);
            toast.success(copy.accepted, { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            toast.error(error.message, { id: toastId });
        } finally {
            setIsSubmitting(false);
            setShowAcceptDialog(false);
        }
    };

    const computed = useMemo(() => {
        const status = getEffectiveStatus(request);
        return {
            status,
            statusConfig: getStatusConfig(status, copy),
            isMyRequest: user?.id === request?.requester_id,
            requestedSeats: getRequestedSeats(request),
            linkedRideId: getLinkedRideId(request),
            canCancel: user?.id === request?.requester_id && ['pending', 'accepted'].includes(status),
            canAccept: user?.id !== request?.requester_id && status === 'pending',
            canViewRide: Boolean(getLinkedRideId(request)),
            canChat: Boolean(getRequestChatPeerId({
                isMyRequest: user?.id === request?.requester_id,
                requesterId: request?.requester_id,
                driverId: request?.driver_id || request?.accepted_driver_id,
            }))
        };
    }, [request, user?.id, copy]);

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!request) return null;

    const StatusIcon = computed.statusConfig.icon;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title={copy.pageTitle} backPath="/my-requests" />

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-900 text-white p-6 space-y-5 overflow-hidden relative">
                    <div className="absolute -right-10 -top-10 size-36 rounded-full bg-primary/20 blur-2xl" />
                    <div className="relative flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                            <div className="size-12 rounded-2xl bg-white/10 text-primary flex items-center justify-center shrink-0">
                                <StatusIcon size={23} />
                            </div>
                            <div className="min-w-0 text-left">
                                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">{copy.statusTitle}</p>
                                <h1 className="text-3xl font-black italic uppercase tracking-tighter leading-none mt-1">{computed.statusConfig.label}</h1>
                                <p className="text-xs font-bold text-white/55 mt-2 leading-relaxed">{computed.canAccept ? copy.driverCanAccept : computed.statusConfig.hint}</p>
                            </div>
                        </div>
                        <Button type="button" onClick={fetchRequestDetails} variant="ghost" className="h-11 rounded-2xl bg-white/10 hover:bg-white/20 text-white px-3 gap-2 shrink-0">
                            <RefreshCw size={14} />
                            <span className="hidden sm:inline text-[9px] font-black uppercase tracking-widest">{copy.refresh}</span>
                        </Button>
                    </div>

                    <div className="relative grid grid-cols-3 gap-2">
                        <StatCard icon={Calendar} label={copy.departure} value={`${formatRequestDate(request.dateTime, copy)} · ${formatRequestTime(request.dateTime, copy)}`} />
                        <StatCard icon={Users} label={copy.seatsShort} value={`${computed.requestedSeats} ${computed.requestedSeats === 1 ? copy.person : copy.people}`} />
                        <StatCard icon={WalletCards} label={copy.budget} value={`${request.suggested_price || request.price || 0}€`} />
                    </div>
                </Card>

                <div className="h-64 w-full rounded-[2.5rem] overflow-hidden shadow-xl relative border-4 border-white">
                    <MapComponent center={request.origin} itemsToDisplay={[{ ...request, type: 'request' }]} zoom={13} />
                    <div className={cn('absolute top-4 left-4 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg border', computed.statusConfig.className)}>
                        <span className={cn('inline-block size-1.5 rounded-full mr-2', computed.statusConfig.dot)} />
                        {copy.routePreview}
                    </div>
                </div>

                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 space-y-6">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-[2rem]">
                        <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="size-14 rounded-2xl border-2 border-white shadow-md shrink-0">
                                <AvatarImage src={request.requester.photoURL} />
                                <AvatarFallback className="font-black bg-indigo-100 text-indigo-600">{request.requester.displayName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="text-left min-w-0">
                                <h4 className="font-black text-slate-900 uppercase italic tracking-tighter leading-none flex items-center gap-1.5 truncate">
                                    {request.requester.displayName} <BadgeCheck size={14} className="text-blue-500 shrink-0" />
                                </h4>
                                <div className="flex items-center gap-1 mt-1">
                                    <Star size={10} className="text-amber-400 fill-amber-400" />
                                    <span className="text-[10px] font-bold text-slate-500">{request.requester.rating} · {copy.passengerElite}</span>
                                </div>
                            </div>
                        </div>
                        <Link to={`/profile/${request.requester_id}`} className="text-primary text-[10px] font-black uppercase tracking-widest shrink-0">{copy.viewProfile}</Link>
                    </div>

                    <div className="rounded-[2rem] bg-slate-50 border border-slate-100 p-5 space-y-4 text-left">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{copy.tripData}</p>
                        <div className="flex gap-4">
                            <div className="flex flex-col items-center pt-1">
                                <div className="size-3 rounded-full border-2 border-primary bg-white" />
                                <div className="w-0.5 h-12 bg-slate-200 my-1" />
                                <MapPin size={14} className="text-emerald-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[8px] font-black text-slate-400 uppercase">{copy.pickup}</p>
                                <p className="text-sm font-bold text-slate-900 leading-tight truncate">{getLocationLabel(request.origin, copy.pickup)}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase mt-4">{copy.destination}</p>
                                <p className="text-sm font-black text-slate-900 leading-tight truncate italic">{getLocationLabel(request.destination, copy.destination)}</p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <Users size={12} /> {copy.requestedSeats}
                            </p>
                            <p className="text-sm font-bold text-slate-700 mt-1">
                                {computed.requestedSeats} {computed.requestedSeats === 1 ? copy.person : copy.people}
                            </p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <ShieldCheck size={12} /> {copy.priceProtected}
                            </p>
                            <p className="text-sm font-bold text-slate-700 mt-1">{copy.included}</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{copy.quickActions}</p>
                        <div className={cn(
                            'grid gap-2',
                            computed.isMyRequest
                                ? (computed.canChat ? 'grid-cols-2' : 'grid-cols-1')
                                : (computed.canChat ? 'grid-cols-3' : 'grid-cols-2')
                        )}>
                            {!computed.isMyRequest && (
                                <Button onClick={handleCallRequester} className="h-12 rounded-2xl bg-emerald-50 text-emerald-600 border-none hover:bg-emerald-100 font-black text-[10px] uppercase tracking-widest">
                                    <Phone size={16} className="mr-1" /> {copy.call}
                                </Button>
                            )}
                            {computed.canChat && (
                                <Button
                                    onClick={handleOpenChat}
                                    disabled={isOpeningChat}
                                    className="h-12 rounded-2xl bg-orange-50 text-orange-600 border-none hover:bg-orange-100 font-black text-[10px] uppercase tracking-widest"
                                >
                                    {isOpeningChat ? <Loader2 size={16} className="mr-1 animate-spin" /> : <MessageCircle size={16} className="mr-1" />}
                                    {copy.chat}
                                </Button>
                            )}
                            <Button type="button" onClick={handleShare} className="h-12 rounded-2xl bg-slate-50 text-slate-500 p-0 border-none hover:bg-slate-100">
                                <Share2 size={18} />
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Button type="button" variant="outline" onClick={() => navigate('/my-requests')} className="h-12 rounded-2xl border-slate-100 bg-white font-black text-[10px] uppercase tracking-widest gap-2">
                                <ArrowLeft size={15} /> {copy.openMyRequests}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => navigate('/dashboard')} className="h-12 rounded-2xl border-slate-100 bg-white font-black text-[10px] uppercase tracking-widest gap-2">
                                <Car size={15} /> {copy.backToSearch}
                            </Button>
                        </div>

                        {computed.canViewRide && (
                            <Button type="button" onClick={() => navigate(`/ride/${computed.linkedRideId}`)} className="w-full h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] gap-2">
                                <Car size={17} /> {copy.viewRide}
                            </Button>
                        )}

                        {computed.canAccept && (
                            <Button
                                onClick={() => setShowAcceptDialog(true)}
                                className="w-full h-16 rounded-[2rem] bg-slate-900 text-white font-black text-base italic shadow-2xl uppercase active:scale-95 transition-all border-none"
                            >
                                {copy.acceptAndCreate} <ChevronRight size={20} className="ml-2 text-primary" />
                            </Button>
                        )}

                        {computed.canCancel && (
                            <Button type="button" onClick={() => setShowCancelDialog(true)} variant="outline" className="w-full h-12 rounded-2xl border-red-100 bg-red-50 text-red-600 font-black uppercase tracking-widest text-[10px]">
                                <XCircle size={15} className="mr-2" /> {copy.cancelRequest}
                            </Button>
                        )}

                        {computed.isMyRequest && !computed.canCancel && (
                            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-center">
                                <p className="text-[10px] font-black text-indigo-600 uppercase italic">{copy.ownRequest}</p>
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
                <DialogContent className="max-w-[90vw] sm:max-w-[400px] rounded-[2.5rem] border-none p-8 space-y-6 outline-none">
                    <div className="text-center space-y-2">
                        <div className="size-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle size={32} />
                        </div>
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter">{copy.acceptPassenger}</DialogTitle>
                        <DialogDescription className="text-xs font-bold text-slate-400">
                            {interpolate(copy.acceptDescription, { name: request.requester.displayName })}
                        </DialogDescription>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest ml-4">{copy.finalPrice}</Label>
                        <div className="relative">
                            <Euro className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                            <Input
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                className="h-16 pl-14 text-2xl font-black rounded-2xl bg-slate-50 border-none text-center shadow-inner"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest ml-4">{copy.totalCapacity}</Label>
                        <div className="relative">
                            <Users className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                            <Input
                                type="number"
                                min={computed.requestedSeats}
                                max="8"
                                value={totalSeats}
                                onChange={(e) => setTotalSeats(e.target.value)}
                                className="h-16 pl-14 text-2xl font-black rounded-2xl bg-slate-50 border-none text-center shadow-inner"
                            />
                        </div>
                        <p className="text-[9px] text-center text-slate-400 font-bold uppercase tracking-tight">
                            {interpolate(copy.includingSeats, { seats: computed.requestedSeats })}
                        </p>
                    </div>

                    <Button
                        onClick={handleConfirmAcceptance}
                        disabled={isSubmitting}
                        className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs shadow-xl flex gap-2"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <>{copy.confirmJoin} <ChevronRight size={18} /></>}
                    </Button>
                </DialogContent>
            </Dialog>

            <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <DialogContent className="max-w-[90vw] sm:max-w-[400px] rounded-[2.5rem] border-none p-8 space-y-6 outline-none">
                    <div className="text-center space-y-2">
                        <div className="size-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <XCircle size={32} />
                        </div>
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter">{copy.cancelConfirm}</DialogTitle>
                        <DialogDescription className="text-xs font-bold text-slate-400">
                            {copy.cancelConfirmDesc}
                        </DialogDescription>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Button type="button" variant="outline" onClick={() => setShowCancelDialog(false)} className="h-13 rounded-2xl border-slate-100 font-black uppercase tracking-widest text-[10px]">
                            {copy.keepRequest}
                        </Button>
                        <Button type="button" onClick={handleCancelRequest} disabled={isCancelling} className="h-13 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest text-[10px]">
                            {isCancelling ? <Loader2 className="animate-spin" /> : copy.confirmCancel}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RequestDetails;
