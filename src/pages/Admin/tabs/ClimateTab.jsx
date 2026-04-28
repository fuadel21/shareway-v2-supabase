import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Leaf, Car, Users, TrendingUp, Download, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

/**
 * ClimateTab Component
 *
 * Part of the Admin Dashboard. Provides climate impact auditing data.
 * Displays CO2 savings, distance shared, and occupancy metrics aligned with EU Green Deal standards.
 * Features data visualization (recharts) and CSV export functionality.
 */
const ClimateTab = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState({
        total_co2: 0,
        total_km: 0,
        total_trips: 0,
        avg_occupancy: 0
    });

    useEffect(() => {
        fetchClimateData();
    }, []);

    /**
     * Fetches climate report data from the `v_eu_grant_report` view.
     * Processes raw data for charting and summary calculation.
     */
    const fetchClimateData = async () => {
        try {
            setLoading(true);
            // Consultar la vista de reporte
            const { data: reportData, error } = await supabase
                .from('v_eu_grant_report')
                .select('*')
                .order('month', { ascending: true });

            if (error) throw error;

            // Formatear datos para el gráfico
            const formattedData = reportData.map(item => ({
                ...item,
                monthLabel: format(new Date(item.month), 'MMM yyyy', { locale: es }),
                net_co2_savings_kg: Number(item.net_co2_savings_kg),
                actual_emissions_kg: Number(item.actual_emissions_kg),
                baseline_emissions_kg: Number(item.baseline_emissions_kg)
            }));

            setData(formattedData);

            // Calcular totales históricos
            const totals = reportData.reduce((acc, curr) => ({
                total_co2: acc.total_co2 + Number(curr.net_co2_savings_kg),
                total_km: acc.total_km + Number(curr.total_km_traveled),
                total_trips: acc.total_trips + Number(curr.total_trips),
                occupancy_sum: acc.occupancy_sum + Number(curr.avg_occupancy) * Number(curr.total_trips) // Weighted average logic
            }), { total_co2: 0, total_km: 0, total_trips: 0, occupancy_sum: 0 });

            setSummary({
                total_co2: totals.total_co2,
                total_km: totals.total_km,
                total_trips: totals.total_trips,
                avg_occupancy: totals.total_trips > 0 ? totals.occupancy_sum / totals.total_trips : 0
            });

        } catch (error) {
            console.error('Error fetching climate data:', error);
            toast.error('Error al cargar datos climáticos');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Generates and downloads a CSV file containing the detailed climate audit report.
     */
    const downloadCSV = () => {
        const headers = ['Mes', 'Viajes', 'KM Totales', 'Emisiones Baseline (kg)', 'Emisiones Reales (kg)', 'Ahorro Neto (kg)', 'Ocupación Media'];
        const csvContent = [
            headers.join(','),
            ...data.map(row => [
                row.month,
                row.total_trips,
                row.total_km_traveled,
                row.baseline_emissions_kg,
                row.actual_emissions_kg,
                row.net_co2_savings_kg,
                Number(row.avg_occupancy).toFixed(2)
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `audit_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Cargando datos de auditoría...</div>;
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-emerald-950">Auditoría de Impacto Climático (EU Green Deal)</h2>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                        Métricas calculadas según metodología AEMA/EEA 2024. Los datos provienen del ledger inmutable `climate_audit_logs`.
                    </p>
                </div>
                <Button onClick={downloadCSV} variant="outline" className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
                    <Download className="h-4 w-4" />
                    Exportar CSV Auditoría
                </Button>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-emerald-50 to-white border-emerald-100 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-800">CO₂ Ahorrado (Neto)</CardTitle>
                        <Leaf className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-900">{summary.total_co2.toFixed(1)} kg</div>
                        <p className="text-xs text-emerald-600/80 mt-1">Impacto directo acumulado</p>
                    </CardContent>
                </Card>

                <Card className="border-slate-100 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">Distancia Compartida</CardTitle>
                        <Car className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">{summary.total_km.toFixed(0)} km</div>
                        <p className="text-xs text-slate-400 mt-1">Kilómetros totales logueados</p>
                    </CardContent>
                </Card>

                <Card className="border-slate-100 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">Ocupación Media</CardTitle>
                        <Users className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">{summary.avg_occupancy.toFixed(2)} pax</div>
                        <p className="text-xs text-slate-400 mt-1">Target UE: {'>'} 1.5 pax</p>
                    </CardContent>
                </Card>

                <Card className="border-slate-100 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">Eficiencia</CardTitle>
                        <TrendingUp className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">
                            {summary.total_trips > 0 ? (summary.total_co2 / summary.total_trips).toFixed(2) : 0} kg
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Ahorro promedio por viaje</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Chart */}
            <div className="grid gap-6 md:grid-cols-3">
                <Card className="col-span-2 border-none shadow-md rounded-2xl overflow-hidden">
                    <CardHeader>
                        <CardTitle>Evolución de Ahorro de CO₂</CardTitle>
                        <CardDescription>Comparativa mensual: Emisiones evitadas vs Emisiones reales</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px] min-h-[350px] w-full">
                        {data && data.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                                <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis
                                        dataKey="monthLabel"
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${value}kg`}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9' }}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Legend />
                                    <Bar
                                        name="CO₂ Ahorrado (Neto)"
                                        dataKey="net_co2_savings_kg"
                                        fill="#10b981"
                                        radius={[4, 4, 0, 0]}
                                        stackId="a"
                                    />
                                    <Bar
                                        name="Emisión Residual"
                                        dataKey="actual_emissions_kg"
                                        fill="#e2e8f0"
                                        radius={[4, 4, 0, 0]}
                                        stackId="a"
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full w-full flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl">
                                No hay datos de auditoría disponibles todavía
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Methodology Info Card */}
                <Card className="col-span-1 bg-slate-50 border-none shadow-inner rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Info className="h-4 w-4" />
                            Metodología de Auditoría
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-4">
                        <div className="space-y-2">
                            <h4 className="font-semibold text-slate-700">Counterfactual (Baseline)</h4>
                            <p>Se asume un vehículo de combustión promedio UE (108g CO₂/km) por cada pasajero transportado si no hubiera compartido viaje.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-semibold text-slate-700">Cálculo Real</h4>
                            <p>Basado en el tipo de motor específico del conductor (Diesel/Gasolina/EV) y ocupación real.</p>
                        </div>
                        <div className="p-3 bg-emerald-100/50 rounded-lg text-emerald-800 text-xs font-medium mt-4 border border-emerald-100">
                            Cumple con estándares Horizon Europe para justificación de impacto ambiental.
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ClimateTab;
