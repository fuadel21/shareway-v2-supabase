import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { format, isPast, isValid, subMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import {
    Calendar, CheckCheck, Clock, Ban,
    Archive, Car, ArrowUpRight, Zap,
    ChevronLeft, Leaf, TrendingUp, Sprout, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { calculateImpact, formatImpactDisplay, getImpactEquivalency } from '@/utils/climateImpact';

const RideCard = ({ ride, navigate, currentUser, index }) => {
    const originAddress = ride.origin?.address?.split(',')[0] || ride.origin?.name || 'Origen desconocido';
    const destinationAddress = ride.destination?.address?.split(',')[0] || ride.destination?.name || 'Destino desconocido';
    
    const isDriver = ride.driver_id === currentUser?.id;
    const dateObj = ride.departure_time ? new Date(ride.departure_time) : null;
    const timeLabel = (dateObj && isValid(dateObj)) ? format(dateObj, "HH:mm", { locale: es }) : "--:--";

    const impact = useMemo(() => {
        if (ride.co2_saved && parseFloat(ride.co2_saved) > 0) {
            return { savedKg: parseFloat(ride.co2_saved), ...formatImpactDisplay(parseFloat(ride.co2_saved)) };
        }
        if (!ride.distance) return null;
        const distKm = parseFloat(ride.distance);
        const { savedKg } = calculateImpact(distKm, 1);
        return { savedKg, ...formatImpactDisplay(savedKg) };
    }, [ride.distance, ride.co2_saved]);

    const STATUS_THEMES = {
        scheduled: { text: 'PROGRAMADO', icon: Calendar, bg: 'bg-indigo-50 text-indigo-600 border-indigo-100', dot: 'bg-indigo-500' },
        active: { text: 'EN CURSO', icon: Zap, bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500 animate-pulse' },
        completed: { text: 'COMPLETADO', icon: CheckCheck, bg: 'bg-slate-50 text-slate-400 border-slate-100', dot: 'bg-slate-300' },
        cancelled: { text: 'CANCELADO', icon: Ban, bg: 'bg-red-50 text-red-500 border-red-100', dot: 'bg-red-500' },
        expired: { text: 'CADUCADO', icon: Archive, bg: 'bg-orange-50 text-orange-400 border-orange-100', dot: 'bg-orange-400' }
    };

    let effectiveStatus = ride.status;
    // Si la fecha ya pasó y el viaje sigue programado, lo mostramos como caducado
    if (dateObj && isPast(dateObj) && ride.status === 'scheduled') effectiveStatus = 'expired';
    const currentTheme = STATUS_THEMES[effectiveStatus] || STATUS_THEMES.scheduled;

    return (
        <div
            className="group relative overflow-hidden rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-primary/5 transition-all duration-500 cursor-pointer bg-white flex flex-col animate-in fade-in slide-in-from-bottom-4"
            style={{ animationDelay: `${index * 100}ms` }}
            onClick={() => navigate(`/ride/${ride.id}`)}
        >
            <div className="p-8 flex items-center justify-between border-b border-slate-50/50">
                <div className="flex items-center gap-5">
                    <div className="bg-slate-950 text-white size-14 rounded-[1.5rem] flex flex-col items-center justify-center shadow-xl rotate-3 group-hover:rotate-0 transition-transform duration-500">
                        <span className="text-[9px] font-black uppercase opacity-40 leading-none mb-1">
                            {dateObj ? format(dateObj, "MMM", { locale: es }) : '---'}
                        </span>
                        <span className="text-2xl font-black italic leading-none">
                            {dateObj ? format(dateObj, "dd") : '--'}
                        </span>
                    </div>
                    <div>
                        <div className={cn("px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-2 border mb-2", currentTheme.bg)}>
                            <div className={cn("h-1.5 w-1.5 rounded-full", currentTheme.dot)} />
                            {currentTheme.text}
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock className="size-3 text-slate-400" />
                            <p className="text-xs font-black text-slate-900 uppercase italic tracking-tighter">{timeLabel} • {isDriver ? 'CONDUCES' : 'VIAJAS'}</p>
                        </div>
                    </div>
                </div>
                <div className="size-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-primary group-hover:text-white transition-all duration-500">
                    <ArrowUpRight className="size-6" />
                </div>
            </div>

            <div className="p-8 space-y-4 relative bg-gradient-to-b from-white to-slate-50/30">
                <div className="absolute left-[2.45rem] top-12 bottom-12 w-0.5 bg-slate-100" />
                <div className="flex items-center gap-6 relative z-10">
                    <div className="size-4 rounded-full bg-emerald-500 ring-8 ring-emerald-50 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Origen</p>
                        <p className="text-sm font-bold text-slate-600 truncate uppercase tracking-tight">{originAddress}</p>
                    </div>
                </div>
                <div className="flex items-center gap-6 relative z-10">
                    <div className="size-4 rounded-full bg-primary ring-8 ring-primary/10 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Destino</p>
                        <p className="text-sm font-black text-slate-900 truncate uppercase tracking-tight italic">{destinationAddress}</p>
                    </div>
                </div>
            </div>

            {effectiveStatus === 'completed' && impact && (
                <div className="px-8 pb-8 pt-0">
                    <div className="bg-emerald-950 rounded-[2rem] p-5 flex items-center gap-4 relative overflow-hidden group/impact">
                        <div className="absolute -right-4 -bottom-4 opacity-10 group-hover/impact:scale-125 transition-transform duration-700">
                            <Leaf size={80} className="text-emerald-400 rotate-12" />
                        </div>
                        <div className="size-12 bg-emerald-400 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-400/20 shrink-0 z-10">
                            <Sprout className="h-6 w-6 text-emerald-950" />
                        </div>
                        <div className="z-10 flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[8px] font-black text-emerald-400 uppercase tracking-[0.3em]">Misión Cumplida</span>
                                <div className="h-px flex-1 bg-emerald-400/10" />
                            </div>
                            <p className="text-white font-medium leading-none">
                                <span className="text-[10px] opacity-60 uppercase mr-1">CO₂ REDUCIDO:</span>
                                <span className="font-black text-lg italic text-emerald-400">{impact.value}</span>
                                <span className="text-[10px] opacity-60 ml-1 uppercase">{impact.unit}</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const MyRides = () => {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('upcoming');
    const [myRides, setMyRides] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchRides = useCallback(async () => {
        if (!user?.id) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('rides')
                .select(`*, driver:profiles!driver_id(id, display_name, photo_url, avatar_url)`)
                .or(`driver_id.eq.${user.id},participant_ids.cs.{${user.id}}`)
                .order('departure_time', { ascending: false });

            if (error) throw error;
            setMyRides(data || []);
        } catch (e) {
            console.error("Fetch rides failed:", e);
            toast.error("Error al sincronizar tu historial.");
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => { fetchRides(); }, [fetchRides]);

    const { upcoming, history, totalSaved } = useMemo(() => {
        const now = new Date();
        
        // FASE 19: Lógica de segmentación estricta
        const upcomingRides = myRides.filter(r => {
            const isFutureRide = new Date(r.departure_time) >= now;
            const isOngoing = r.status === 'active';
            const isScheduled = r.status === 'scheduled';
            
            // Solo mostramos en PRÓXIMOS si es futuro+programado O si está activo (en curso)
            return (isScheduled && isFutureRide) || isOngoing;
        }).sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));

        const historyRides = myRides.filter(r => {
            const isPastRide = new Date(r.departure_time) < now;
            const isFinalized = ['completed', 'cancelled', 'expired'].includes(r.status);
            const isForgotten = r.status === 'scheduled' && isPastRide;

            // Pasan al HISTORIAL si están finalizados O si son programados pero la fecha ya pasó
            return isFinalized || isForgotten;
        }).sort((a, b) => new Date(b.departure_time) - new Date(a.departure_time));

        const total = myRides.reduce((acc, ride) => {
            if (ride.status === 'completed') {
                return acc + (parseFloat(ride.co2_saved) || 0);
            }
            return acc;
        }, 0);

        return { upcoming: upcomingRides, history: historyRides, totalSaved: total };
    }, [myRides]);

    const itemsToShow = activeTab === 'upcoming' ? upcoming : history;

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 hover:bg-slate-100" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Actividad</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 italic">Gestión de trayectos</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8">
                {(profile?.total_co2_saved > 0 || totalSaved > 0) && (
                    <Card className="rounded-[2.5rem] border-none shadow-2xl bg-slate-900 overflow-hidden relative group animate-in zoom-in duration-700">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-1000">
                            <Leaf size={120} className="text-emerald-400 rotate-12" />
                        </div>
                        <CardContent className="p-8 relative z-10">
                            <div className="flex justify-between items-start mb-6">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em]">Impacto Climático</p>
                                    <h2 className="text-white text-4xl font-black italic tracking-tighter leading-none">
                                        {(parseFloat(profile?.total_co2_saved || totalSaved)).toFixed(1)}
                                        <span className="text-xl ml-1 opacity-50">kg CO₂</span>
                                    </h2>
                                </div>
                                <div className="size-14 bg-emerald-500/20 rounded-[1.5rem] flex items-center justify-center border border-emerald-500/30 backdrop-blur-xl">
                                    <TrendingUp className="text-emerald-400 size-7" />
                                </div>
                            </div>
                            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 flex items-center gap-4">
                                <div className="size-10 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
                                    <Sprout className="text-emerald-400 size-5" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Equivalencia</p>
                                    <p className="text-xs text-white font-medium italic">
                                        {getImpactEquivalency(profile?.total_co2_saved || totalSaved)}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <div className="flex p-2 bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
                    {['upcoming', 'history'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                                "flex-1 h-16 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all duration-500 relative overflow-hidden group",
                                activeTab === tab ? "bg-slate-950 text-white shadow-2xl scale-[1.02]" : "text-slate-400 hover:text-slate-600"
                            )}
                        >
                            <span className="relative z-10">{tab === 'upcoming' ? 'PRÓXIMOS' : 'HISTORIAL'}</span>
                            {activeTab === tab && <div className="absolute inset-0 bg-gradient-to-r from-slate-900 to-slate-800 animate-pulse opacity-50" />}
                        </button>
                    ))}
                </div>

                <div className="space-y-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="animate-spin text-primary size-8" />
                            <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Sincronizando...</p>
                        </div>
                    ) : itemsToShow.length > 0 ? (
                        itemsToShow.map((ride, idx) => <RideCard key={ride.id} ride={ride} navigate={navigate} currentUser={user} index={idx} />)
                    ) : (
                        <div className="text-center py-24 bg-white rounded-[2.5rem] border border-dashed border-slate-200 animate-in fade-in duration-700">
                            <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Car className="h-10 w-10 text-slate-200" />
                            </div>
                            <h3 className="text-sm font-black text-slate-900 uppercase italic mb-1">Bandeja vacía</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No hay registros en esta sección</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default MyRides;
