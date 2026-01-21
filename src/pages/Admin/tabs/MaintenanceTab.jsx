import { useState, useEffect } from 'react';
import { ShieldAlert, Trash2, RefreshCw, Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { toast } from 'sonner';
import { getAdminHealthDashboard, runManualMaintenanceTasks } from '@/lib/supabaseRPC';

export default function MaintenanceTab() {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isRunning, setIsRunning] = useState(false);

    const fetchHealth = async () => {
        setLoading(true);
        const { data, success } = await getAdminHealthDashboard();
        if (success) setHealth(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchHealth();
    }, []);

    const handleRunMaintenance = async () => {
        setIsRunning(true);
        const toastId = toast.loading("Ejecutando tareas de mantenimiento...");

        try {
            const { data, success, error } = await runManualMaintenanceTasks();
            if (success) {
                toast.success("Mantenimiento completado", {
                    id: toastId,
                    description: `Notificaciones: ${data.notifications_cleaned}, Suspensiones: ${data.suspensions_lifted}`
                });
                fetchHealth();
            } else {
                throw new Error(error);
            }
        } catch (err) {
            toast.error("Error al ejecutar mantenimiento", { id: toastId, description: err.message });
        } finally {
            setIsRunning(false);
        }
    };

    if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-none shadow-sm rounded-2xl bg-slate-50/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-800">
                            <ShieldAlert className="h-5 w-5 text-amber-500" /> Estado de Salud
                        </CardTitle>
                        <CardDescription>Resumen de tareas pendientes de limpieza.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                            <div className="flex gap-3 items-center text-sm font-medium text-slate-600">
                                <Clock className="h-4 w-4 text-slate-400" /> Notificaciones antiguas
                            </div>
                            <span className="text-lg font-bold text-slate-900">{health?.notifications_to_clean || 0}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                            <div className="flex gap-3 items-center text-sm font-medium text-slate-600">
                                <ShieldAlert className="h-4 w-4 text-slate-400" /> Usuarios suspendidos
                            </div>
                            <span className="text-lg font-bold text-slate-900">{health?.suspended_users || 0}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                            <div className="flex gap-3 items-center text-sm font-medium text-slate-600">
                                <AlertCircle className="h-4 w-4 text-slate-400" /> Disputas pendientes
                            </div>
                            <span className="text-lg font-bold text-slate-900">{health?.disputes_pending || 0}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-sm rounded-2xl bg-indigo-50/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-indigo-900">
                            <RefreshCw className="h-5 w-5 text-indigo-500" /> Acciones Rápidas
                        </CardTitle>
                        <CardDescription>Ejecución manual de procesos de sistema.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button
                            className="w-full h-14 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100"
                            onClick={handleRunMaintenance}
                            disabled={isRunning}
                        >
                            {isRunning ? (
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-5 w-5" />
                            )}
                            EJECUTAR MANTENIMIENTO GLOBAL
                        </Button>
                        <p className="text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
                            Esta acción limpia notificaciones de +30 días, levanta suspensiones expiradas y refresca cachés.
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-none shadow-sm rounded-2xl overflow-hidden border-l-4 border-l-emerald-500 bg-white">
                <CardContent className="p-6 flex items-start gap-4">
                    <div className="size-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <CheckCircle className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-900">Seguridad de Chat Activa</h4>
                        <p className="text-sm text-slate-500 leading-relaxed">
                            El sistema de bloqueo automático está operando mediante RLS. Los hilos de comunicación se cierran automáticamente 24 horas después de la finalización de cada viaje para garantizar la privacidad y seguridad de los participantes.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
