import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    TrendingUp, Users, Car, Leaf, DollarSign,
    ChevronLeft, RefreshCw, ShieldCheck, AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

const StatCard = ({ title, value, icon: Icon, color, subtitle }) => (
    <Card className="p-6 rounded-[2.5rem] border-none shadow-xl bg-white space-y-4">
        <div className="flex justify-between items-start">
            <div className={cn("p-4 rounded-2xl", color)}>
                <Icon className="size-6 text-white" />
            </div>
            <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">{title}</p>
                <h3 className="text-3xl font-black text-slate-900 tracking-tighter italic leading-none">{value}</h3>
            </div>
        </div>
        {subtitle && (
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter pt-2 border-t border-slate-50">
                {subtitle}
            </p>
        )}
    </Card>
);

const AdminStats = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_platform_admin_stats');
            if (error) throw error;
            setStats(data);
        } catch (error) {
            console.error('Error fetching admin stats:', error);
            toast.error("Error al cargar estadísticas");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    if (loading && !stats) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
                <RefreshCw className="size-10 text-primary animate-spin mb-4" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Generando Reporte Elite...</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-20">
            <header className="bg-white/80 backdrop-blur-md px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-100 size-12 shadow-sm" onClick={() => navigate(-1)}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Elite Dashboard</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Control de Plataforma</p>
                    </div>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-xl size-10 text-slate-300 hover:text-primary transition-colors"
                    onClick={fetchStats}
                >
                    <RefreshCw className={cn("size-5", loading && "animate-spin")} />
                </Button>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <StatCard
                        title="Beneficio Plataforma"
                        value={`${stats?.platform_profit?.toFixed(2)}€`}
                        icon={DollarSign}
                        color="bg-emerald-500"
                        subtitle="10% Comisión neta ShareWay"
                    />
                    <StatCard
                        title="Volumen Total"
                        value={`${stats?.total_revenue?.toFixed(2)}€`}
                        icon={TrendingUp}
                        color="bg-indigo-500"
                        subtitle="Total transaccionado en la red"
                    />
                    <StatCard
                        title="Huella Carbono"
                        value={`${stats?.co2_saved_kg?.toFixed(1)}kg`}
                        icon={Leaf}
                        color="bg-teal-500"
                        subtitle="CO2 evitado gracias a compartir"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <StatCard
                        title="Viajes Completados"
                        value={stats?.completed_rides}
                        icon={Car}
                        color="bg-slate-900"
                        subtitle="Trayectos finalizados con éxito"
                    />
                    <StatCard
                        title="Usuarios Activos"
                        value={stats?.active_users}
                        icon={Users}
                        color="bg-orange-500"
                        subtitle="Usuarios en los últimos 30 días"
                    />
                </div>

                {/* Status System Check */}
                <Card className="p-8 rounded-[3rem] bg-slate-900 text-white shadow-2xl overflow-hidden relative group">
                    <div className="relative z-10 space-y-6">
                        <div className="flex items-center gap-3">
                            <ShieldCheck className="text-primary size-6" />
                            <h4 className="text-lg font-black uppercase italic tracking-tight">Estado del Sistema</h4>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Integridad Financiera</p>
                                <div className="flex items-center gap-2">
                                    <div className="size-2 rounded-full bg-primary animate-pulse" />
                                    <span className="text-xs font-bold text-white">ÓPTIMA</span>
                                </div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Motor de Pagos 90/10</p>
                                <div className="flex items-center gap-2">
                                    <div className="size-2 rounded-full bg-emerald-400" />
                                    <span className="text-xs font-bold text-white">ACTIVO</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Decoración de fondo */}
                    <div className="absolute -bottom-10 -right-10 size-40 bg-primary/20 rounded-full blur-3xl" />
                </Card>
            </main>
        </div>
    );
};

// Función auxiliar para clases condicionales
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export default AdminStats;
