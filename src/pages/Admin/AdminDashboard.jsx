import { useState, useEffect } from 'react';
import { Car, UserCheck, Users, Hourglass, DollarSign, BarChart, Banknote, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { toast } from 'sonner';
import { getPlatformStats, requestPlatformPayout } from '@/lib/supabaseRPC';

import PendingVerificationsTab from './tabs/PendingVerificationsTab';
import UserManagementTab from './tabs/UserManagementTab';
import RideManagementTab from './tabs/RideManagementTab';
import FinanceTab from './tabs/FinanceTab';
import DisputesTab from './tabs/DisputesTab';
import MaintenanceTab from './tabs/MaintenanceTab';

const StatCard = ({ title, value, icon, description, currency = '', loading = false }) => (
    <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
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
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isPayoutLoading, setIsPayoutLoading] = useState(false);

    const fetchPlatformStats = async () => {
        setLoading(true);
        try {
            const data = await getPlatformStats();
            if (data?.success) {
                setStats(data.stats);
            } else {
                throw new Error(data?.message || "La respuesta del servidor no fue exitosa.");
            }
        } catch (error) {
            console.error("Error stats:", error);
            toast.error("Error al cargar las estadísticas.", { description: error.message });
            setStats({}); // Set to empty object on error to avoid render issues
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
                await fetchPlatformStats(); // Recargar las estadísticas
            } else {
                throw new Error(result?.message || "Error al solicitar el pago");
            }
        } catch (error) {
            toast.error("Error al retirar", { description: error.message });
        } finally {
            setIsPayoutLoading(false);
        }
    };

    const totalFees = stats?.totalUncollectedFees || 0;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
                <p className="text-muted-foreground">Resumen global y gestión de la plataforma.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="rounded-2xl border-none shadow-sm overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 text-muted-foreground">
                        <CardTitle className="text-sm font-medium">Comisiones Acumuladas</CardTitle>
                        <div className="bg-primary/10 p-2 rounded-lg text-primary"><DollarSign className="h-4 w-4" /></div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-3/4" />
                        ) : (
                            <div className="text-2xl font-bold">{totalFees.toFixed(2)}€</div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">Total de comisiones pendientes.</p>
                    </CardContent>
                    <CardFooter className="pt-0">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="sm" className="w-full rounded-xl" disabled={totalFees <= 0 || isPayoutLoading || loading}>
                                    {isPayoutLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Banknote className="h-4 w-4 mr-2" />} Retirar Comisiones
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-3xl">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirmar Retiro</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Se iniciará una transferencia de {totalFees.toFixed(2)}€ a tu cuenta bancaria asociada en Stripe. Esta acción puede tardar varios días en completarse.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={handlePayout} className="rounded-xl">Confirmar Retiro</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardFooter>
                </Card>

                <StatCard
                    title="Volumen Total (GTV)"
                    value={(stats?.grossTotalVolume || 0).toFixed(2)}
                    currency="€"
                    icon={<BarChart className="h-4 w-4" />}
                    description="Flujo total de dinero."
                    loading={loading}
                />
                <StatCard
                    title="Usuarios Totales"
                    value={stats?.totalUsers || 0}
                    icon={<Users className="h-4 w-4" />}
                    description="Crecimiento de la comunidad."
                    loading={loading}
                />
                <StatCard
                    title="Viajes Realizados"
                    value={stats?.totalCompletedRides || 0}
                    icon={<Car className="h-4 w-4" />}
                    description="Viajes finalizados con éxito."
                    loading={loading}
                />
            </div>

            <Card className="rounded-3xl border-none shadow-sm overflow-hidden min-h-[500px]">
                <CardContent className="p-6">
                    <Tabs defaultValue="verifications" className="w-full">
                        <TabsList className="grid w-full grid-cols-6 mb-8 bg-gray-100/50 p-1 rounded-2xl">
                            <TabsTrigger value="verifications" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><UserCheck className="mr-2 h-4 w-4" />Verificaciones</TabsTrigger>
                            <TabsTrigger value="users" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><Users className="mr-2 h-4 w-4" />Usuarios</TabsTrigger>
                            <TabsTrigger value="rides" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><Car className="mr-2 h-4 w-4" />Viajes</TabsTrigger>
                            <TabsTrigger value="finance" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><DollarSign className="mr-2 h-4 w-4" />Finanzas</TabsTrigger>
                            <TabsTrigger value="disputes" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><AlertCircle className="mr-2 h-4 w-4" />Disputas</TabsTrigger>
                            <TabsTrigger value="maintenance" className="rounded-xl data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all"><RefreshCw className="mr-2 h-4 w-4" />Mantenimiento</TabsTrigger>
                        </TabsList>

                        <TabsContent value="verifications" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Solicitudes de verificación pendientes de revisión.</p>
                                <PendingVerificationsTab />
                            </div>
                        </TabsContent>

                        <TabsContent value="users" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Gestión y búsqueda de usuarios en la plataforma.</p>
                                <UserManagementTab />
                            </div>
                        </TabsContent>

                        <TabsContent value="rides" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Historial y estado actual de los viajes publicados.</p>
                                <RideManagementTab />
                            </div>
                        </TabsContent>
                        <TabsContent value="finance" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Gestión financiera y solicitudes de retiro.</p>
                                <FinanceTab stats={stats} loading={loading} />
                            </div>
                        </TabsContent>
                        <TabsContent value="disputes" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Solicitudes de reembolso por fuerza mayor.</p>
                                <DisputesTab />
                            </div>
                        </TabsContent>

                        <TabsContent value="maintenance" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl">
                                <p className="text-sm text-muted-foreground mb-4">Mantenimiento global y limpieza de datos.</p>
                                <MaintenanceTab />
                            </div>
                        </TabsContent>

                        <TabsContent value="climate" className="mt-0 focus-visible:outline-none">
                            <div className="bg-white rounded-2xl p-6">
                                <ClimateTab />
                            </div>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}

export default AdminDashboard;
