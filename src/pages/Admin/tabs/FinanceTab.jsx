import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, XCircle, Wallet, History, ArrowUpRight, ReceiptText, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getPayoutRequests, processPayout, processStripePayout } from '@/lib/supabaseRPC';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const money = (value) => `${Number(value || 0).toFixed(2)}€`;

const locationLabel = (location) => {
    if (!location) return 'N/A';
    if (typeof location === 'string') return location;
    return location.name || location.address || 'Ubicación';
};

const eventLabel = (type) => {
    const labels = {
        booking_hold: 'Reserva retenida',
        booking_paid: 'Reserva cobrada',
        booking_payment_refund: 'Reembolso de reserva',
        platform_fee: 'Comisión plataforma',
        driver_payout: 'Pago conductor',
        ride_settlement: 'Liquidación del viaje',
        passenger_refund: 'Reembolso pasajero',
        driver_cancellation_refund: 'Reembolso por cancelación',
        passenger_cancellation_penalty: 'Penalización pasajero',
        driver_cancellation_penalty: 'Penalización conductor',
        refund: 'Reembolso',
        cancellation: 'Cancelación',
        no_show_penalty: 'No-show liquidado',
        no_show: 'No-show',
        wallet_transaction: 'Movimiento wallet'
    };
    return labels[type] || String(type || 'Movimiento').replace(/_/g, ' ');
};

const eventBadgeClass = (type) => {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('refund') || normalized.includes('reembolso') || normalized.includes('cancel')) return 'bg-red-50 text-red-600';
    if (normalized.includes('fee') || normalized.includes('commission') || normalized.includes('comision')) return 'bg-blue-50 text-blue-600';
    if (normalized.includes('payout') || normalized.includes('driver')) return 'bg-emerald-50 text-emerald-600';
    return 'bg-slate-100 text-slate-600';
};

const collectionEvents = new Set(['booking_hold', 'booking_paid']);
const settlementEvents = new Set(['ride_settlement', 'no_show_penalty']);
const penaltyEvents = new Set(['passenger_cancellation_penalty', 'driver_cancellation_penalty']);
const refundEvents = new Set(['passenger_refund', 'driver_cancellation_refund', 'booking_payment_refund', 'refund']);

const ledgerCategory = (eventType) => {
    const normalized = String(eventType || '').toLowerCase();
    if (collectionEvents.has(normalized)) return 'collection';
    if (refundEvents.has(normalized) || normalized.includes('refund')) return 'refund';
    if (penaltyEvents.has(normalized)) return 'penalty';
    if (settlementEvents.has(normalized)) return 'settlement';
    return 'other';
};

const ledgerResult = (entry) => {
    const category = ledgerCategory(entry.event_type);
    if (category === 'collection') return null;
    if (category === 'refund') return -Math.abs(Number(entry.refund_amount || 0));
    if (category === 'settlement' || category === 'penalty') return Number(entry.driver_amount || 0);
    return Number(entry.net_amount || 0);
};

/**
 * FinanceTab Component
 *
 * Part of the Admin Dashboard. Manages platform treasury, driver payouts and ride financial ledger.
 */
const FinanceTab = ({ stats, loading: statsLoading }) => {
    const [payouts, setPayouts] = useState([]);
    const [ledger, setLedger] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    const fetchFinanceData = async () => {
        setLoading(true);
        try {
            const [payoutRes, ledgerRes] = await Promise.all([
                getPayoutRequests(),
                supabase
                    .from('ride_financial_ledger')
                    .select('*, ride:rides(id, origin, destination, departure_time, status)')
                    .order('created_at', { ascending: false })
                    .limit(50)
            ]);

            if (!payoutRes.success) throw new Error(payoutRes.error);
            setPayouts(payoutRes.data || []);

            if (ledgerRes.error) {
                console.warn('Finance ledger load failed:', ledgerRes.error.message);
                setLedger([]);
            } else {
                setLedger(ledgerRes.data || []);
            }
        } catch (error) {
            toast.error("Error al cargar finanzas", { description: error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFinanceData();
    }, []);

    const handleProcessPayout = async (payoutId, action) => {
        const isApproval = action === 'completed' || action === 'approve';
        setProcessingId(payoutId);
        const toastId = toast.loading(isApproval ? "Procesando liquidación..." : "Rechazando retiro...");
        try {
            const result = isApproval
                ? await processStripePayout(payoutId)
                : await processPayout(payoutId, 'rejected', 'Procesado por el panel administrativo');

            if (!result?.success) throw new Error(result?.error || 'La operación financiera fue rechazada');

            toast.success(isApproval ? "Pago liquidado y wallet actualizada" : "Retiro rechazado", { id: toastId });
            fetchFinanceData();
        } catch (error) {
            toast.error("Error al procesar", { id: toastId, description: error.message });
        } finally {
            setProcessingId(null);
        }
    };

    if (statsLoading || loading) {
        return (
            <div className="flex flex-col items-center justify-center p-32 gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary/30" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Sincronizando Tesorería...</p>
            </div>
        );
    }

    const transactions = stats?.recentFeeTransactions || [];
    // Ledger rows are events, not a balance sheet. booking_paid/booking_hold
    // and ride_settlement contain the same gross booking at different stages;
    // summing both would double count revenue. Keep each stage separate and
    // only count settlement/penalty shares as realized platform/driver money.
    const ledgerTotals = ledger.reduce((acc, entry) => {
        const category = ledgerCategory(entry.event_type);
        const gross = Number(entry.gross_amount || 0);
        const platformFee = Number(entry.platform_fee || 0);
        const driverAmount = Number(entry.driver_amount || 0);
        const refund = Number(entry.refund_amount || 0);

        if (category === 'collection') acc.collections += gross;
        if (category === 'settlement') {
            acc.settledGross += gross;
            acc.fees += platformFee;
            acc.drivers += driverAmount;
        }
        if (category === 'penalty') {
            acc.penalties += gross;
            acc.fees += platformFee;
            acc.drivers += driverAmount;
        }
        if (category === 'refund') acc.refunds += refund;
        return acc;
    }, { collections: 0, settledGross: 0, fees: 0, drivers: 0, refunds: 0, penalties: 0 });


    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Card className="border-none shadow-xl rounded-3xl overflow-hidden bg-white">
                <CardHeader className="p-5 pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                                <Wallet className="h-6 w-6 text-amber-500" /> Solicitudes de Retiro
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Conductores esperando liquidación de ganancias.</CardDescription>
                        </div>
                        <Badge className="bg-slate-100 text-slate-500 border-none font-black px-4">{payouts.length} PENDIENTES</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest pl-8">Conductor</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-center">Fecha Solicitud</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-center">Importe</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-center">Estado</TableHead>
                                <TableHead className="text-right pr-8 font-black text-[10px] uppercase tracking-widest">Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {payouts.length > 0 ? (
                                payouts.map(p => (
                                    <TableRow key={p.id} className="border-slate-50 group hover:bg-slate-50/30 transition-colors">
                                        <TableCell className="pl-8">
                                            <div className="flex flex-col text-left">
                                                <span className="font-black text-slate-900 uppercase italic text-xs tracking-tighter">{p.profiles?.display_name || 'Usuario'}</span>
                                                <span className="text-[9px] font-bold text-slate-400">{p.profiles?.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center text-[10px] font-bold text-slate-500 uppercase">
                                            {format(new Date(p.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-black text-slate-900 italic tracking-tighter text-sm">{money(p.amount)}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="outline" className={cn(
                                                "capitalize font-black text-[9px] rounded-lg border-none px-3 py-1 tracking-widest",
                                                p.status === 'completed' ? "bg-emerald-50 text-emerald-600" :
                                                    p.status === 'rejected' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                                            )}>
                                                {p.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-8">
                                            {p.status === 'pending' && (
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-9 w-9 rounded-xl hover:bg-red-50 hover:text-red-600 transition-all shadow-sm active:scale-90"
                                                        onClick={() => handleProcessPayout(p.id, 'rejected')}
                                                        disabled={processingId === p.id}
                                                        title="Rechazar retiro"
                                                    >
                                                        <XCircle className="h-5 w-5" />
                                                    </Button>
                                                    <Button
                                                        className="h-9 rounded-xl bg-slate-900 hover:bg-primary text-white font-black text-[10px] uppercase tracking-widest px-4 shadow-lg active:scale-95 transition-all"
                                                        onClick={() => handleProcessPayout(p.id, 'completed')}
                                                        disabled={processingId === p.id}
                                                    >
                                                        {processingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aprobar"}
                                                    </Button>
                                                </div>
                                            )}
                                            {p.stripe_transfer_id && (
                                                <span className="text-[8px] font-mono text-slate-300 uppercase truncate max-w-[120px] inline-block">
                                                    ID: {p.stripe_transfer_id}
                                                </span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-20">
                                        <Wallet className="h-10 w-10 text-slate-100 mx-auto mb-4" />
                                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">No hay solicitudes de retiro pendientes</p>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card className="border-none shadow-xl rounded-3xl overflow-hidden bg-white">
                <CardHeader className="p-5 pb-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                                <ReceiptText className="h-6 w-6 text-primary" /> Ledger financiero por viaje
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Eventos por viaje; cobros, liquidaciones, penalizaciones y reembolsos se muestran por separado.</CardDescription>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                            <Badge className="justify-center bg-slate-100 text-slate-600 border-none font-black px-3 py-2">Cobrado/ret. {money(ledgerTotals.collections)}</Badge>
                            <Badge className="justify-center bg-violet-50 text-violet-600 border-none font-black px-3 py-2">Liquidado {money(ledgerTotals.settledGross)}</Badge>
                            <Badge className="justify-center bg-blue-50 text-blue-600 border-none font-black px-3 py-2">Comisión {money(ledgerTotals.fees)}</Badge>
                            <Badge className="justify-center bg-emerald-50 text-emerald-600 border-none font-black px-3 py-2">Conductor {money(ledgerTotals.drivers)}</Badge>
                            <Badge className="justify-center bg-amber-50 text-amber-600 border-none font-black px-3 py-2">Penalizaciones {money(ledgerTotals.penalties)}</Badge>
                            <Badge className="justify-center bg-red-50 text-red-600 border-none font-black px-3 py-2">Reembolsos {money(ledgerTotals.refunds)}</Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest pl-8">Fecha</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Viaje</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-center">Evento</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-right">Bruto</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-right">Comisión</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-right pr-8">Resultado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {ledger.length > 0 ? (
                                ledger.map(entry => (
                                    <TableRow key={entry.id} className="border-slate-50 hover:bg-slate-50/30 transition-colors">
                                        <TableCell className="pl-8 text-[10px] font-bold text-slate-500 uppercase">
                                            {format(new Date(entry.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-left max-w-[260px]">
                                                <span className="font-black text-slate-900 uppercase italic text-xs tracking-tighter truncate">
                                                    {locationLabel(entry.ride?.origin)} → {locationLabel(entry.ride?.destination)}
                                                </span>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase">
                                                    {entry.ride?.departure_time ? format(new Date(entry.ride.departure_time), 'dd/MM/yy HH:mm', { locale: es }) : 'Ride no disponible'} · {entry.ride?.status || 'sin estado'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge className={cn('border-none font-black text-[9px] px-3 py-1 uppercase tracking-widest', eventBadgeClass(entry.event_type))}>
                                                {eventLabel(entry.event_type)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-black text-slate-900 italic">{money(entry.gross_amount)}</TableCell>
                                        <TableCell className="text-right font-black text-blue-600 italic">{money(entry.platform_fee)}</TableCell>
                                        <TableCell className="text-right pr-8">
                                            <div className="flex items-center justify-end gap-1 font-black text-emerald-600 italic">
                                                {ledgerResult(entry) === null ? '—' : money(ledgerResult(entry))}
                                                {ledgerCategory(entry.event_type) !== 'collection' && <ShieldCheck className="h-3 w-3" />}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-20">
                                        <ReceiptText className="h-10 w-10 text-slate-100 mx-auto mb-4" />
                                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Aún no hay movimientos por viaje en el ledger</p>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card className="border-none shadow-xl rounded-3xl overflow-hidden bg-slate-900 text-white">
                <CardHeader className="p-5 pb-4">
                    <CardTitle className="text-xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                        <History className="h-6 w-6 text-primary" /> Historial de Comisiones
                    </CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Últimas comisiones generadas por la plataforma.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-white/5 border-none">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest pl-8 text-slate-400">Fecha</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400">Concepto</TableHead>
                                <TableHead className="text-right pr-8 font-black text-[10px] uppercase tracking-widest text-slate-400">Importe</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transactions.length > 0 ? (
                                transactions.map(tx => (
                                    <TableRow key={tx.id} className="border-white/5 hover:bg-white/5 transition-colors">
                                        <TableCell className="pl-8 text-[10px] font-bold text-slate-500 uppercase">
                                            {tx.date ? format(new Date(tx.date), 'dd/MM/yy HH:mm', { locale: es }) : 'N/A'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="size-2 rounded-full bg-primary shadow-lg shadow-primary/20" />
                                                <span className="font-black uppercase italic text-xs tracking-tight text-slate-200">{tx.description || 'Comisión de viaje'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-8">
                                            <div className="flex items-center justify-end gap-1 text-primary">
                                                <span className="font-black italic tracking-tighter text-lg">+{money(tx.amount)}</span>
                                                <ArrowUpRight className="h-3 w-3" />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center py-20 border-none">
                                        <History className="h-10 w-10 text-white/5 mx-auto mb-4" />
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest italic">No se han registrado comisiones aún</p>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};

export default FinanceTab;
