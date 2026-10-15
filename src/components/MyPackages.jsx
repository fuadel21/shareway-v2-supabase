import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useNavigate, Link } from 'react-router-dom';
import { getUserPackages } from '@/services/packageService';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import {
    Loader2, Package, CheckCheck, Clock, Ban, Archive,
    Navigation, MapPin, ChevronRight, Sparkles, History,
    Plus, Box, Truck, User, ArrowRightLeft
} from 'lucide-react';
import SubPageHeader from './SubPageHeader';

const ListItem = ({ item, navigate, currentUser, index }) => {
    const originAddress = item.origin_address?.split(',')[0] || 'Origen';
    const destinationAddress = item.destination_address?.split(',')[0] || 'Destino';
    const isSender = item.sender_id === currentUser?.id;

    // Supabase returns string for dates
    const dateObj = new Date(item.delivery_by);
    const day = format(dateObj, "dd", { locale: es });
    const month = format(dateObj, "MMM", { locale: es }).toUpperCase();
    const formattedDate = format(dateObj, "d MMM", { locale: es });

    let statusInfo = { text: '-', icon: Package, color: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' };
    if (item.status === 'pending') statusInfo = { text: 'Pendiente', icon: Clock, color: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' };
    if (item.status === 'accepted') statusInfo = { text: 'Aceptado', icon: CheckCheck, color: 'bg-indigo-50 text-indigo-600', dot: 'bg-indigo-500' };
    if (item.status === 'picked_up') statusInfo = { text: 'En ruta', icon: Truck, color: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500 animate-pulse' };
    if (item.status === 'completed') statusInfo = { text: 'Entregado', icon: Sparkles, color: 'bg-slate-100 text-slate-400', dot: 'bg-slate-300' };
    if (item.status === 'cancelled') statusInfo = { text: 'Cancelado', icon: Ban, color: 'bg-red-50 text-red-500', dot: 'bg-red-500' };

    return (
        <Card
            className="group relative overflow-hidden rounded-3xl border-none shadow-[0_30px_60px_rgba(0,0,0,0.06)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.1)] hover:scale-[1.02] transition-all duration-700 cursor-pointer animate-in fade-in slide-in-from-bottom-8 bg-white/60 backdrop-blur-3xl mb-8"
            style={{ animationDelay: `${index * 100}ms` }}
            onClick={() => navigate(`/package/${item.id}`)}
        >
            <div className="p-10">
                <div className="flex justify-between items-start mb-10">
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col items-center justify-center h-20 w-20 rounded-3xl bg-navy text-white shadow-2xl relative overflow-hidden group-hover:bg-primary transition-colors duration-500">
                            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1 opacity-50 relative z-10">{month}</span>
                            <span className="text-3xl font-black leading-none relative z-10 tracking-tighter">{day}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <span className={cn(
                                    "px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border-2",
                                    isSender ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-indigo-50 text-indigo-600 border-indigo-100"
                                )}>
                                    {isSender ? 'ENVÍAS' : 'TRANSPORTAS'}
                                </span>
                                <div className={cn("px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] flex items-center gap-2", statusInfo.color)}>
                                    <div className={cn("h-2 w-2 rounded-full", statusInfo.dot)} />
                                    {statusInfo.text}
                                </div>
                            </div>
                            <p className="text-xs font-bold text-slate-400 pl-1 uppercase tracking-widest">{item.price?.toFixed(2)}€ • {item.size?.toUpperCase()}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-6 relative">
                    <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-indigo-500 via-primary to-primary opacity-20" />

                    <div className="flex items-center gap-6 relative z-10 group/loc">
                        <div className="size-6 rounded-full bg-white border-4 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)] group-hover/loc:scale-125 transition-transform" />
                        <div>
                            <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] mb-1">RECOGIDA</p>
                            <p className="font-bold text-slate-500 uppercase tracking-widest text-xs truncate max-w-[200px]">{originAddress}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6 relative z-10 group/loc">
                        <div className="size-6 rounded-full bg-white border-4 border-primary shadow-[0_0_15px_rgba(249,115,22,0.3)] group-hover/loc:scale-125 transition-transform" />
                        <div>
                            <p className="text-[9px] font-black text-primary/40 uppercase tracking-[0.2em] mb-1">ENTREGA</p>
                            <p className="font-black text-2xl text-slate-900 tracking-tighter truncate max-w-[240px] uppercase italic">{destinationAddress}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Decoración premium en esquina */}
            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
                <Box className="size-20 rotate-12 text-slate-900" />
            </div>
        </Card>
    );
};

const MyPackages = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState('active');
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchPackages = async () => {
        if (!user?.id) return;
        setLoading(true);
        try {
            const data = await getUserPackages(user.id);
            setPackages(data);
        } catch (error) {
            console.error("Error al obtener los paquetes:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        fetchPackages();

        const channel = supabase.channel('my_packages_update')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'packages' }, () => fetchPackages())
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    const { active, history } = useMemo(() => {
        const activePkgs = packages
            .filter(p => ['pending', 'accepted', 'picked_up'].includes(p.status))
            .sort((a, b) => new Date(a.delivery_by) - new Date(b.delivery_by));

        const historyPkgs = packages
            .filter(p => ['completed', 'cancelled', 'expired'].includes(p.status))
            .sort((a, b) => new Date(b.delivery_by) - new Date(a.delivery_by));

        return { active: activePkgs, history: historyPkgs };
    }, [packages]);

    const itemsToShow = activeTab === 'active' ? active : history;

    return (
        <div className="bg-slate-50 min-h-screen pb-40">
            <SubPageHeader title="Mis Envíos" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-5">

                {/* SELECTOR DE PESTAÑAS PREMIUM */}
                <div className="flex p-2 bg-white/60 backdrop-blur-3xl rounded-3xl shadow-2xl border border-white/60">
                    <button
                        onClick={() => setActiveTab('active')}
                        className={cn(
                            "flex-1 h-12 rounded-3xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-700 flex items-center justify-center gap-3",
                            activeTab === 'active' ? "bg-navy text-white shadow-2xl scale-100" : "text-slate-400 hover:bg-slate-50 scale-95"
                        )}
                    >
                        <Box className={cn("h-4 w-4 transition-colors", activeTab === 'active' ? "text-primary" : "text-slate-300")} />
                        ACTIVOS
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={cn(
                            "flex-1 h-12 rounded-3xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-700 flex items-center justify-center gap-3",
                            activeTab === 'history' ? "bg-navy text-white shadow-2xl scale-100" : "text-slate-400 hover:bg-slate-50 scale-95"
                        )}
                    >
                        <History className={cn("h-4 w-4 transition-colors", activeTab === 'history' ? "text-indigo-400" : "text-slate-300")} />
                        HISTORIAL
                    </button>
                </div>

                <div className="space-y-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-40 space-y-8 animate-pulse">
                            <div className="h-24 w-24 rounded-3xl bg-slate-200 flex items-center justify-center">
                                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                            </div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Sincronizando envíos...</p>
                        </div>
                    ) : itemsToShow.length > 0 ? (
                        itemsToShow.map((item, idx) => (
                            <ListItem key={item.id} item={item} navigate={navigate} currentUser={user} index={idx} />
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-40 text-center animate-in fade-in duration-1000 space-y-10">
                            <div className="relative group">
                                <div className="absolute inset-0 bg-primary/20 blur-3xl opacity-20 rounded-full" />
                                <div className="size-32 bg-white rounded-3xl shadow-2xl flex items-center justify-center border border-slate-50 relative z-10 scale-110 group-hover:rotate-12 transition-transform duration-700">
                                    <Package className="size-14 text-slate-100" />
                                </div>
                                <div className="absolute -top-4 -right-4 size-12 bg-primary rounded-2xl flex items-center justify-center shadow-2xl border-4 border-white z-20 animate-bounce">
                                    <Plus className="size-6 text-white" />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <p className="font-black text-slate-900 text-3xl tracking-tighter uppercase italic">Bandeja Vacía</p>
                                <p className="text-sm font-bold text-slate-400 max-w-[240px] mx-auto leading-relaxed uppercase tracking-widest text-[9px]">
                                    {activeTab === 'active'
                                        ? "No tienes envíos en curso. ¿Necesitas mandar algo?"
                                        : "Tu historial de envíos está limpio."}
                                </p>
                            </div>
                            <Button
                                onClick={() => navigate('/create-package')}
                                className="h-12 px-12 rounded-3xl bg-navy text-white font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-navy/40 hover:scale-[1.05] active:scale-95 transition-all"
                            >
                                NUEVO ENVÍO
                            </Button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default MyPackages;
