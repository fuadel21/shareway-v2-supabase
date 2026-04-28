import { useState, useEffect } from 'react';
import { Car, UserCheck, Users, Hourglass, DollarSign, BarChart, Banknote, Loader2, AlertCircle, RefreshCw, Leaf, Building2, Navigation, Activity, Clock, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlatformStats, requestPlatformPayout, getPlatformAuditLogs } from '@/lib/supabaseRPC';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import PendingVerificationsTab from './tabs/PendingVerificationsTab';
import UserManagementTab from './tabs/UserManagementTab';
import RideManagementTab from './tabs/RideManagementTab';
import FinanceTab from './tabs/FinanceTab';
import DisputesTab from './tabs/DisputesTab';
import MaintenanceTab from './tabs/MaintenanceTab';
import ClimateTab from './tabs/ClimateTab';
import CommunitiesTab from './tabs/CommunitiesTab';

const StatCard = ({ title, value, icon, description, currency = '', loading = false, trend = null }) => (
    <Card className="rounded-2xl border-none shadow-sm overflow-hidden text-left group hover:shadow-md transition-all">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</CardTitle>
            <div className="bg-primary/5 p-2 rounded-xl text-primary group-hover:scale-110 transition-transform">{icon}</div>
        </CardHeader>
        <CardContent>
            {loading ? (
                <Skeleton className="h-8 w-3/4" />
            ) : (
                <div className="flex items-baseline gap-1">
                    <div className="text-2xl font-black tracking-tighter italic">{value}{currency}</div>
                    {trend && <span className="text-[10px] font-bold text-emerald-500">+{trend}%</span>}
                </div>
            )}
            {description && <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight mt-1">{description}</p>}
        </CardContent>
    </Card>
);

/**
 * AdminDashboard Component
 * Central management hub for platform administrators.
 */
function AdminDashboard() {
    const { tab = 'verifications' } = useParams();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [recentActivity, setRecentActivity] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isPayoutLoading, setIsPayoutLoading] = useState(false);

    const fetchPlatformData = async () => {
        setLoading(true);
        try {
            const [statsRes, auditRes] = await Promise.all([
                getPlatformStats(),
                getPlatformAuditLogs('all', 5)
            ]);

            if (statsRes?.success) {
                setStats(statsRes.data.stats || statsRes.data);
            }
            if (auditRes?.success) {
                setRecentActivity(auditRes.data || []);
            }
        } catch (error) {
            toast.error("Error al sincronizar datos");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlatformData();

        // 📡 SUSCRIPCIÓN EN TIEMPO REAL AL RADAR
        const channel = supabase
            .channel('admin-radar')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'platform_audit_logs' },
                (payload) => {
                    setRecentActivity(prev => [payload.new, ...prev.slice(0, 4)]);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const handlePayout = async () => {
        setIsPayoutLoading(true);
        try {
            const result = await requestPlatformPayout();
            if (result?.success) {
                toast.success("Retiro solicitado con éxito");
                await fetchPlatformData();
            }
        } catch (error) {
            toast.error("Error al retirar");
        } finally {
            setIsPayoutLoading(false);
        }
    };

    // Datos simulados para el gráfico de crecimiento (En producción vendrían de una RPC de series temporales)
    const chartData = [
        { name: 'Lun', profit: (stats?.platform_profit || 0) * 0.4 },
        { name: 'Mar', profit: (stats?.platform_profit || 0) * 0.5 },
        { name: 'Mie', profit: (stats?.platform_profit || 0) * 0.7 },
        { name: 'Jue', profit: (stats?.platform_profit || 0) * 0.6 },
        { name: 'Vie', profit: (stats?.platform_profit || 0) * 0.9 },
        { name: 'Sab', profit: (stats?.platform_profit || 0) * 1.1 },
        { name: 'Dom', profit: stats?.platform_profit || 0 },
    ];

    return (
        <div className="space-y-8 text-left p-6 pb-20 max-w-[1600px] mx-auto animate-in fade-in duration-700">
            {/* Cabecera y Radar en Vivo */}
            <div className="flex flex-col xl:flex-row justify-between items-start gap-8">
                <div className="space-y-2">
                    <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-slate-900">Centro de Mando</h1>
                    <div className="flex items-center gap-3">
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-none font-black text-[9px] px-3 py-1 animate-pulse">SISTEMA ONLINE</Badge>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">ShareWay Elite v2.5</p>
                    </div>
                </div>

                {/* Radar de Actividad Pro */}
                <div className="flex-1 max-w-3xl w-full bg-slate-900 rounded-[2.5rem] p-5 flex items-center gap-6 border border-white/10 shadow-[0_0_50px_-12px_rgba(59,130,246,0.5)] relative overflow-hidden group">
                    {/* Efecto de barrido de radar */}
                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0%,rgba(59,130,246,0.1)_50%,transparent_100%)] animate-[spin_4s_linear_infinite] pointer-events-none" />

                    <div className="relative size-12 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30">
                        <Activity className="size-6 text-primary animate-pulse" />
                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
                        </span>
                    </div>

                    <div className="flex-1 overflow-hidden relative z-10">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-primary italic">Live Elite Stream</p>
                            <div className="h-[1px] flex-1 bg-gradient-to-r from-primary/50 to-transparent" />
                        </div>

                        <div className="h-6 overflow-hidden">
                            {recentActivity.length > 0 ? (
                                <div className="flex items-center gap-3 animate-in slide-in-from-bottom-full duration-500">
                                    {/* Icono dinámico según acción */}
                                    {recentActivity[0].action.includes('RIDE') ? <Car className="size-3 text-emerald-400" /> :
                                     recentActivity[0].action.includes('USER') ? <UserCheck className="size-3 text-blue-400" /> :
                                     <Activity className="size-3 text-amber-400" />}

                                    <p className="text-sm font-bold text-white truncate">
                                        <span className="text-primary italic mr-2">
                                            {recentActivity[0].action.replace(/_/g, ' ')}
                                        </span>
                                        {recentActivity[0].new_value?.origin ? (
                                            <span className="text-slate-400 font-medium">de {recentActivity[0].new_value.origin.substring(0, 15)}...</span>
                                        ) : (
                                            <span className="text-slate-400 font-medium italic">Ref: {(recentActivity[0].target_key || '').substring(0, 8)}</span>
                                        )}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-xs font-bold text-slate-500 italic animate-pulse">Escaneando red ShareWay...</p>
                            )}
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        onClick={() => navigate('/admin/maintenance')}
                        className="relative z-10 text-white hover:bg-white/10 rounded-2xl px-6 h-12 font-black text-[11px] uppercase tracking-tighter gap-3 border border-white/5"
                    >
                        Logs <ArrowRight className="size-4" />
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3 xl:grid-cols-4">
                {/* Card de Tesorería Destacada */}
                <Card className="rounded-[2.5rem] border-none shadow-2xl overflow-hidden bg-slate-900 text-white lg:col-span-1 xl:col-span-1 relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-700">
                        <DollarSign className="size-32" />
                    </div>
                    <CardHeader className="p-8 pb-4">
                        <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-500">Tesorería Total</CardTitle>
                        <div className="text-5xl font-black italic tracking-tighter mt-2 group-hover:text-primary transition-colors">
                            {loading ? <Skeleton className="h-12 w-32 bg-slate-800" /> : (stats?.platform_profit || 0).toFixed(2)}<span className="text-2xl ml-1 text-slate-500">€</span>
                        </div>
                    </CardHeader>
                    <CardContent className="px-8 pb-8">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">Comisiones por gestión de trayectos e integridad financiera.</p>
                        <Button
                            onClick={handlePayout}
                            disabled={isPayoutLoading || (stats?.platform_profit || 0) <= 0}
                            className="w-full mt-6 h-14 rounded-2xl bg-white text-slate-900 hover:bg-primary hover:text-white font-black uppercase tracking-tight text-xs shadow-xl active:scale-95 transition-all gap-3"
                        >
                            {isPayoutLoading ? <Loader2 className="animate-spin" /> : <Banknote className="size-5" />} Liquidar Fondos
                        </Button>
                    </CardContent>
                </Card>

                {/* Gráfico de Crecimiento */}
                <Card className="lg:col-span-2 xl:col-span-2 rounded-[2.5rem] border-none shadow-xl bg-white overflow-hidden p-8">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <CardTitle className="text-lg font-black italic uppercase tracking-tighter">Salud Financiera</CardTitle>
                            <CardDescription className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">Evolución de beneficios (Últimos 7 días)</CardDescription>
                        </div>
                        <Badge className="bg-blue-50 text-blue-600 border-none font-black px-3">+12% vs sem. pasada</Badge>
                    </div>
                    <div className="h-[200px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold', fill: '#94a3b8'}} />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                                    formatter={(value) => [`${value.toFixed(2)}€`, 'Beneficio']}
                                />
                                <Area type="monotone" dataKey="profit" stroke="#3b82f6" strokeWidth={4} fillOpacity={1} fill="url(#colorProfit)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Stats Secundarios */}
                <div className="grid gap-4">
                    <StatCard title="Ecología" value={parseFloat(stats?.co2_saved_kg || 0).toFixed(1)} currency="kg" icon={<Leaf />} trend={5.2} loading={loading} />
                    <StatCard title="Comunidad" value={stats?.active_users || 0} icon={<Users />} trend={1.8} loading={loading} />
                </div>
            </div>

            {/* Navegación por Pestañas */}
            <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden min-h-[700px] bg-white">
                <CardContent className="p-4 lg:p-8">
                    <Tabs value={tab} onValueChange={(v) => navigate(`/admin/${v}`)} className="w-full">
                        <TabsList className="flex w-full overflow-x-auto mb-10 bg-slate-50 p-1.5 rounded-[1.5rem] gap-1 no-scrollbar justify-start border border-slate-100/50">
                            {[
                                { val: 'verifications', label: 'DNI/KYC', icon: UserCheck },
                                { val: 'users', label: 'Usuarios', icon: Users },
                                { val: 'rides', label: 'Viajes', icon: Car },
                                { val: 'finance', label: 'Finanzas', icon: DollarSign },
                                { val: 'disputes', label: 'Disputas', icon: AlertCircle },
                                { val: 'communities', label: 'Nodos', icon: Building2 },
                                { val: 'maintenance', label: 'Soporte', icon: RefreshCw }
                            ].map((t) => (
                                <TabsTrigger key={t.val} value={t.val} className="rounded-xl px-5 py-3 data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all whitespace-nowrap flex-shrink-0 text-[10px] font-black uppercase tracking-widest gap-2 h-12 border border-transparent data-[state=active]:border-slate-100">
                                    <t.icon className="h-4 w-4" /> {t.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                            {/* ... Contenidos de las pestañas ... */}
                            <TabsContent value="verifications" className="mt-0 focus-visible:outline-none">
                                <PendingVerificationsTab />
                            </TabsContent>
                            <TabsContent value="users" className="mt-0 focus-visible:outline-none">
                                <UserManagementTab />
                            </TabsContent>
                            <TabsContent value="rides" className="mt-0 focus-visible:outline-none">
                                <RideManagementTab />
                            </TabsContent>
                            <TabsContent value="finance" className="mt-0 focus-visible:outline-none">
                                <FinanceTab stats={stats} loading={loading} />
                            </TabsContent>
                            <TabsContent value="disputes" className="mt-0 focus-visible:outline-none">
                                <DisputesTab />
                            </TabsContent>
                            <TabsContent value="communities" className="mt-0 focus-visible:outline-none">
                                <CommunitiesTab />
                            </TabsContent>
                            <TabsContent value="maintenance" className="mt-0 focus-visible:outline-none">
                                <MaintenanceTab />
                            </TabsContent>
                        </div>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}

export default AdminDashboard;
