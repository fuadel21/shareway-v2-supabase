import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isValid, subMinutes, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Car, ArrowUpRight, Loader2, ChevronLeft, Heart, Users, Calendar, XCircle, CheckCircle, Clock, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

/** Estados de viaje “abiertos” que pueden quedar desactualizados en BD si nadie cierra el viaje. */
const OPEN_RIDE_STATUSES_TIME_EXPIRABLE = new Set(['scheduled', 'active', 'in_progress']);
const RIDE_EXPIRATION_GRACE_MINUTES = 120;

/** True si la hora de salida ya pasó el margen de gracia (mismo criterio que antes solo para `scheduled`). */
function isStaleOpenRidePastGrace(ride, now = new Date()) {
    const raw = ride?.status;
    if (!ride?.departure_time || !OPEN_RIDE_STATUSES_TIME_EXPIRABLE.has(raw)) return false;
    const departureDate = new Date(ride.departure_time);
    if (Number.isNaN(departureDate.getTime())) return false;
    return isBefore(departureDate, subMinutes(now, RIDE_EXPIRATION_GRACE_MINUTES));
}

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
        expired: { text: 'CADUCADO', bg: 'bg-orange-50 text-orange-400 border-orange-100', dot: 'bg-orange-400' },
        requested: { text: 'SOLICITUD PENDIENTE', bg: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500 animate-pulse' },
        rejected: { text: 'RECHAZADO', bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' }
    };

    // Viaje antiguo en scheduled / active / in_progress sin cierre en BD → caducado en UI (misma ventana de gracia)
    const isActuallyExpired = isStaleOpenRidePastGrace(ride);
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
                            {isDriver ? 'CONDUCES' : (
                                (() => {
                                    const meAsPax = Array.isArray(ride.passengers) ? ride.passengers.find(p => String(p.id) === String(currentUserId)) : null;
                                    if (meAsPax && (meAsPax.status === 'verified' || meAsPax.status === 'on_board')) return 'A BORDO';
                                    return ride.role === 'requester' ? 'SOLICITANTE' : 'PASAJERO';
                                })()
                            )}
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
                                <span className="text-[9px] font-bold uppercase tracking-widest italic">Wait...</span>
                            </div>
                        )}
                        {/* Indicador de asientos */}
                        {ride.seats_available > 0 && (
                            <div className="px-2 py-1 rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 flex items-center ml-2">
                                {ride.seats_available} LIBRES
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
    const [activeTab, setActiveTab] = useState('active'); // active, requested, history, cancelled
    const [rides, setRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);

    const fetchRidesDirect = async (id) => {
        setLoading(true);
        try {
            // USANDO LA NUEVA RPC V2 QUE INCLUYE SOLICITUDES PENDIENTES
            const { data, error } = await supabase.rpc('fetch_my_activity_v2', { p_user_id: id });

            if (error) {
                // Fallback a v1 si v2 no existe aún (durante migración)
                console.warn("Retrying with v1 due to error:", error);
                const { data: dataV1, error: errorV1 } = await supabase.rpc('fetch_my_activity_v1', { p_user_id: id });
                if (errorV1) throw errorV1;
                setRides(dataV1 || []);
            } else {
                setRides(data || []);
            }
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

                // SUSCRIPCIÓN EN TIEMPO REAL: Refrescar actividad cuando algo cambia
                // Escuchamos cambios en la tabla 'rides' (status, plazas)
                const channel = supabase
                    .channel(`my_activity_${user.id}`)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'rides'
                    }, () => {
                        console.log("🛡️ [MyRides] Activity update detected");
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

    // LÓGICA DE FILTRADO TÉCNICO
    const filteredRides = useMemo(() => {
        const list = Array.isArray(rides) ? rides : [];
        const now = new Date();

        const filtered = list.filter(r => {
            const isActuallyExpired = isStaleOpenRidePastGrace(r, now);

            // Normalize status
            let status = r.status;
            if (isActuallyExpired && status !== 'requested') status = 'expired';

            switch (activeTab) {
                case 'active':
                    // Próximos: Viajes programados/activos donde soy Conductor o Pasajero Confirmado
                    return ['scheduled', 'active', 'in_progress'].includes(status) && (r.role === 'driver' || r.role === 'passenger');
                case 'requested':
                    // Solicitudes: Mis peticiones pendientes de aprobación
                    return r.role === 'requester' && !['completed', 'expired', 'cancelled', 'rejected'].includes(status);
                case 'history':
                    return ['completed', 'expired'].includes(status);
                case 'cancelled':
                    return ['cancelled', 'rejected'].includes(status);
                default:
                    return false;
            }
        }).sort((a, b) => {
            // Ordenar: Próximos primero para activos/solicitados, Recientes primero para historial/cancelados
            const dateA = new Date(a.departure_time);
            const dateB = new Date(b.departure_time);
            if (['history', 'cancelled'].includes(activeTab)) {
                return dateB - dateA; // Descendente (más reciente primero)
            } else {
                return dateA - dateB; // Ascendente (más próximo primero)
            }
        });
        return filtered;
    }, [rides, activeTab]);

    const tabs = [
        { id: 'active', label: 'Próximos', icon: Calendar },
        { id: 'requested', label: 'Solicitudes', icon: Users },
        { id: 'history', label: 'Historial', icon: CheckCircle },
        { id: 'cancelled', label: 'Cancelados', icon: XCircle },
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <header className="bg-white/80 backdrop-blur-xl px-6 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between shadow-sm"
                    style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: '1.5rem' }}>
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div className="text-left">
                        <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Actividad</h1>
                        <p className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mt-1">Tus Viajes</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-xl size-10 text-slate-300 hover:text-primary" onClick={() => userId && fetchRidesDirect(userId)}>
                    <RefreshCw className={cn("size-5", loading && "animate-spin")} />
                </Button>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8">
                {/* Scrollable Tabs */}
                <div className="flex overflow-x-auto pb-4 gap-2 no-scrollbar">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "px-4 py-3 rounded-2xl flex items-center gap-2 whitespace-nowrap transition-all border",
                                    isActive
                                        ? "bg-slate-900 text-white border-slate-900 shadow-md transform scale-105"
                                        : "bg-white text-slate-500 border-slate-100 hover:bg-slate-50"
                                )}
                            >
                                <Icon size={14} className={isActive ? "text-primary" : "text-slate-400"} />
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
                            <RideCard key={ride.id} ride={ride} navigate={navigate} currentUserId={userId} />
                        ))
                    ) : (
                        <div className="text-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-inner">
                            <Car className="h-12 w-12 text-slate-100 mx-auto mb-6" />
                            <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">Sin Resultados</h3>
                            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest px-8">
                                No tienes viajes en esta sección
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default MyRides;
