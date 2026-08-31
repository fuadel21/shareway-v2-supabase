import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInMinutes, format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    ArrowUpRight,
    BellRing,
    Calendar,
    Car,
    CheckCircle,
    Clock,
    ChevronLeft,
    Eye,
    Flag,
    Heart,
    Loader2,
    MessageCircle,
    Play,
    RefreshCw,
    Users,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { startRide } from '@/lib/supabaseRPC.js';
import {
    cancelBooking,
    cancelRide,
    completeRide as completeRideService,
} from '@/services/rideService.js';
import { canPresentStartRide } from '@/utils/rideBoarding.js';
import {
    filterActivityByTab,
    getEffectiveActivityStatus,
    RIDE_EXPIRATION_GRACE_MINUTES,
} from '@/utils/activityFilters.js';

const copyByLanguage = {
    es: {
        title: 'Actividad',
        subtitle: 'Tus Viajes',
        origin: 'Origen',
        destination: 'Destino',
        wait: 'Esperando...',
        free: 'LIBRES',
        seatPrice: 'Precio Plaza',
        noResults: 'Sin Resultados',
        noResultsDesc: 'No tienes viajes en esta sección',
        syncError: 'Error al sincronizar actividad',
        actionError: 'No se pudo completar la acción',
        refreshing: 'Actualizando actividad...',
        actions: {
            view: 'Ver',
            chat: 'Chat',
            requests: 'Solicitudes',
            start: 'Iniciar',
            finish: 'Finalizar',
            cancel: 'Cancelar viaje',
            cancelBooking: 'Cancelar reserva',
            confirmStartTitle: '¿Iniciar este viaje?',
            confirmStartDesc: 'El viaje pasará a estar en curso y los pasajeros podrán usar las funciones de viaje activo.',
            confirmFinishTitle: '¿Finalizar este viaje?',
            confirmFinishDesc: 'Se intentará cerrar el viaje, liberar pagos y preparar valoraciones.',
            confirmCancelTitle: '¿Cancelar este viaje?',
            confirmCancelDesc: 'Esta acción notificará a los pasajeros y aplicará la política de cancelación vigente.',
            confirmCancelBookingTitle: '¿Cancelar tu reserva?',
            confirmCancelBookingDesc: 'Se liberará tu plaza y se aplicará automáticamente la política de devolución correspondiente. Esta acción no se puede deshacer.',
            yesStart: 'Sí, iniciar',
            yesFinish: 'Sí, finalizar',
            yesCancel: 'Sí, cancelar viaje',
            yesCancelBooking: 'Sí, cancelar reserva',
            no: 'Volver',
        },
        toasts: {
            started: '¡Viaje iniciado!',
            finished: '¡Viaje finalizado!',
            cancelled: 'Viaje cancelado correctamente',
            bookingCancelled: 'Reserva cancelada correctamente',
            bookingRefund: 'Tu plaza ha sido liberada y se ha aplicado la política de devolución.',
        },
        tabs: {
            active: 'Próximos',
            requested: 'Solicitudes',
            history: 'Historial',
            cancelled: 'Cancelados',
            expired: 'Caducados',
        },
        status: {
            scheduled: 'PROGRAMADO',
            active: 'EN CURSO',
            in_progress: 'EN CURSO',
            completed: 'COMPLETADO',
            cancelled: 'CANCELADO',
            expired: 'CADUCADO',
            requested: 'SOLICITUD PENDIENTE',
            rejected: 'RECHAZADO',
        },
        roles: {
            driver: 'CONDUCES',
            onboard: 'A BORDO',
            requester: 'SOLICITANTE',
            passenger: 'PASAJERO',
        },
    },
    en: {
        title: 'Activity',
        subtitle: 'Your Rides',
        origin: 'Origin',
        destination: 'Destination',
        wait: 'Waiting...',
        free: 'FREE',
        seatPrice: 'Seat Price',
        noResults: 'No Results',
        noResultsDesc: 'You have no rides in this section',
        syncError: 'Error syncing activity',
        actionError: 'Could not complete the action',
        refreshing: 'Refreshing activity...',
        actions: {
            view: 'View',
            chat: 'Chat',
            requests: 'Requests',
            start: 'Start',
            finish: 'Finish',
            cancel: 'Cancel ride',
            cancelBooking: 'Cancel booking',
            confirmStartTitle: 'Start this ride?',
            confirmStartDesc: 'The ride will move to in progress and passengers can use active trip features.',
            confirmFinishTitle: 'Finish this ride?',
            confirmFinishDesc: 'The ride will be closed, payments released and ratings prepared.',
            confirmCancelTitle: 'Cancel this ride?',
            confirmCancelDesc: 'Passengers will be notified and the current cancellation policy will apply.',
            confirmCancelBookingTitle: 'Cancel your booking?',
            confirmCancelBookingDesc: 'Your seat will be released and the applicable refund policy will be applied automatically. This cannot be undone.',
            yesStart: 'Yes, start',
            yesFinish: 'Yes, finish',
            yesCancel: 'Yes, cancel ride',
            yesCancelBooking: 'Yes, cancel booking',
            no: 'Back',
        },
        toasts: {
            started: 'Ride started!',
            finished: 'Ride completed!',
            cancelled: 'Ride cancelled successfully',
            bookingCancelled: 'Booking cancelled successfully',
            bookingRefund: 'Your seat was released and the refund policy has been applied.',
        },
        tabs: {
            active: 'Upcoming',
            requested: 'Requests',
            history: 'History',
            cancelled: 'Cancelled',
            expired: 'Expired',
        },
        status: {
            scheduled: 'SCHEDULED',
            active: 'IN PROGRESS',
            in_progress: 'IN PROGRESS',
            completed: 'COMPLETED',
            cancelled: 'CANCELLED',
            expired: 'EXPIRED',
            requested: 'REQUEST PENDING',
            rejected: 'REJECTED',
        },
        roles: {
            driver: 'DRIVING',
            onboard: 'ON BOARD',
            requester: 'REQUESTER',
            passenger: 'PASSENGER',
        },
    },
    ar: {
        title: 'النشاط',
        subtitle: 'رحلاتك',
        origin: 'نقطة الانطلاق',
        destination: 'الوجهة',
        wait: 'في الانتظار...',
        free: 'متاحة',
        seatPrice: 'سعر المقعد',
        noResults: 'لا توجد نتائج',
        noResultsDesc: 'لا توجد رحلات في هذا القسم',
        syncError: 'حدث خطأ أثناء مزامنة النشاط',
        actionError: 'تعذر إكمال الإجراء',
        refreshing: 'يتم تحديث النشاط...',
        actions: {
            view: 'عرض',
            chat: 'الدردشة',
            requests: 'الطلبات',
            start: 'بدء',
            finish: 'إنهاء',
            cancel: 'إلغاء الرحلة',
            cancelBooking: 'إلغاء الحجز',
            confirmStartTitle: 'هل تريد بدء هذه الرحلة؟',
            confirmStartDesc: 'ستصبح الرحلة قيد التنفيذ ويمكن للركاب استخدام ميزات الرحلة النشطة.',
            confirmFinishTitle: 'هل تريد إنهاء هذه الرحلة؟',
            confirmFinishDesc: 'سيتم إغلاق الرحلة ومحاولة تحرير المدفوعات وتجهيز التقييمات.',
            confirmCancelTitle: 'هل تريد إلغاء هذه الرحلة؟',
            confirmCancelDesc: 'سيتم إشعار الركاب وتطبيق سياسة الإلغاء الحالية.',
            confirmCancelBookingTitle: 'هل تريد إلغاء حجزك؟',
            confirmCancelBookingDesc: 'سيتم تحرير مقعدك وتطبيق سياسة الاسترداد المناسبة تلقائياً. لا يمكن التراجع عن هذا الإجراء.',
            yesStart: 'نعم، ابدأ',
            yesFinish: 'نعم، أنهِ',
            yesCancel: 'نعم، إلغاء الرحلة',
            yesCancelBooking: 'نعم، إلغاء الحجز',
            no: 'رجوع',
        },
        toasts: {
            started: 'تم بدء الرحلة!',
            finished: 'تم إنهاء الرحلة!',
            cancelled: 'تم إلغاء الرحلة بنجاح',
            bookingCancelled: 'تم إلغاء الحجز بنجاح',
            bookingRefund: 'تم تحرير مقعدك وتطبيق سياسة الاسترداد.',
        },
        tabs: {
            active: 'القادمة',
            requested: 'الطلبات',
            history: 'السجل',
            cancelled: 'الملغاة',
            expired: 'المنتهية',
        },
        status: {
            scheduled: 'مجدولة',
            active: 'قيد التنفيذ',
            in_progress: 'قيد التنفيذ',
            completed: 'مكتملة',
            cancelled: 'ملغاة',
            expired: 'منتهية',
            requested: 'طلب قيد الانتظار',
            rejected: 'مرفوضة',
        },
        roles: {
            driver: 'أنت السائق',
            onboard: 'على متن الرحلة',
            requester: 'صاحب الطلب',
            passenger: 'راكب',
        },
    },
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const countPendingRequests = (ride) => {
    const directCount = Number(ride?.pending_requests_count ?? ride?.request_count ?? ride?.requests_count ?? 0);
    if (Number.isFinite(directCount) && directCount > 0) return directCount;
    if (Array.isArray(ride?.requests)) return ride.requests.filter((req) => ['pending', 'requested'].includes(req.status)).length;
    if (Array.isArray(ride?.ride_requests)) return ride.ride_requests.filter((req) => ['pending', 'requested'].includes(req.status)).length;
    return 0;
};

const getConfirmedPassengerCount = (ride) => {
    if (Array.isArray(ride?.passengers)) {
        return ride.passengers.filter((passenger) => ['confirmed', 'verified', 'on_board', 'completed'].includes(passenger.status)).length;
    }
    const ids = Array.isArray(ride?.participant_ids) ? ride.participant_ids : [];
    return ids.length;
};

const getMyPassengerEntry = (ride, currentUserId) => {
    if (!Array.isArray(ride?.passengers) || !currentUserId) return null;
    return ride.passengers.find((passenger) => String(passenger?.id) === String(currentUserId)) || null;
};

const QuickActionButton = ({ icon: Icon, label, tone = 'neutral', onClick, disabled = false }) => {
    const toneClass = {
        neutral: 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100',
        primary: 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-900/10',
        success: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
        warning: 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100',
        danger: 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100',
    }[tone] || 'bg-slate-50 text-slate-600 border-slate-100';

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'h-10 px-3 rounded-2xl border flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 touch-action-manipulation disabled:opacity-50 disabled:pointer-events-none',
                toneClass
            )}
        >
            <Icon size={13} />
            <span>{label}</span>
        </button>
    );
};

const RideCard = ({ ride, navigate, currentUserId, copy, onQuickAction, actionLoadingId }) => {
    const originAddress = ride.origin?.name || ride.origin?.address?.split(',')[0] || copy.origin;
    const destinationAddress = ride.destination?.name || ride.destination?.address?.split(',')[0] || copy.destination;
    const isDriver = String(ride.driver_id || '') === String(currentUserId || '');
    const myPassengerEntry = getMyPassengerEntry(ride, currentUserId);
    const isPassenger = !isDriver && (ride.role === 'passenger' || Boolean(myPassengerEntry));
    const detailsPath = ride.role === 'requester' && ride.request_id
        ? `/request/${ride.request_id}`
        : `/ride/${ride.id}`;
    const dateObj = ride.departure_time ? new Date(ride.departure_time) : null;

    const STATUS_THEMES = {
        scheduled: { text: copy.status.scheduled, bg: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500' },
        active: { text: copy.status.active, bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        in_progress: { text: copy.status.in_progress, bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        completed: { text: copy.status.completed, bg: 'bg-slate-50 text-slate-400 border-slate-100', dot: 'bg-slate-300' },
        cancelled: { text: copy.status.cancelled, bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' },
        expired: { text: copy.status.expired, bg: 'bg-orange-50 text-orange-400 border-orange-100', dot: 'bg-orange-400' },
        requested: { text: copy.status.requested, bg: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500 animate-pulse' },
        rejected: { text: copy.status.rejected, bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' },
    };

    const now = new Date();
    const effectiveStatus = ride.effective_status || getEffectiveActivityStatus(ride, { now });
    const currentTheme = STATUS_THEMES[effectiveStatus] || STATUS_THEMES.scheduled;
    const isClosed = ['completed', 'cancelled', 'expired', 'rejected'].includes(effectiveStatus);
    const isActive = ['active', 'in_progress'].includes(effectiveStatus);
    const pendingRequestCount = countPendingRequests(ride);
    const confirmedPassengerCount = getConfirmedPassengerCount(ride);
    const minutesToDeparture = dateObj && isValid(dateObj) ? differenceInMinutes(dateObj, now) : 999999;
    const hasDeparted = dateObj && isValid(dateObj) ? dateObj <= now : false;
    const isTooLate = dateObj && isValid(dateObj)
        ? differenceInMinutes(now, dateObj) > RIDE_EXPIRATION_GRACE_MINUTES
        : false;

    const canStart = isDriver
        && effectiveStatus === 'scheduled'
        && (minutesToDeparture <= 15 || hasDeparted)
        && !isTooLate
        && canPresentStartRide({ ride, now });
    const canFinish = isDriver && isActive;
    const canCancelRide = isDriver && !isClosed && !isActive;
    const passengerStatus = myPassengerEntry?.status;
    const hasLivePassengerBooking = !passengerStatus
        || ['confirmed', 'pending'].includes(passengerStatus);
    const canCancelBooking = isPassenger
        && effectiveStatus === 'scheduled'
        && !hasDeparted
        && hasLivePassengerBooking;
    const canOpenChat = !isClosed && (isDriver || isPassenger);
    const isLoading = actionLoadingId === ride.id;

    const getRoleLabel = () => {
        if (isDriver) return copy.roles.driver;
        if (myPassengerEntry && ['verified', 'on_board'].includes(myPassengerEntry.status)) return copy.roles.onboard;
        return ride.role === 'requester' ? copy.roles.requester : copy.roles.passenger;
    };

    const stopAndRun = (event, fn) => {
        event.preventDefault();
        event.stopPropagation();
        fn();
    };

    return (
        <div
            className="group relative overflow-hidden rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 cursor-pointer bg-white flex flex-col mb-4"
            onClick={() => navigate(detailsPath)}
        >
            <div className="absolute top-4 right-4 flex gap-2 z-20">
                {pendingRequestCount > 0 && isDriver && (
                    <div className="bg-amber-500 text-white px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                        <BellRing size={10} />
                        <span className="text-[8px] font-black">{pendingRequestCount}</span>
                    </div>
                )}
                {ride.is_women_only && (
                    <div className="bg-pink-500 text-white p-1.5 rounded-full shadow-lg">
                        <Heart size={10} className="fill-white" />
                    </div>
                )}
                {isDriver && (
                    <div className="bg-slate-900 text-white p-1.5 rounded-full shadow-lg">
                        <Car size={10} />
                    </div>
                )}
            </div>

            <div className="p-6 flex items-center justify-between border-b border-slate-50">
                <div className="flex items-center gap-4">
                    <div className="bg-slate-900 text-white size-14 rounded-2xl flex flex-col items-center justify-center shadow-lg group-hover:rotate-3 transition-transform">
                        <span className="text-xs font-black italic leading-none">
                            {dateObj && isValid(dateObj) ? format(dateObj, 'dd') : '--'}
                        </span>
                        <span className="text-[8px] font-bold uppercase opacity-50">
                            {dateObj && isValid(dateObj) ? format(dateObj, 'MMM', { locale: es }) : '---'}
                        </span>
                    </div>
                    <div>
                        <div className={cn(
                            'px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 border mb-1',
                            currentTheme.bg
                        )}>
                            <div className={cn('h-1 w-1 rounded-full', currentTheme.dot)} />
                            {currentTheme.text}
                        </div>
                        <p className="text-[10px] font-black text-slate-900 uppercase italic">
                            {getRoleLabel()}
                        </p>
                    </div>
                </div>
                <ArrowUpRight className="size-5 text-slate-300 group-hover:text-primary transition-colors" />
            </div>

            <div className="p-6 space-y-4 bg-gradient-to-b from-white to-slate-50/30">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center gap-1">
                        <div className="size-2 rounded-full bg-emerald-500" />
                        <div className="w-0.5 h-4 bg-slate-100" />
                        <div className="size-2 rounded-full bg-primary" />
                    </div>
                    <div className="flex-1 space-y-3 min-w-0">
                        <p className="text-[11px] font-bold text-slate-600 truncate uppercase tracking-tight">{originAddress}</p>
                        <p className="text-[11px] font-black text-slate-900 truncate uppercase tracking-tight italic">{destinationAddress}</p>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                    <div className="flex -space-x-2">
                        {Array.isArray(ride.passengers) && ride.passengers.length > 0 ? (
                            ride.passengers.slice(0, 3).map((passenger, index) => (
                                <Avatar key={`${passenger?.id || 'pax'}-${index}`} className="size-7 border-2 border-white shadow-sm">
                                    <AvatarImage src={passenger.avatar_url || passenger.photoURL} />
                                    <AvatarFallback className="text-[8px] bg-slate-100">
                                        {passenger.displayName?.charAt(0) || passenger.display_name?.charAt(0) || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                            ))
                        ) : (
                            <div className="flex items-center gap-1.5 text-slate-300">
                                <Users size={12} />
                                <span className="text-[9px] font-bold uppercase tracking-widest italic">{copy.wait}</span>
                            </div>
                        )}
                        {ride.seats_available > 0 && (
                            <div className="px-2 py-1 rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 flex items-center ml-2">
                                {ride.seats_available} {copy.free}
                            </div>
                        )}
                    </div>

                    <div className="text-right">
                        <p className="text-sm font-black text-slate-900 tracking-tighter leading-none">{ride.price}€</p>
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1">{copy.seatPrice}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2" onClick={(event) => event.stopPropagation()}>
                    <QuickActionButton
                        icon={Eye}
                        label={copy.actions.view}
                        onClick={(event) => stopAndRun(event, () => navigate(detailsPath))}
                    />
                    {canOpenChat && (
                        <QuickActionButton
                            icon={MessageCircle}
                            label={copy.actions.chat}
                            tone="primary"
                            onClick={(event) => stopAndRun(event, () => navigate(`/rides/${ride.id}/chats`))}
                        />
                    )}
                    {isDriver && pendingRequestCount > 0 && (
                        <QuickActionButton
                            icon={BellRing}
                            label={`${copy.actions.requests} ${pendingRequestCount}`}
                            tone="warning"
                            onClick={(event) => stopAndRun(event, () => navigate(`/ride/${ride.id}`))}
                        />
                    )}
                    {canStart && (
                        <QuickActionButton
                            icon={Play}
                            label={copy.actions.start}
                            tone="success"
                            disabled={isLoading}
                            onClick={(event) => stopAndRun(event, () => onQuickAction('start', ride))}
                        />
                    )}
                    {canFinish && (
                        <QuickActionButton
                            icon={Flag}
                            label={copy.actions.finish}
                            tone="success"
                            disabled={isLoading}
                            onClick={(event) => stopAndRun(event, () => onQuickAction('finish', ride))}
                        />
                    )}
                    {canCancelRide && (
                        <QuickActionButton
                            icon={XCircle}
                            label={copy.actions.cancel}
                            tone="danger"
                            disabled={isLoading}
                            onClick={(event) => stopAndRun(event, () => onQuickAction('cancel', ride))}
                        />
                    )}
                    {canCancelBooking && (
                        <QuickActionButton
                            icon={XCircle}
                            label={copy.actions.cancelBooking}
                            tone="danger"
                            disabled={isLoading}
                            onClick={(event) => stopAndRun(event, () => onQuickAction('cancelBooking', ride))}
                        />
                    )}
                </div>

                {isDriver && confirmedPassengerCount > 0 && !isClosed && (
                    <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-700 flex items-center justify-between">
                        <span>
                            {confirmedPassengerCount} pasajero{confirmedPassengerCount === 1 ? '' : 's'} confirmado{confirmedPassengerCount === 1 ? '' : 's'}
                        </span>
                        <span>{isActive ? copy.status.active : copy.status.scheduled}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const MyRides = () => {
    const navigate = useNavigate();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const [activeTab, setActiveTab] = useState('active');
    const [rides, setRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);
    const [actionLoadingId, setActionLoadingId] = useState(null);
    const [secureAction, setSecureAction] = useState(null);

    const fetchRidesDirect = async (id) => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('fetch_my_activity_v2', { p_user_id: id });

            if (error) {
                console.warn('Retrying with v1 due to error:', error);
                const { data: dataV1, error: errorV1 } = await supabase.rpc('fetch_my_activity_v1', { p_user_id: id });
                if (errorV1) throw errorV1;
                setRides(dataV1 || []);
            } else {
                setRides(data || []);
            }
        } catch (error) {
            console.error('Error loading rides:', error);
            toast.error(copy.syncError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let mounted = true;
        let channel = null;

        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!mounted || !user) return;

            setUserId(user.id);
            await fetchRidesDirect(user.id);

            if (!mounted) return;
            channel = supabase
                .channel(`my_activity_${user.id}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'rides',
                }, () => fetchRidesDirect(user.id))
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'ride_requests',
                    filter: `requester_id=eq.${user.id}`,
                }, () => fetchRidesDirect(user.id))
                .subscribe();
        };

        init();

        return () => {
            mounted = false;
            if (channel) supabase.removeChannel(channel);
        };
    }, []);

    const filteredRides = useMemo(() => {
        const now = new Date();
        const filtered = filterActivityByTab(rides, activeTab, { now });

        return filtered.sort((a, b) => {
            const dateA = new Date(a.departure_time);
            const dateB = new Date(b.departure_time);
            if (['history', 'cancelled', 'expired'].includes(activeTab)) return dateB - dateA;
            return dateA - dateB;
        });
    }, [rides, activeTab]);

    const rideTabCounts = useMemo(() => {
        const now = new Date();
        return ['active', 'requested', 'history', 'cancelled', 'expired'].reduce((counts, tab) => {
            counts[tab] = filterActivityByTab(rides, tab, { now }).length;
            return counts;
        }, {});
    }, [rides]);

    const openActionConfirm = (type, ride) => {
        const actionCopy = {
            start: {
                tone: 'success',
                title: copy.actions.confirmStartTitle,
                description: copy.actions.confirmStartDesc,
                confirmLabel: copy.actions.yesStart,
            },
            finish: {
                tone: 'success',
                title: copy.actions.confirmFinishTitle,
                description: copy.actions.confirmFinishDesc,
                confirmLabel: copy.actions.yesFinish,
            },
            cancel: {
                tone: 'danger',
                title: copy.actions.confirmCancelTitle,
                description: copy.actions.confirmCancelDesc,
                confirmLabel: copy.actions.yesCancel,
            },
            cancelBooking: {
                tone: 'danger',
                title: copy.actions.confirmCancelBookingTitle,
                description: copy.actions.confirmCancelBookingDesc,
                confirmLabel: copy.actions.yesCancelBooking,
            },
        }[type];

        if (!actionCopy) return;
        setSecureAction({ type, ride, ...actionCopy });
    };

    const executeSecureAction = async () => {
        if (!secureAction?.ride?.id || !userId) return;

        const { type, ride } = secureAction;
        setActionLoadingId(ride.id);
        const toastId = toast.loading(copy.refreshing);

        try {
            if (type === 'start') {
                const result = await startRide(ride.id);
                if (!result?.success) throw new Error(result?.error || result?.message || copy.actionError);
                toast.success(copy.toasts.started, { id: toastId });
            } else if (type === 'finish') {
                const result = await completeRideService(ride.id);
                if (!result?.success) throw new Error(result?.error || result?.message || copy.actionError);
                toast.success(copy.toasts.finished, { id: toastId });
            } else if (type === 'cancel') {
                const result = await cancelRide(ride.id);
                if (!result?.success) throw new Error(result?.error || result?.message || copy.actionError);
                toast.success(copy.toasts.cancelled, { id: toastId });
            } else if (type === 'cancelBooking') {
                const result = await cancelBooking(ride.id);
                if (result !== true && !result?.success) {
                    throw new Error(result?.error || result?.message || copy.actionError);
                }
                toast.success(copy.toasts.bookingCancelled, {
                    id: toastId,
                    description: copy.toasts.bookingRefund,
                });
            }

            setSecureAction(null);
            await fetchRidesDirect(userId);
        } catch (error) {
            toast.error(copy.actionError, {
                id: toastId,
                description: error.message,
            });
        } finally {
            setActionLoadingId(null);
        }
    };

    const tabs = [
        { id: 'active', label: copy.tabs.active, icon: Calendar },
        { id: 'requested', label: copy.tabs.requested, icon: Users },
        { id: 'history', label: copy.tabs.history, icon: CheckCircle },
        { id: 'cancelled', label: copy.tabs.cancelled, icon: XCircle },
        { id: 'expired', label: copy.tabs.expired, icon: Clock },
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-2xl bg-slate-50 size-12 shadow-sm"
                        onClick={() => navigate('/dashboard')}
                    >
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">{copy.title}</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{copy.subtitle}</p>
                    </div>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-xl size-10 text-slate-300 hover:text-primary"
                    onClick={() => userId && fetchRidesDirect(userId)}
                >
                    <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
                </Button>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8">
                <div className="flex overflow-x-auto pb-4 gap-2 no-scrollbar">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActiveTab = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'px-4 py-3 rounded-2xl flex items-center gap-2 whitespace-nowrap transition-all border',
                                    isActiveTab
                                        ? 'bg-slate-900 text-white border-slate-900 shadow-md transform scale-105'
                                        : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'
                                )}
                            >
                                <Icon size={14} className={isActiveTab ? 'text-primary' : 'text-slate-400'} />
                                <span className="text-[10px] font-black uppercase tracking-wider">{tab.label}</span>
                                <span className={cn(
                                    'ml-1 px-1.5 py-0.5 rounded-full text-[8px]',
                                    isActiveTab ? 'bg-white/20' : 'bg-slate-100 text-slate-400'
                                )}>
                                    {rideTabCounts[tab.id] || 0}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    {loading && rides.length === 0 ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="animate-spin text-primary size-8" />
                        </div>
                    ) : filteredRides.length > 0 ? (
                        filteredRides.map((ride) => (
                            <RideCard
                                key={ride.id}
                                ride={ride}
                                navigate={navigate}
                                currentUserId={userId}
                                copy={copy}
                                onQuickAction={openActionConfirm}
                                actionLoadingId={actionLoadingId}
                            />
                        ))
                    ) : (
                        <div className="text-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-inner">
                            <Car className="h-12 w-12 text-slate-100 mx-auto mb-6" />
                            <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">{copy.noResults}</h3>
                            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest px-8">{copy.noResultsDesc}</p>
                        </div>
                    )}
                </div>
            </main>

            <AlertDialog
                open={Boolean(secureAction)}
                onOpenChange={(open) => !open && !actionLoadingId && setSecureAction(null)}
            >
                <AlertDialogContent className="rounded-[2rem] border-none shadow-2xl max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-xl font-black tracking-tighter italic uppercase text-slate-900">
                            {secureAction?.title}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-sm font-semibold text-slate-500 leading-relaxed">
                            {secureAction?.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 sm:gap-2">
                        <AlertDialogCancel
                            disabled={Boolean(actionLoadingId)}
                            className="rounded-2xl font-black uppercase tracking-widest text-[10px]"
                        >
                            {copy.actions.no}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                executeSecureAction();
                            }}
                            disabled={Boolean(actionLoadingId)}
                            className={cn(
                                'rounded-2xl font-black uppercase tracking-widest text-[10px]',
                                secureAction?.tone === 'danger'
                                    ? 'bg-red-600 hover:bg-red-700'
                                    : 'bg-slate-900 hover:bg-slate-800'
                            )}
                        >
                            {actionLoadingId ? <Loader2 className="size-4 animate-spin" /> : secureAction?.confirmLabel}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default MyRides;
