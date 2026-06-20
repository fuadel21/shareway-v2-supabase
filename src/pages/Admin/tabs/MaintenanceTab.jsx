import { useState, useEffect, useMemo } from 'react';
import { ShieldAlert, RefreshCw, Loader2, AlertCircle, Clock, Settings2, Save, Gavel, DollarSign, Timer, ShieldCheck, ToggleLeft, ToggleRight, LayoutDashboard, History, User, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { toast } from 'sonner';
import { getAdminHealthDashboard, runManualMaintenanceTasks, getPlatformSettings, updatePlatformSetting, getPlatformAuditLogs } from '@/lib/supabaseRPC';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const stringifySettingValue = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

const parseSettingValue = (key, value) => {
    if (key === 'platform_maintenance_mode') return value === 'true';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value !== '' && !Number.isNaN(Number(value))) return Number(value);

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const formatLogDate = (date) => {
    if (!date) return 'Sin fecha';
    try {
        return format(new Date(date), 'dd MMM HH:mm:ss', { locale: es });
    } catch {
        return 'Fecha inválida';
    }
};

export default function MaintenanceTab() {
    const [health, setHealth] = useState(null);
    const [settings, setSettings] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [auditFilter, setAuditFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showAudit, setShowAudit] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [healthRes, settingsRes, auditRes] = await Promise.all([
                getAdminHealthDashboard(),
                getPlatformSettings(),
                getPlatformAuditLogs('all', 20)
            ]);

            if (healthRes.success) setHealth(healthRes.data);
            if (settingsRes.success) setSettings(settingsRes.data || []);
            if (auditRes.success) setAuditLogs(auditRes.data || []);
        } catch (error) {
            toast.error('Error al cargar mantenimiento', { description: error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const filteredAuditLogs = useMemo(() => {
        return auditLogs.filter(log => {
            const action = log?.action || '';
            return auditFilter === 'all' || action.includes(auditFilter);
        });
    }, [auditLogs, auditFilter]);

    const categorizedSettings = useMemo(() => {
        const categories = {
            Sistema: { icon: LayoutDashboard, color: 'text-blue-500', bg: 'bg-blue-50' },
            Finanzas: { icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' },
            Caducidad: { icon: Timer, color: 'text-amber-500', bg: 'bg-amber-50' },
            Seguridad: { icon: ShieldCheck, color: 'text-purple-500', bg: 'bg-purple-50' },
            Impacto: { icon: Activity, color: 'text-orange-500', bg: 'bg-orange-50' },
            General: { icon: Settings2, color: 'text-slate-500', bg: 'bg-slate-50' }
        };

        const grouped = settings.reduce((acc, curr) => {
            const cat = curr.category || 'General';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(curr);
            return acc;
        }, {});

        return Object.entries(grouped).map(([name, items]) => {
            const config = categories[name] || categories.General;
            return { name, items, icon: config.icon, color: config.color, bg: config.bg };
        });
    }, [settings]);

    const handleRunMaintenance = async () => {
        setIsRunning(true);
        const toastId = toast.loading('Ejecutando tareas de mantenimiento...');
        try {
            const { data, success, error } = await runManualMaintenanceTasks();
            if (success) {
                toast.success('Mantenimiento completado', {
                    id: toastId,
                    description: `Notificaciones: ${data?.notifications_cleaned ?? 0}, Suspensiones: ${data?.suspensions_lifted ?? 0}`
                });
                fetchData();
            } else throw new Error(error);
        } catch (err) {
            toast.error('Error al ejecutar mantenimiento', { id: toastId, description: err.message });
        } finally {
            setIsRunning(false);
        }
    };

    const handleUpdateSetting = async (key, newValue) => {
        setIsSaving(true);
        try {
            const finalValue = parseSettingValue(key, newValue);
            const { success, error } = await updatePlatformSetting(key, finalValue);
            if (success) {
                toast.success('Configuración actualizada');
                fetchData();
            } else throw new Error(error);
        } catch (err) {
            toast.error('Error al guardar', { description: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>;

    const maintenanceMode = settings.find(s => s.key === 'platform_maintenance_mode')?.value === true;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 text-left">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white border border-slate-100 rounded-3xl shadow-sm">
                <div className="flex items-center gap-4">
                    <div className={cn('size-12 rounded-2xl flex items-center justify-center shadow-lg', maintenanceMode ? 'bg-red-500 shadow-red-100' : 'bg-emerald-500 shadow-emerald-100')}>
                        {maintenanceMode ? <AlertCircle className="text-white" /> : <ShieldCheck className="text-white" />}
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900 uppercase italic tracking-tight">
                            Estado Global: {maintenanceMode ? 'Modo Mantenimiento' : 'Operativo'}
                        </h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                            {maintenanceMode ? 'Las acciones críticas están limitadas para usuarios.' : 'Todos los sistemas funcionando correctamente.'}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        className={cn('rounded-2xl h-14 w-14 transition-all', showAudit ? 'bg-slate-900 text-white' : 'bg-white text-slate-400')}
                        onClick={() => setShowAudit(!showAudit)}
                        title="Ver auditoría"
                    >
                        <History className="h-5 w-5" />
                    </Button>
                    <Button
                        variant={maintenanceMode ? 'destructive' : 'outline'}
                        className="rounded-2xl h-14 px-8 font-black uppercase italic tracking-widest text-[10px]"
                        onClick={() => handleUpdateSetting('platform_maintenance_mode', maintenanceMode ? 'false' : 'true')}
                        disabled={isSaving}
                    >
                        {maintenanceMode ? <ToggleRight className="mr-2 h-5 w-5" /> : <ToggleLeft className="mr-2 h-5 w-5" />}
                        {maintenanceMode ? 'Desactivar Mantenimiento' : 'Activar Mantenimiento'}
                    </Button>
                </div>
            </div>

            {showAudit ? (
                <Card className="border-none shadow-xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden animate-in slide-in-from-top-4 duration-500">
                    <CardHeader className="p-8 border-b border-white/5">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <CardTitle className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                                    <History className="text-primary" /> Centro de Auditoría Forense
                                </CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-1">Caja negra del sistema ShareWay Elite.</CardDescription>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {['all', 'update_setting', 'manual_maintenance', 'security'].map((f) => (
                                    <Button
                                        key={f}
                                        variant="ghost"
                                        size="sm"
                                        className={cn('text-[9px] font-black uppercase tracking-widest rounded-xl h-9 px-4', auditFilter === f ? 'bg-primary text-white' : 'bg-white/5 text-slate-400')}
                                        onClick={() => setAuditFilter(f)}
                                    >
                                        {f.replace('_', ' ')}
                                    </Button>
                                ))}
                                <Button variant="ghost" onClick={() => setShowAudit(false)} className="text-slate-400 hover:text-white uppercase font-black text-[10px]">Cerrar</Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 max-h-[600px] overflow-y-auto custom-scrollbar">
                        <div className="divide-y divide-white/5">
                            {filteredAuditLogs.length === 0 ? (
                                <div className="p-16 text-center">
                                    <Activity className="size-12 text-slate-800 mx-auto mb-4 opacity-20" />
                                    <p className="text-slate-500 uppercase font-black text-xs tracking-widest">Sin registros en esta categoría</p>
                                </div>
                            ) : (
                                filteredAuditLogs.map((log) => {
                                    const action = log?.action || 'sin_accion';
                                    return (
                                        <div key={log.id || `${action}-${log.created_at}`} className="p-6 flex items-start gap-4 hover:bg-white/5 transition-colors group">
                                            <div className={cn('size-10 rounded-xl flex items-center justify-center shrink-0 border border-white/5', action.includes('update') ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400')}>
                                                <Activity className="size-5" />
                                            </div>
                                            <div className="flex-1 space-y-2 min-w-0">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <p className="text-xs font-black uppercase italic tracking-tight text-white truncate">{action.replace(/_/g, ' ')}</p>
                                                        <Badge className={cn('text-[7px] font-black uppercase px-2 h-4', action.includes('update') ? 'bg-blue-500' : 'bg-emerald-500')}>
                                                            {action.split('_')[0]}
                                                        </Badge>
                                                    </div>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase flex items-center gap-1 shrink-0">
                                                        <Clock className="size-3" /> {formatLogDate(log.created_at)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="size-5 rounded-full bg-primary/20 flex items-center justify-center">
                                                        <User className="size-3 text-primary" />
                                                    </div>
                                                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{log.admin_name || 'Admin Sistema'}</p>
                                                    <span className="text-[8px] text-slate-600 font-mono">ID: {log.admin_id?.split('-')[0] || 'sistema'}...</span>
                                                </div>
                                                {log.target_key && (
                                                    <div className="mt-3 text-[10px] bg-black/40 p-4 rounded-2xl border border-white/5 space-y-2 font-mono overflow-hidden">
                                                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                                            <span className="text-primary font-black uppercase tracking-tighter">Parámetro: {log.target_key}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-4 pt-1">
                                                            <div className="space-y-1 min-w-0">
                                                                <p className="text-[8px] text-slate-500 uppercase font-black">Antes</p>
                                                                <p className="text-red-400/80 truncate">{JSON.stringify(log.old_value) || 'NULL'}</p>
                                                            </div>
                                                            <div className="space-y-1 min-w-0">
                                                                <p className="text-[8px] text-emerald-500 uppercase font-black">Después</p>
                                                                <p className="text-emerald-400 font-bold truncate">{JSON.stringify(log.new_value) || 'NULL'}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card className="border-none shadow-sm rounded-2xl bg-slate-50/50">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-slate-800 uppercase italic font-black text-sm">
                                    <ShieldAlert className="h-5 w-5 text-amber-500" /> Diagnóstico de Salud
                                </CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest">Estado de los procesos automáticos.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {[
                                    { label: 'Notificaciones antiguas', value: health?.notifications_to_clean, icon: Clock },
                                    { label: 'Usuarios suspendidos', value: health?.suspended_users, icon: ShieldAlert },
                                    { label: 'Disputas pendientes', value: health?.disputes_pending, icon: AlertCircle },
                                ].map((stat) => (
                                    <div key={stat.label} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm group hover:scale-[1.02] transition-transform">
                                        <div className="flex gap-3 items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                                            <stat.icon className="h-4 w-4 text-slate-300 group-hover:text-primary transition-colors" /> {stat.label}
                                        </div>
                                        <span className="text-lg font-black text-slate-900 italic tracking-tighter">{stat.value || 0}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-xl rounded-2xl bg-indigo-50 relative overflow-hidden group">
                            <CardHeader className="relative z-10">
                                <CardTitle className="flex items-center gap-2 text-indigo-900 uppercase italic font-black text-sm">
                                    <RefreshCw className="h-5 w-5 text-indigo-500" /> Mantenimiento Maestro
                                </CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Acciones de limpieza profunda.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 relative z-10">
                                <Button
                                    className="w-full h-16 rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 text-xs font-black uppercase italic tracking-widest"
                                    onClick={handleRunMaintenance}
                                    disabled={isRunning}
                                >
                                    {isRunning ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Gavel className="mr-2 h-5 w-5" />}
                                    EJECUTAR LIMPIEZA TOTAL
                                </Button>
                                <div className="p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-indigo-100">
                                    <p className="text-[10px] text-indigo-600 leading-relaxed font-bold uppercase tracking-tighter italic">
                                        Esta acción purga notificaciones caducas (+30 días), recalcula estadísticas globales y libera recursos de base de datos.
                                    </p>
                                </div>
                            </CardContent>
                            <RefreshCw className="absolute -right-8 -bottom-8 size-40 text-indigo-500/5 group-hover:rotate-180 transition-transform duration-1000" />
                        </Card>
                    </div>

                    <div className="space-y-8">
                        {categorizedSettings.map((category) => (
                            <div key={category.name} className="space-y-4">
                                <div className="flex items-center gap-3 px-2">
                                    <div className={cn('p-2 rounded-xl', category.bg)}>
                                        <category.icon className={cn('size-5', category.color)} />
                                    </div>
                                    <h3 className="text-sm font-black text-slate-900 uppercase italic tracking-[0.2em]">{category.name}</h3>
                                    <div className="h-px flex-1 bg-slate-100" />
                                </div>

                                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    {category.items.filter(s => s.key !== 'platform_maintenance_mode').map((setting) => (
                                        <Card key={setting.key} className="border-none shadow-sm rounded-3xl bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 flex flex-col justify-between overflow-hidden group">
                                            <div className="p-6 pb-4">
                                                <div className="flex items-start justify-between mb-2">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                                                        {setting.key.split('_').pop()}
                                                    </span>
                                                    <Badge variant="outline" className="text-[7px] font-black border-slate-100 text-slate-400">{category.name}</Badge>
                                                </div>
                                                <h4 className="text-xs font-black text-slate-800 uppercase italic tracking-tight mb-2">
                                                    {setting.key.replace(/_/g, ' ')}
                                                </h4>
                                                <p className="text-[10px] font-bold text-slate-400 leading-relaxed italic">
                                                    {setting.description}
                                                </p>
                                            </div>

                                            <div className="p-6 pt-0 mt-auto bg-slate-50/50">
                                                <div className="flex gap-2 items-center">
                                                    <div className="relative flex-1">
                                                        <Input
                                                            type="text"
                                                            defaultValue={stringifySettingValue(setting.value)}
                                                            id={`input-${setting.key}`}
                                                            className="h-12 rounded-2xl bg-white border-none shadow-inner font-black text-slate-900 focus-visible:ring-primary/20"
                                                        />
                                                    </div>
                                                    <Button
                                                        size="icon"
                                                        className="rounded-2xl shrink-0 h-12 w-12 bg-slate-950 hover:bg-primary transition-all shadow-lg active:scale-90"
                                                        onClick={() => {
                                                            const val = document.getElementById(`input-${setting.key}`).value;
                                                            handleUpdateSetting(setting.key, val);
                                                        }}
                                                        disabled={isSaving}
                                                    >
                                                        {isSaving ? <Loader2 className="size-5 animate-spin" /> : <Save className="h-5 w-5" />}
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden border-l-8 border-l-primary bg-white group hover:shadow-2xl transition-all duration-1000">
                <CardContent className="p-10 flex flex-col md:flex-row items-center gap-8">
                    <div className="size-20 rounded-3xl bg-primary/5 flex items-center justify-center shrink-0 shadow-inner group-hover:rotate-6 transition-transform">
                        <ShieldCheck className="h-10 w-10 text-primary" />
                    </div>
                    <div className="text-left space-y-2">
                        <h4 className="text-xl font-black text-slate-950 uppercase italic tracking-tighter">Bóveda de Seguridad Activa</h4>
                        <p className="text-sm text-slate-500 leading-relaxed font-medium italic">
                            Todos los cambios en esta sección son auditados. La protección <span className="text-primary font-bold">RLS (Row Level Security)</span> y el cifrado de comunicaciones garantizan que solo el personal autorizado pueda modificar los parámetros de la red ShareWay Elite.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
