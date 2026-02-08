import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

const FinanceTab = ({ stats, loading: statsLoading }) => {
    const [payouts, setPayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    const fetchPayouts = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('payout_requests')
                .select('*, profiles(display_name, email)')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPayouts(data || []);
        } catch (error) {
            toast.error("Error al cargar retiros");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPayouts();
    }, []);

    const handleProcessPayout = async (payoutId, status) => {
        setProcessingId(payoutId);
        try {
            if (status === 'completed') {
                // LLAMADA AL MOTOR DE PAGOS REAL (EDGE FUNCTION)
                const { data, error } = await supabase.functions.invoke('process-stripe-payout', {
                    body: { payoutId }
                });

                if (error || data?.error) throw new Error(data?.error || error?.message || "Error en el motor de transferencias");

                toast.success("Pago transferido con éxito vía Stripe");
            } else {
                // RECHAZO (Sigue siendo un RPC administrativo)
                const { error } = await supabase.rpc('process_payout', {
                    p_payout_id: payoutId,
                    p_status: 'rejected',
                    p_error_message: 'Rechazado por el administrador'
                });
                if (error) throw error;
                toast.success("Retiro rechazado");
            }

            fetchPayouts();
        } catch (error) {
            toast.error("Error al procesar", { description: error.message });
        } finally {
            setProcessingId(null);
        }
    };

    if (statsLoading || loading) {
        return <div className="flex justify-center items-center p-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    const transactions = stats?.recentFeeTransactions || [];

    return (
        <div className="space-y-8">
            {/* Payout Requests Section */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-slate-50/50">
                <CardHeader>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Clock className="h-5 w-5 text-amber-500" /> Solicitudes de Retiro
                    </CardTitle>
                    <CardDescription>Conductores esperando transferencia de ganancias.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead>Conductor</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Importe</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {payouts.length > 0 ? (
                                payouts.map(p => (
                                    <TableRow key={p.id} className="border-slate-50">
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-bold">{p.profiles?.display_name || 'Usuario'}</span>
                                                <span className="text-[10px] text-slate-400">{p.profiles?.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-500">
                                            {format(new Date(p.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                                        </TableCell>
                                        <TableCell className="font-black text-slate-900">{parseFloat(p.amount).toFixed(2)}€</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn(
                                                "capitalize font-bold text-[10px] rounded-lg border-none px-3 py-1",
                                                p.status === 'completed' ? "bg-emerald-50 text-emerald-600" :
                                                    p.status === 'rejected' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                                            )}>
                                                {p.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {p.status === 'pending' && (
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0 rounded-lg hover:bg-red-50 hover:text-red-600"
                                                        onClick={() => handleProcessPayout(p.id, 'rejected')}
                                                        disabled={processingId === p.id}
                                                    >
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        className="h-8 rounded-lg bg-slate-900 hover:bg-primary font-bold px-3 text-[10px] uppercase"
                                                        onClick={() => handleProcessPayout(p.id, 'completed')}
                                                        disabled={processingId === p.id}
                                                    >
                                                        {processingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Aprobar"}
                                                    </Button>
                                                </div>
                                            )}
                                            {p.stripe_transfer_id && (
                                                <span className="text-[8px] font-mono text-slate-300 uppercase truncate max-w-[100px] inline-block">
                                                    {p.stripe_transfer_id}
                                                </span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-10 text-slate-400 font-medium">No hay solicitudes de retiro.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Commissions History Section */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white">
                <CardHeader>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-emerald-500" /> Historial de Comisiones
                    </CardTitle>
                    <CardDescription>Últimas 10 comisiones generadas por la plataforma.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead>Fecha</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead className="text-right">Importe</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transactions.length > 0 ? (
                                transactions.map(tx => (
                                    <TableRow key={tx.id}>
                                        <TableCell className="text-xs text-slate-500">{tx.date ? format(new Date(tx.date), 'dd/MM/yy HH:mm', { locale: es }) : 'N/A'}</TableCell>
                                        <TableCell className="font-medium">{tx.description || 'Comisión de viaje'}</TableCell>
                                        <TableCell className="text-right font-black text-primary">+{tx.amount.toFixed(2)}€</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center py-10 text-slate-400 font-medium">No hay transacciones todavía.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};

const cn = (...classes) => classes.filter(Boolean).join(' ');

export default FinanceTab;
