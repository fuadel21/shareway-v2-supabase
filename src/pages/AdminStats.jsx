import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useOutletContext } from 'react-router-dom';
import {
    AlertCircle,
    Car,
    ChevronLeft,
    DollarSign,
    Leaf,
    RefreshCw,
    ShieldCheck,
    TrendingUp,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const StatCard = ({ title, value, icon: Icon, color, subtitle }) => (
    <Card className="p-6 rounded-[2.5rem] border-none shadow-xl bg-white space-y-4">
        <div className="flex justify-between items-start">
            <div className={cn('p-4 rounded-2xl', color)}>
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
    const { isAdmin } = useOutletContext();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(Boolean(isAdmin));
    const [loadError, setLoadError] = useState(null);

    const fetchStats = useCallback(async () => {
        if (!isAdmin) return;

        setLoading(true);
        setLoadError(null);

        try {
            const { data, error } = await supabase.rpc('get_platform_admin_stats');
            if (error) throw error;
            setStats(data);
        } catch (error) {
            console.error('Error fetching admin stats:', error);
            setLoadError(error?.message || 'No se pudieron cargar las estadísticas.');
            toast.error('Error al cargar estadísticas');
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    if (!isAdmin) {
        return <Navigate to="/dashboard" replace />;
    }

    if (loading && !stats) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
                <RefreshCw className="size-10 text-primary animate-spin mb-4" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Generando reporte...</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-20">
            <header className="bg-white/80 backdrop-blur-md px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-100 size-12 shadow-sm" onClick={() => navigate('/admin/verifications')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Estadísticas</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Control de plataforma</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-xl size-10 text-slate-300 hover:text-primary" onClick={fetchStats} disabled={loading}>
                    <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
                </Button>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
                {loadError && (
                    <Card className="rounded-3xl border border-red-100 bg-red-50 p-5 text-red-700 flex items-start gap-3">
                        <AlertCircle className="size-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-black">No se pudieron cargar los datos</p>
                            <p className="text-sm font-semibold mt-1">{loadError}</p>
                        </div>
                    </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <StatCard title="Beneficio plataforma" value={`${Number(stats?.platform_profit || 0).toFixed(2)}€`} icon={DollarSign} color="bg-emerald-500" subtitle="Comisión neta ShareWay" />
                    <StatCard title="Volumen total" value={`${Number(stats?.total_revenue || 0).toFixed(2)}€`} icon={TrendingUp} color="bg-indigo-500" subtitle="Total transaccionado" />
                    <StatCard title="Huella de carbono" value={`${Number(stats?.co2_saved_kg || 0).toFixed(1)}kg`} icon={Leaf} color="bg-teal-500" subtitle="CO₂ evitado al compartir" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <StatCard title="Viajes completados" value={stats?.completed_rides ?? 0} icon={Car} color="bg-slate-900" subtitle="Trayectos finalizados" />
                    <StatCard title="Usuarios activos" value={stats?.active_users ?? 0} icon={Users} color="bg-orange-500" subtitle="Actividad de los últimos 30 días" />
                </div>

                <Card className="p-8 rounded-[3rem] bg-slate-900 text-white shadow-2xl">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="text-primary size-6" />
                        <div>
                            <h4 className="text-lg font-black uppercase italic tracking-tight">Acceso administrativo protegido</h4>
                            <p className="text-sm font-semibold text-slate-300 mt-1">Esta pantalla y su RPC solo se solicitan después de validar el rol administrador.</p>
                        </div>
                    </div>
                </Card>
            </main>
        </div>
    );
};

function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export default AdminStats;
