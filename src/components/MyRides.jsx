import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isValid, subMinutes, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Car, ArrowUpRight, Loader2, ChevronLeft, Heart, Users, Calendar, XCircle, CheckCircle, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

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
        tabs: {
            active: 'Próximos',
            requested: 'Solicitudes',
            history: 'Historial',
            cancelled: 'Cancelados'
        },
        status: {
            scheduled: 'PROGRAMADO',
            active: 'EN CURSO',
            in_progress: 'EN CURSO',
            completed: 'COMPLETADO',
            cancelled: 'CANCELADO',
            expired: 'CADUCADO',
            requested: 'SOLICITUD PENDIENTE',
            rejected: 'RECHAZADO'
        },
        roles: {
            driver: 'CONDUCES',
            onboard: 'A BORDO',
            requester: 'SOLICITANTE',
            passenger: 'PASAJERO'
        }
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
        tabs: {
            active: 'Upcoming',
            requested: 'Requests',
            history: 'History',
            cancelled: 'Cancelled'
        },
        status: {
            scheduled: 'SCHEDULED',
            active: 'IN PROGRESS',
            in_progress: 'IN PROGRESS',
            completed: 'COMPLETED',
            cancelled: 'CANCELLED',
            expired: 'EXPIRED',
            requested: 'REQUEST PENDING',
            rejected: 'REJECTED'
        },
        roles: {
            driver: 'DRIVING',
            onboard: 'ON BOARD',
            requester: 'REQUESTER',
            passenger: 'PASSENGER'
        }
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
        tabs: {
            active: 'القادمة',
            requested: 'الطلبات',
            history: 'السجل',
            cancelled: 'الملغاة'
        },
        status: {
            scheduled: 'مجدولة',
            active: 'قيد التنفيذ',
            in_progress: 'قيد التنفيذ',
            completed: 'مكتملة',
            cancelled: 'ملغاة',
            expired: 'منتهية',
            requested: 'طلب قيد الانتظار',
            rejected: 'مرفوضة'
        },
        roles: {
            driver: 'أنت السائق',
            onboard: 'على متن الرحلة',
            requester: 'صاحب الطلب',
            passenger: 'راكب'
        }
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const OPEN_RIDE_STATUSES_TIME_EXPIRABLE = new Set(['scheduled', 'active', 'in_progress']);
const RIDE_EXPIRATION_GRACE_MINUTES = 120;

function isStaleOpenRidePastGrace(ride, now = new Date()) {
    const raw = ride?.status;
    if (!ride?.departure_time || !OPEN_RIDE_STATUSES_TIME_EXPIRABLE.has(raw)) return false;
    const departureDate = new Date(ride.departure_time);
    if (Number.isNaN(departureDate.getTime())) return false;
    return isBefore(departureDate, subMinutes(now, RIDE_EXPIRATION_GRACE_MINUTES));
}

const RideCard = ({ ride, navigate, currentUserId, copy }) => {
    const originAddress = ride.origin?.name || ride.origin?.address?.split(',')[0] || copy.origin;
    const destinationAddress = ride.destination?.name || ride.destination?.address?.split(',')[0] || copy.destination;
    const isDriver = ride.driver_id === currentUserId;
    const dateObj = ride.departure_time ? new Date(ride.departure_time) : null;

    const STATUS_THEMES = {
        scheduled: { text: copy.status.scheduled, bg: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500' },
        active: { text: copy.status.active, bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        in_progress: { text: copy.status.in_progress, bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        completed: { text: copy.status.completed, bg: 'bg-slate-50 text-slate-400 border-slate-100', dot: 'bg-slate-300' },
        cancelled: { text: copy.status.cancelled, bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' },
        expired: { text: copy.status.expired, bg: 'bg-orange-50 text-orange-400 border-orange-100', dot: 'bg-orange-400' },
        requested: { text: copy.status.requested, bg: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500 animate-pulse' },
        rejected: { text: copy.status.rejected, bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' }
    };

    const isActuallyExpired = isStaleOpenRidePastGrace(ride);
    const effectiveStatus = isActuallyExpired ? 'expired' : (ride.status || 'scheduled');
    const currentTheme = STATUS_THEMES[effectiveStatus] || STATUS_THEMES.scheduled;

    const getRoleLabel = () => {
        if (isDriver) return copy.roles.driver;
        const meAsPax = Array.isArray(ride.passengers)
            ? ride.passengers.find(p => String(p.id) === String(currentUserId))
            : null;
        if (meAsPax && (meAsPax.status === 'verified' || meAsPax.status === 'on_board')) return copy.roles.onboard;
        return ride.role === 'requester' ? copy.roles.requester : copy.roles.passenger;
    };

    return (
        <div
            className="group relative overflow-hidden rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 cursor-pointer bg-white flex flex-col mb-4"
            onClick={() => navigate(`/ride/${ride.id}`)}
        >
            <div className="absolute top-4 right-4 flex gap-2 z-20">
                {ride.is_women_only && <div className="bg-pink-500 text-white p-1.5 rounded-full shadow-lg"><Heart size={10} className="fill-white" /></div>}
                {isDriver && <div className="bg-slate-900 text-white p-1.5 rounded-full shadow-lg"><Car size={10} /></div>}
            </div>

            <div className="p-6 flex items-center justify-between border-b border-slate-50">
                <div className="flex items-center gap-4">
                    <div className="bg-slate-900 text-white size-14 rounded-2xl flex flex-col items-center justify-center shadow-lg group-hover:rotate-3 transition-transform">
                        <span className="text-xs font-black italic leading-none">{dateObj && isValid(dateObj) ? format(dateObj, 'dd') : '--'}</span>
                        <span className="text-[8px] font-bold uppercase opacity-50">{dateObj && isValid(dateObj) ? format(dateObj, 'MMM', { locale: es }) : '---'}</span>
                    </div>
                    <div>
                        <div className={cn('px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 border mb-1', currentTheme.bg)}>
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
                    <div className="flex-1 space-y-3">
                        <p className="text-[11px] font-bold text-slate-600 truncate uppercase tracking-tight">{originAddress}</p>
                        <p className="text-[11px] font-black text-slate-900 truncate uppercase tracking-tight italic">{destinationAddress}</p>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                    <div className="flex -space-x-2">
                        {Array.isArray(ride.passengers) && ride.passengers.length > 0 ? (
                            ride.passengers.slice(0, 3).map((p, i) => (
                                <Avatar key={i} className="size-7 border-2 border-white shadow-sm">
                                    <AvatarImage src={p.avatar_url || p.photoURL} />
                                    <AvatarFallback className="text-[8px] bg-slate-100">{p.displayName?.charAt(0) || 'U'}</AvatarFallback>
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
        } catch (err) {
            console.error('Error loading rides:', err);
            toast.error(copy.syncError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserId(user.id);
                fetchRidesDirect(user.id);

                const channel = supabase
                    .channel(`my_activity_${user.id}`)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'rides'
                    }, () => {
                        console.log('[MyRides] Activity update detected');
                        fetchRidesDirect(user.id);
                    })
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'ride_requests',
                        filter: `requester_id=eq.${user.id}`
                    }, () => fetchRidesDirect(user.id))
                    .subscribe();

                return () => {
                    supabase.removeChannel(channel);
                };
            }
        };
        init();
    }, []);

    const filteredRides = useMemo(() => {
        const list = Array.isArray(rides) ? rides : [];
        const now = new Date();

        return list.filter(r => {
            const isActuallyExpired = isStaleOpenRidePastGrace(r, now);
            let status = r.status;
            if (isActuallyExpired && status !== 'requested') status = 'expired';

            switch (activeTab) {
                case 'active':
                    return ['scheduled', 'active', 'in_progress'].includes(status) && (r.role === 'driver' || r.role === 'passenger');
                case 'requested':
                    return r.role === 'requester' && !['completed', 'expired', 'cancelled', 'rejected'].includes(status);
                case 'history':
                    return ['completed', 'expired'].includes(status);
                case 'cancelled':
                    return ['cancelled', 'rejected'].includes(status);
                default:
                    return false;
            }
        }).sort((a, b) => {
            const dateA = new Date(a.departure_time);
            const dateB = new Date(b.departure_time);
            if (['history', 'cancelled'].includes(activeTab)) return dateB - dateA;
            return dateA - dateB;
        });
    }, [rides, activeTab]);

    const tabs = [
        { id: 'active', label: copy.tabs.active, icon: Calendar },
        { id: 'requested', label: copy.tabs.requested, icon: Users },
        { id: 'history', label: copy.tabs.history, icon: CheckCircle },
        { id: 'cancelled', label: copy.tabs.cancelled, icon: XCircle }
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">{copy.title}</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{copy.subtitle}</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-xl size-10 text-slate-300 hover:text-primary" onClick={() => userId && fetchRidesDirect(userId)}>
                    <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
                </Button>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8">
                <div className="flex overflow-x-auto pb-4 gap-2 no-scrollbar">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'px-4 py-3 rounded-2xl flex items-center gap-2 whitespace-nowrap transition-all border',
                                    isActive
                                        ? 'bg-slate-900 text-white border-slate-900 shadow-md transform scale-105'
                                        : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'
                                )}
                            >
                                <Icon size={14} className={isActive ? 'text-primary' : 'text-slate-400'} />
                                <span className="text-[10px] font-black uppercase tracking-wider">{tab.label}</span>
                                {isActive && filteredRides.length > 0 && (
                                    <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded-full text-[8px]">{filteredRides.length}</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    {loading && rides.length === 0 ? (
                        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary size-8" /></div>
                    ) : filteredRides.length > 0 ? (
                        filteredRides.map(ride => (
                            <RideCard key={ride.id} ride={ride} navigate={navigate} currentUserId={userId} copy={copy} />
                        ))
                    ) : (
                        <div className="text-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-inner">
                            <Car className="h-12 w-12 text-slate-100 mx-auto mb-6" />
                            <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">{copy.noResults}</h3>
                            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest px-8">
                                {copy.noResultsDesc}
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default MyRides;
