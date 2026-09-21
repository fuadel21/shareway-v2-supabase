import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    BarChart3,
    BellRing,
    Building2,
    CalendarClock,
    Car,
    CheckCircle2,
    DollarSign,
    Leaf,
    RefreshCw,
    TimerReset,
    UserCheck,
    Users,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { getPlatformAuditLogs, getPlatformStats } from '@/lib/supabaseRPC';
import { supabase } from '@/lib/supabase';
import { getRealAdminMetrics } from '@/services/adminMetricsService.js';

import AdminNotificationsTab from './tabs/AdminNotificationsTab.jsx';
import ClimateTab from './tabs/ClimateTab';
import CommunitiesTab from './tabs/CommunitiesTab';
import DisputesTab from './tabs/DisputesTab';
import EmergencyAlertsTab from './tabs/EmergencyAlertsTab.jsx';
import FinanceTab from './tabs/FinanceTab';
import MaintenanceTab from './tabs/MaintenanceTab';
import PendingVerificationsTab from './tabs/PendingVerificationsTab';
import RideManagementTab from './tabs/RideManagementTab';
import SeoAnalyticsTab from './tabs/SeoAnalyticsTab.jsx';
import UserManagementTab from './tabs/UserManagementTab';

const adminTabs = [
    { val: 'verifications', label: 'DNI/KYC', shortLabel: 'KYC', icon: UserCheck },
    { val: 'users', label: 'Usuarios', shortLabel: 'Usuarios', icon: Users },
    { val: 'rides', label: 'Viajes', shortLabel: 'Viajes', icon: Car },
    { val: 'sos', label: 'Alertas SOS', shortLabel: 'SOS', icon: AlertTriangle },
    { val: 'notifications', label: 'Avisos', shortLabel: 'Avisos', icon: BellRing },
    { val: 'seo', label: 'SEO Analytics', shortLabel: 'SEO', icon: BarChart3 },
    { val: 'finance', label: 'Finanzas', shortLabel: 'Finanzas', icon: DollarSign },
    { val: 'disputes', label: 'Disputas', shortLabel: 'Disputas', icon: AlertCircle },
    { val: 'communities', label: 'Nodos', shortLabel: 'Nodos', icon: Building2 },
    { val: 'climate', label: 'Clima', shortLabel: 'Clima', icon: Leaf },
    { val: 'maintenance', label: 'Soporte', shortLabel: 'Soporte', icon: RefreshCw },
];

const sourceLabels = {
    rides: 'Viajes',
    walletTransactions: 'Ledger financiero',
    profiles: 'Perfiles',
    rideRequests: 'Solicitudes',
};

const emptyChartData = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((name) => ({
    name,
    profit: 0,
    rides: 0,
    bookings: 0,
    users: 0,
}));

const StatCard = ({ title, value, icon, description, currency = '', loading = false }) => (
    <Card className="rounded-2xl border-none shadow-sm overflow-hidden text-left group hover:shadow-md transition-all">
        <CardHeader className="flex flex-row items-center justify-between pb-2 p-5 sm:p-6">
            <CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</CardTitle>
            <div className="bg-primary/5 p-2 rounded-xl text-primary group-hover:scale-110 transition-transform">{icon}</div>
        </CardHeader>
        <CardContent className="px-5 sm:px-6 pb-5 sm:pb-6">
            {loading ? <Skeleton className="h-8 w-3/4" /> : <div className="text-2xl font-black tracking-tighter italic">{value}{currency}</div>}
            {description && <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight mt-1">{description}</p>}
        </CardContent>
    </Card>
);

function AdminDashboard() {
    const { tab = 'verifications' } = useParams();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [realMetrics, setRealMetrics] = useState(null);
    const [recentActivity, setRecentActivity] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRetrying, setIsRetrying] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

    const fetchPlatformData = useCallback(async ({ retry = false } = {}) => {
        retry ? setIsRetrying(true) : setLoading(true);

        try {
            const [statsResult, auditResult, metricsResult] = await Promise.allSettled([
                getPlatformStats(),
                getPlatformAuditLogs('all', 5),
                getRealAdminMetrics({ days: 7 }),
            ]);

            if (statsResult.status === 'fulfilled' && statsResult.value?.success) {
                setStats(statsResult.value.data.stats || statsResult.value.data);
            }

            if (auditResult.status === 'fulfilled' && auditResult.value?.success) {
                setRecentActivity(auditResult.value.data || []);
            }

            if (metricsResult.status === 'fulfilled') {
                setRealMetrics(metricsResult.value);
            }

            const rejected = [statsResult, auditResult, metricsResult].filter((result) => result.status === 'rejected');
            if (rejected.length > 0) {
                toast.warning('Algunos datos no respondieron', {
                    description: 'El resto del Centro de mando continúa disponible.',
                });
            } else if (retry) {
                toast.success('Datos actualizados');
            }

            setLastUpdatedAt(new Date());
        } catch (error) {
            console.error('Admin dashboard sync error:', error);
            toast.error('Error al sincronizar datos');
        } finally {
            setLoading(false);
            setIsRetrying(false);
        }
    }, []);

    useEffect(() => {
        fetchPlatformData();

        const channel = supabase
            .channel('admin-radar')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_audit_logs' }, (payload) => {
                setRecentActivity((previous) => [payload.new, ...previous.slice(0, 4)]);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchPlatformData]);

    const chartData = realMetrics?.chartData?.length ? realMetrics.chartData : emptyChartData;
    const metricTotals = realMetrics?.totals || {};
    const treasuryTotal = Number(stats?.treasury_balance ?? 0);
    const currentTab = adminTabs.find((item) => item.val === tab) || adminTabs[0];
    const sourceHealth = realMetrics?.sourceHealth || {};
    const unavailableSources = realMetrics?.unavailableSources || [];
    const isPartial = Boolean(realMetrics?.isPartial || unavailableSources.length > 0);

    const formattedLastUpdate = useMemo(() => {
        if (!lastUpdatedAt) return 'Sin sincronizar';
        return lastUpdatedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }, [lastUpdatedAt]);

    return (
        <div className="space-y-5 sm:space-y-8 text-left px-3 py-4 sm:p-6 pb-20 max-w-[1600px] mx-auto animate-in fade-in duration-700">
            <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-start gap-4 sm:gap-8">
                <div className="space-y-2 min-w-0">
                    <h1 className="text-3xl sm:text-4xl font-black tracking-tighter uppercase italic leading-none text-slate-900">Centro de Mando</h1>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <Badge className={`${isPartial ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-600'} border-none font-black text-[8px] sm:text-[9px] px-3 py-1`}>
                            {isPartial ? 'DATOS PARCIALES' : 'SISTEMA ONLINE'}
                        </Badge>
                        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-slate-400">Actualizado {formattedLastUpdate}</p>
                    </div>
                </div>

                <div className="flex-1 max-w-3xl w-full bg-slate-900 rounded-[2rem] sm:rounded-[2.5rem] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 border border-white/10 shadow-[0_0_50px_-12px_rgba(59,130,246,0.5)] relative overflow-hidden">
                    <div className="relative flex items-center gap-4 min-w-0 flex-1">
                        <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30">
                            <Activity className="size-6 text-primary animate-pulse" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.25em] text-primary italic mb-1">Actividad en directo</p>
                            {recentActivity.length > 0 ? (
                                <p className="text-xs sm:text-sm font-bold text-white truncate">
                                    <span className="text-primary italic mr-2">{(recentActivity[0].action || 'ACTIVITY').replace(/_/g, ' ')}</span>
                                    <span className="text-slate-400">Ref: {(recentActivity[0].target_key || '').substring(0, 8)}</span>
                                </p>
                            ) : (
                                <p className="text-xs font-bold text-slate-500 italic">Sin actividad reciente</p>
                            )}
                        </div>
                    </div>
                    <Button variant="ghost" onClick={() => navigate('/admin/maintenance')} className="relative z-10 w-full sm:w-auto text-white hover:bg-white/10 rounded-2xl px-6 h-11 font-black text-[10px] uppercase tracking-widest gap-3 border border-white/5">
                        Logs <ArrowRight className="size-4" />
                    </Button>
                </div>
            </div>

            <Card className={`${isPartial ? 'border-amber-200 bg-amber-50/80' : 'border-emerald-200 bg-emerald-50/70'} rounded-[1.75rem] shadow-sm`}>
                <CardContent className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            {isPartial ? <AlertTriangle className="size-5 text-amber-600" /> : <CheckCircle2 className="size-5 text-emerald-600" />}
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900">{isPartial ? 'Centro de mando con datos parciales' : 'Todas las fuentes responden'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(sourceLabels).map(([key, label]) => {
                                const healthy = sourceHealth[key] !== false;
                                return (
                                    <Badge key={key} className={`${healthy ? 'bg-white text-emerald-700' : 'bg-red-100 text-red-700'} border-none text-[9px] font-black uppercase px-3 py-1`}>
                                        {label}: {healthy ? 'OK' : 'No disponible'}
                                    </Badge>
                                );
                            })}
                        </div>
                    </div>
                    <Button onClick={() => fetchPlatformData({ retry: true })} disabled={isRetrying || loading} className="h-11 rounded-2xl px-5 font-black uppercase text-[10px] tracking-widest gap-2 shrink-0">
                        <RefreshCw className={`size-4 ${isRetrying ? 'animate-spin' : ''}`} />
                        {isRetrying ? 'Reintentando' : 'Reintentar datos'}
                    </Button>
                </CardContent>
            </Card>

            <Card className="rounded-[2rem] sm:rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                <CardContent className="p-3 sm:p-4 lg:p-6">
                    <Tabs value={tab} onValueChange={(value) => navigate(`/admin/${value}`)} className="w-full">
                        <div className="mb-4 flex items-center justify-between gap-3 px-1">
                            <div className="min-w-0">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Módulo activo</p>
                                <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 truncate">{currentTab.label}</h2>
                            </div>
                            <Badge className="shrink-0 bg-slate-900 text-white border-none font-black text-[8px] uppercase tracking-widest px-3 py-1">Admin</Badge>
                        </div>
                        <TabsList className="admin-command-tabs flex h-auto w-full overflow-x-auto snap-x snap-mandatory mb-6 bg-slate-50 p-2 rounded-[1.5rem] gap-2 border border-slate-100/50">
                            {adminTabs.map((item) => (
                                <TabsTrigger key={item.val} value={item.val} className="min-w-[92px] min-h-[52px] snap-start rounded-2xl px-3 py-2 data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary text-[9px] font-black uppercase tracking-widest gap-1.5 border border-transparent data-[state=active]:border-slate-100 flex flex-col items-center justify-center leading-none">
                                    <item.icon className="h-4 w-4 shrink-0" />
                                    <span className="truncate max-w-full">{item.shortLabel}</span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <TabsContent value="verifications" className="mt-0"><PendingVerificationsTab /></TabsContent>
                            <TabsContent value="users" className="mt-0"><UserManagementTab /></TabsContent>
                            <TabsContent value="rides" className="mt-0"><RideManagementTab /></TabsContent>
                            <TabsContent value="sos" className="mt-0"><EmergencyAlertsTab /></TabsContent>
                            <TabsContent value="notifications" className="mt-0"><AdminNotificationsTab /></TabsContent>
                            <TabsContent value="seo" className="mt-0"><SeoAnalyticsTab /></TabsContent>
                            <TabsContent value="finance" className="mt-0"><FinanceTab stats={stats} loading={loading} /></TabsContent>
                            <TabsContent value="disputes" className="mt-0"><DisputesTab /></TabsContent>
                            <TabsContent value="communities" className="mt-0"><CommunitiesTab /></TabsContent>
                            <TabsContent value="climate" className="mt-0"><ClimateTab /></TabsContent>
                            <TabsContent value="maintenance" className="mt-0"><MaintenanceTab /></TabsContent>
                        </div>
                    </Tabs>
                </CardContent>
            </Card>

            <div className="grid gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
                <Card className="rounded-[2rem] border-none shadow-2xl overflow-hidden bg-slate-900 text-white relative">
                    <CardHeader className="p-6 pb-4">
                        <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-500">Tesorería disponible</CardTitle>
                        <div className="text-4xl font-black italic tracking-tighter mt-2">{loading ? <Skeleton className="h-12 w-32 bg-slate-800" /> : treasuryTotal.toFixed(2)}<span className="text-2xl ml-1 text-slate-500">€</span></div>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-3">
                        <p className="text-[10px] leading-relaxed font-bold uppercase tracking-wide text-slate-400">
                            Saldo real de la tesorería. Los retiros se autorizan y ejecutan desde el flujo seguro de finanzas.
                        </p>
                        <Button onClick={() => navigate('/admin/finance')} className="w-full h-12 rounded-2xl bg-white text-slate-900 hover:bg-primary hover:text-white font-black uppercase text-xs gap-3">
                            Ver liquidaciones <ArrowRight className="size-4" />
                        </Button>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-2 rounded-[2rem] border-none shadow-xl bg-white overflow-hidden p-5 sm:p-8">
                    <div className="flex items-center justify-between gap-3 mb-6">
                        <div>
                            <CardTitle className="text-base sm:text-lg font-black italic uppercase tracking-tighter">Salud Financiera</CardTitle>
                            <CardDescription className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">Beneficio por día · últimos 7 días</CardDescription>
                        </div>
                        <Badge className="bg-emerald-50 text-emerald-600 border-none font-black px-3">{metricTotals.usedEstimatedProfit ? 'Estimado' : 'Real'}</Badge>
                    </div>
                    <div className="h-[180px] sm:h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
                                <YAxis hide />
                                <Tooltip formatter={(value) => [`${Number(value || 0).toFixed(2)}€`, 'Beneficio']} />
                                <Area type="monotone" dataKey="profit" stroke="#3b82f6" strokeWidth={4} fillOpacity={0.1} fill="#3b82f6" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <StatCard title="Ecología" value={parseFloat(stats?.co2_saved_kg || 0).toFixed(1)} currency="kg" icon={<Leaf />} loading={loading} description="CO₂ reportado" />
                    <StatCard title="Comunidad" value={stats?.active_users || metricTotals.newUsers || 0} icon={<Users />} loading={loading} description={`${metricTotals.newUsers || 0} nuevos · 7d`} />
                    <StatCard title="Viajes activos" value={metricTotals.activeRides || 0} icon={<CalendarClock />} loading={loading} description={`${metricTotals.scheduledRides || 0} programados`} />
                    <StatCard title="Expirados" value={metricTotals.expiredRides || 0} icon={<TimerReset />} loading={loading} description={`${metricTotals.completedRides || 0} completados · 7d`} />
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;
