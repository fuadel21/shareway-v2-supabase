import { useState, useEffect } from 'react';
import { Car, UserCheck, Users, Hourglass, DollarSign, BarChart, Banknote, Loader2, AlertCircle, RefreshCw, Leaf, Building2, Navigation } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlatformStats, requestPlatformPayout } from '@/lib/supabaseRPC';

import PendingVerificationsTab from './tabs/PendingVerificationsTab';
import UserManagementTab from './tabs/UserManagementTab';
import RideManagementTab from './tabs/RideManagementTab';
import FinanceTab from './tabs/FinanceTab';
import DisputesTab from './tabs/DisputesTab';
import MaintenanceTab from './tabs/MaintenanceTab';
import ClimateTab from './tabs/ClimateTab';
import CommunitiesTab from './tabs/CommunitiesTab';

const StatCard = ({ title, value, icon, description, currency = '', loading = false }) => (
    <Card className="rounded-2xl border-none shadow-sm overflow-hidden text-left">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            <div className="bg-primary/10 p-2 rounded-lg text-primary">{icon}</div>
        </CardHeader>
        <CardContent>
            {loading ? (
                <Skeleton className="h-8 w-3/4" />
            ) : (
                <div className="text-2xl font-bold">{value}{currency}</div>
            )}
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </CardContent>
    </Card>
);

function AdminDashboard() {
    const { tab = 'verifications' } = useParams();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isPayoutLoading, setIsPayoutLoading] = useState(false);

    const fetchPlatformStats = async () => {
        setLoading(true);
        try {
            const response = await getPlatformStats();
            if (response?.success && response.data?.success) {
                setStats(response.data.stats);
            } else {
                throw new Error(response?.error || response.data?.message || "Error al obtener estadísticas");
            }
        } catch (error) {
            console.error("🛡️ [AdminDashboard] Fetch Stats Failed:", error);
            toast.error("Error al cargar las estadísticas", { description: error.message });
            setStats({});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlatformStats();
    }, []);

    const handlePayout = async () => {
        setIsPayoutLoading(true);
        try {
            const result = await requestPlatformPayout();
            if (result?.success) {
                toast.success("Retiro solicitado", { description: result.message });
                await fetchPlatformStats();
            } else {
                throw new Error(result?.message || "Error al solicitar el pago");
            }
        } catch (error) {
            toast.error("Error al retirar", { description: error.message });
        } finally {
            setIsPayoutLoading(false);
        }
    };

    return (
        <div className="space-y-8 text-left p-6">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-black tracking-tighter uppercase italic leading-none text-slate-900">Panel de Control</h1>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mt-2">ShareWay Global Management</p>
                </div>
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={fetchPlatformStats}
                    disabled={loading}
                    className="rounded-xl border-slate-100 font-bold text-[10px] uppercase tracking-widest gap-2"
                >
                    <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Sincronizar
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="rounded-2xl border-none shadow-sm overflow-hidden text-left bg-slate-900 text-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 text-slate-400">
                        <CardTitle className="text-xs font-black uppercase tracking-widest">Tesorería</CardTitle>
                        <div className="bg-primary p-2 rounded-lg text-white shadow-lg shadow-primary/20"><DollarSign className="h-4 w-4" /></div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-3/4 bg-slate-800" />
                        ) : (
                            <div className="text-3xl font-black italic tracking-tighter">{(stats?.totalUncollectedFees || 0).toFixed(2)}€</div>
                        )}
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Comisiones acumuladas</p>
                    </CardContent>
                    <CardFooter className="pt-0">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="sm" className="w-full rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest h-10" disabled={(stats?.totalUncollectedFees || 0) <= 0 || isPayoutLoading || loading}>
                                    {isPayoutLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Banknote className="h-4 w-4 mr-2" />} Cobrar Tesorería
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-[2rem] border-none">
                                <AlertDialogHeader>
                                    <AlertDialogTitle className="text-2xl font-black uppercase italic tracking-tighter">Liquidar Comisiones</AlertDialogTitle>
                                    <AlertDialogDescription className="text-slate-500 font-medium pt-2">
                                        Se transferirán {(stats?.totalUncollectedFees || 0).toFixed(2)}€ a la cuenta principal de Stripe de la plataforma.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="gap-2">
                                    <AlertDialogCancel className="rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-slate-100">Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={handlePayout} className="rounded-xl font-bold uppercase text-[10px] tracking-widest bg-slate-900 text-white">Confirmar Liquidación</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardFooter>
                </Card>

                <StatCard
                    title="Ahorro CO2 Global"
                    value={parseFloat(stats?.totalCo2Saved || 0).toFixed(1)}
                    currency=" kg"
                    icon={<Leaf className="h-4 w-4" />}
                    description="Impacto ecológico total."
                    loading={loading}
                />
                <StatCard
                    title="KM Compartidos"
                    value={Math.round(stats?.totalKmShared || 0)}
                    currency=" km"
                    icon={<Navigation className="h-4 w-4" />}
                    description="Distancia total recorrida."
                    loading={loading}
                />
                <StatCard
                    title="Usuarios Activos"
                    value={stats?.totalUsers || 0}
                    icon={<Users className="h-4 w-4" />}
                    description="Crecimiento de comunidad."
                    loading={loading}
                />
            </div>

            <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden min-h-[600px] bg-white">
                <CardContent className="p-8">
                    <Tabs value={tab} onValueChange={(v) => navigate(`/admin/${v}`)} className="w-full">
                        <TabsList className="flex w-full overflow-x-auto mb-10 bg-slate-50 p-1.5 rounded-2xl gap-1 no-scrollbar justify-start">
                            {[
                                { val: 'verifications', label: 'Verificaciones', icon: UserCheck },
                                { val: 'users', label: 'Usuarios', icon: Users },
                                { val: 'rides', label: 'Viajes', icon: Car },
                                { val: 'finance', label: 'Finanzas', icon: DollarSign },
                                { val: 'disputes', label: 'Disputas', icon: AlertCircle },
                                { val: 'communities', label: 'Comunidades', icon: Building2 },
                                { val: 'climate', label: 'Impacto', icon: Leaf },
                                { val: 'maintenance', label: 'Sistema', icon: RefreshCw }
                            ].map((t) => (
                                <TabsTrigger key={t.val} value={t.val} className="rounded-xl px-5 py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all whitespace-nowrap flex-shrink-0 text-[10px] font-black uppercase tracking-widest gap-2 border border-transparent data-[state=active]:border-slate-100">
                                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
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

                            <TabsContent value="climate" className="mt-0 focus-visible:outline-none">
                                <ClimateTab />
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
