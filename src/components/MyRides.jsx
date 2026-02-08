import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isValid, subMinutes, isBefore, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Car, ArrowUpRight, Loader2, ChevronLeft, Heart, Users, MapPin, RefreshCw, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';

const RideCard = ({ ride, navigate, currentUserId }) => {
    const originAddress = ride.origin?.name || ride.origin?.address?.split(',')[0] || 'Origen';
    const destinationAddress = ride.destination?.name || ride.destination?.address?.split(',')[0] || 'Destino';
    const isDriver = ride.driver_id === currentUserId;
    const dateObj = ride.departure_time ? new Date(ride.departure_time) : null;

    // DETERMINACIÓN DE ESTADO REAL (LOGICA DE FILTRO UI)
    const STATUS_THEMES = {
        scheduled: { text: 'PROGRAMADO', bg: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500' },
        active: { text: 'EN CURSO', bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        in_progress: { text: 'EN CURSO', bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        completed: { text: 'COMPLETADO', bg: 'bg-slate-50 text-slate-400 border-slate-100', dot: 'bg-slate-300' },
        cancelled: { text: 'CANCELADO', bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' },
        expired: { text: 'CADUCADO', bg: 'bg-orange-50 text-orange-400 border-orange-100', dot: 'bg-orange-400' }
    };

    // Si el viaje es antiguo y sigue en scheduled, visualmente es EXPIRED
    const isActuallyExpired = ride.status === 'scheduled' && dateObj && isBefore(dateObj, subMinutes(new Date(), 120));
    const effectiveStatus = isActuallyExpired ? 'expired' : (ride.status || 'scheduled');
    const currentTheme = STATUS_THEMES[effectiveStatus] || STATUS_THEMES.scheduled;

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
                        <span className="text-xs font-black italic leading-none">{dateObj && isValid(dateObj) ? format(dateObj, "dd") : '--'}</span>
                        <span className="text-[8px] font-bold uppercase opacity-50">{dateObj && isValid(dateObj) ? format(dateObj, "MMM", { locale: es }) : '---'}</span>
                    </div>
                    <div>
                        <div className={cn("px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 border mb-1", currentTheme.bg)}>
                            <div className={cn("h-1 w-1 rounded-full", currentTheme.dot)} />
                            {currentTheme.text}
                        </div>
                        <p className="text-[10px] font-black text-slate-900 uppercase italic">
                            {isDriver ? 'CONDUCES' : 'PASAJERO'}
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
                                <span className="text-[9px] font-bold uppercase tracking-widest italic">Sin pasajeros</span>
                            </div>
                        )}
                    </div>

                    <div className="text-right">
                        <p className="text-sm font-black text-slate-900 tracking-tighter leading-none">{ride.price}€</p>
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1">Precio Plaza</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MyRides = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('upcoming');
    const [rides, setRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);

    const fetchRidesDirect = async (id) => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('fetch_my_activity_v1', { p_user_id: id });
            if (error) throw error;
            setRides(data || []);
        } catch (err) {
            console.error("❌ Error loading rides:", err);
            toast.error("Error al sincronizar actividad");
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
            }
        };
        init();
    }, []);

    // LÓGICA DE FILTRADO TÉCNICO (Upcoming vs History)
    const { upcoming, history } = useMemo(() => {
        const list = Array.isArray(rides) ? rides : [];
        const now = new Date();
        const EXPIRATION_LIMIT = subMinutes(now, 120); // 2 horas de tolerancia

        const upcomingList = [];
        const historyList = [];

        list.forEach(r => {
            const departureDate = new Date(r.departure_time);

            // Un viaje es HISTORIAL si:
            // 1. Está completado, cancelado o expirado.
            // 2. Es un viaje "olvidado" (Scheduled pero de hace más de 2 horas).
            const isActuallyPast = isBefore(departureDate, EXPIRATION_LIMIT) && r.status === 'scheduled';
            const isHistoricalStatus = ['completed', 'cancelled', 'expired'].includes(r.status);

            if (isHistoricalStatus || isActuallyPast) {
                historyList.push(r);
            } else {
                upcomingList.push(r);
            }
        });

        return {
            upcoming: upcomingList.sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time)),
            history: historyList.sort((a, b) => new Date(b.departure_time) - new Date(a.departure_time))
        };
    }, [rides]);

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Actividad</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Control de trayectos</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-xl size-10 text-slate-300 hover:text-primary" onClick={() => userId && fetchRidesDirect(userId)}>
                    <RefreshCw className={cn("size-5", loading && "animate-spin")} />
                </Button>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8">
                <div className="flex p-2 bg-white rounded-[2.2rem] shadow-xl border border-slate-100">
                    <button
                        onClick={() => setActiveTab('upcoming')}
                        className={cn(
                            "flex-1 h-14 rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2",
                            activeTab === 'upcoming' ? "bg-slate-900 text-white shadow-lg" : "text-slate-400"
                        )}
                    >
                        Próximos {upcoming.length > 0 && <span className="bg-primary text-white size-4 rounded-full text-[8px] flex items-center justify-center font-bold shadow-sm">{upcoming.length}</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={cn(
                            "flex-1 h-14 rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all",
                            activeTab === 'history' ? "bg-slate-900 text-white shadow-lg" : "text-slate-400"
                        )}
                    >
                        Historial
                    </button>
                </div>

                <div className="space-y-2">
                    {loading && rides.length === 0 ? (
                        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary size-8" /></div>
                    ) : (activeTab === 'upcoming' ? upcoming : history).length > 0 ? (
                        (activeTab === 'upcoming' ? upcoming : history).map(ride => <RideCard key={ride.id} ride={ride} navigate={navigate} currentUserId={userId} />)
                    ) : (
                        <div className="text-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-inner">
                            <Car className="h-12 w-12 text-slate-100 mx-auto mb-6" />
                            <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">Bandeja Vacía</h3>
                            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest px-8">No hay trayectos en esta sección</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default MyRides;
