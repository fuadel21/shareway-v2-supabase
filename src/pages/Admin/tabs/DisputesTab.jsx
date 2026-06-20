import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, AlertCircle, CheckCircle, XCircle, Eye, FileText, Gavel } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { getDisputesList, resolveDispute } from '@/lib/supabaseRPC';

const safeMoney = (value) => {
    const amount = Number.parseFloat(value || 0);
    return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
};

const safeDate = (value) => {
    if (!value) return 'Sin fecha';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Fecha inválida';
        return format(date, 'dd MMM HH:mm', { locale: es });
    } catch {
        return 'Fecha inválida';
    }
};

const normalizeEvidenceUrls = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [value].filter(Boolean);
        } catch {
            return [value].filter(Boolean);
        }
    }
    return [];
};

const DisputesTab = () => {
    const [disputes, setDisputes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDispute, setSelectedDispute] = useState(null);
    const [adminNotes, setAdminNotes] = useState('');
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        fetchDisputes();
    }, []);

    const fetchDisputes = async () => {
        setLoading(true);
        try {
            const { data, success, error } = await getDisputesList();
            if (!success) throw new Error(error);
            setDisputes(data || []);
        } catch (error) {
            toast.error('Error al cargar disputas', { description: error.message });
        } finally {
            setLoading(false);
        }
    };

    const openDispute = (dispute) => {
        setAdminNotes('');
        setSelectedDispute(dispute);
    };

    const closeDispute = () => {
        setSelectedDispute(null);
        setAdminNotes('');
    };

    const handleResolve = async (disputeId, status) => {
        if (!disputeId) return;
        setProcessing(true);
        const isApproval = status === 'approved';
        const toastId = toast.loading(isApproval ? 'Procesando reembolso...' : 'Rechazando disputa...');

        try {
            const { success, error } = await resolveDispute(disputeId, status, adminNotes.trim() || null);

            if (!success) throw new Error(error);

            toast.success(isApproval ? '¡Reembolso emitido con éxito!' : 'Disputa rechazada correctamente', { id: toastId });
            closeDispute();
            fetchDisputes();
        } catch (error) {
            console.error('🚨 Resolve Dispute Error:', error);
            toast.error('Error al resolver disputa', { id: toastId, description: error.message });
        } finally {
            setProcessing(false);
        }
    };

    const getStatusBadge = (status) => {
        const variants = {
            pending: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Pendiente' },
            approved: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Aprobada' },
            rejected: { bg: 'bg-red-50', text: 'text-red-600', label: 'Rechazada' }
        };
        const variant = variants[status] || variants.pending;
        return (
            <Badge className={`${variant.bg} ${variant.text} border-none font-black text-[9px] uppercase tracking-widest rounded-lg px-3 py-1`}>
                {variant.label}
            </Badge>
        );
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center p-32 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 italic">Sincronizando Tribunal...</p>
            </div>
        );
    }

    const selectedEvidenceUrls = normalizeEvidenceUrls(selectedDispute?.evidence_urls);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                    <div className="bg-amber-500 p-2 rounded-xl text-white shadow-lg shadow-amber-100"><Gavel size={18} /></div>
                    <div className="text-left">
                        <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">Gestión de Conflictos</h3>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Resolución de fuerza mayor y abusos</p>
                    </div>
                </div>
                <Badge variant="outline" className="rounded-xl border-slate-100 font-bold text-slate-400">{disputes.length} CASOS</Badge>
            </div>

            <Card className="border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="hover:bg-transparent border-slate-100 h-14">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest pl-8">Usuario</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Tipo</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-center">Monto</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Fecha</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest">Estado</TableHead>
                                <TableHead className="text-right pr-8 font-black text-[10px] uppercase tracking-widest">Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {disputes.length > 0 ? (
                                disputes.map(dispute => (
                                    <TableRow key={dispute.id} className="border-slate-50 group hover:bg-slate-50/30 transition-colors">
                                        <TableCell className="pl-8">
                                            <div className="flex flex-col text-left">
                                                <span className="font-black text-slate-900 uppercase italic text-xs tracking-tighter">{dispute.user?.display_name || 'Usuario'}</span>
                                                <span className="text-[9px] font-bold text-slate-400">{dispute.user?.email || 'Sin correo'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize text-[8px] font-black tracking-widest rounded-lg border-slate-100 bg-white shadow-sm">
                                                {dispute.user_type === 'driver' ? 'Conductor' : 'Pasajero'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-black text-slate-900 italic tracking-tighter text-sm">
                                                {safeMoney(dispute.refund_amount)}€
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-bold text-slate-500 uppercase">
                                            {safeDate(dispute.created_at)}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(dispute.status)}</TableCell>
                                        <TableCell className="text-right pr-8">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-10 w-10 rounded-xl hover:bg-white hover:shadow-md transition-all text-primary"
                                                onClick={() => openDispute(dispute)}
                                                title="Ver caso"
                                            >
                                                <Eye className="h-5 w-5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-20">
                                        <AlertCircle className="h-10 w-10 text-slate-100 mx-auto mb-4" />
                                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">No hay casos pendientes de revisión</p>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={!!selectedDispute} onOpenChange={(open) => { if (!open) closeDispute(); }}>
                <DialogContent className="max-w-2xl rounded-[2.5rem] border-none shadow-2xl p-8 bg-white overflow-hidden">
                    <DialogHeader className="space-y-2">
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 flex items-center gap-3">
                            <div className="size-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg"><FileText className="h-5 w-5 text-primary" /></div>
                            Detalles del Caso
                        </DialogTitle>
                        <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">Auditoría Operativa ShareWay</DialogDescription>
                    </DialogHeader>

                    {selectedDispute && (
                        <div className="space-y-6 pt-4 animate-in zoom-in-95 duration-300">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Usuario Demandante</label>
                                    <p className="text-sm font-black text-slate-900 uppercase italic tracking-tight">{selectedDispute.user?.display_name || 'Usuario'}</p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Monto Solicitado</label>
                                    <p className="text-xl font-black text-primary italic tracking-tighter">{safeMoney(selectedDispute.refund_amount)}€</p>
                                </div>
                            </div>

                            <div className="p-6 bg-slate-950 rounded-[2rem] text-white relative overflow-hidden group">
                                <Gavel className="absolute -right-4 -bottom-4 size-24 opacity-5 group-hover:rotate-12 transition-transform duration-700" />
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3 block">Motivo de la Disputa</label>
                                <p className="text-sm font-medium italic leading-relaxed text-slate-200">&quot;{selectedDispute.reason || 'Sin motivo detallado'}&quot;</p>
                            </div>

                            {selectedEvidenceUrls.length > 0 && (
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 italic">Evidencia Adjunta</label>
                                    <div className="flex flex-wrap gap-3">
                                        {selectedEvidenceUrls.map((url, idx) => (
                                            <Button
                                                key={`${url}-${idx}`}
                                                variant="outline"
                                                className="rounded-xl border-slate-100 font-bold text-[10px] uppercase tracking-widest gap-2 bg-slate-50 hover:bg-white shadow-sm"
                                                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                                            >
                                                <FileText className="h-3 w-3 text-primary" /> Documento {idx + 1}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedDispute.status === 'pending' && (
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 italic">Notas de Resolución</label>
                                    <Textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        placeholder="Justifica tu decisión aquí. Estas notas serán enviadas al usuario."
                                        className="min-h-[100px] rounded-2xl bg-slate-50 border-none shadow-inner p-5 font-medium italic text-slate-600 focus-visible:ring-primary/20"
                                    />
                                </div>
                            )}

                            {selectedDispute.admin_notes && (
                                <div className="p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                                    <label className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2 block">Resolución de Admin</label>
                                    <p className="text-xs font-bold text-emerald-900 italic leading-relaxed">{selectedDispute.admin_notes}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {selectedDispute?.status === 'pending' && (
                        <DialogFooter className="mt-8 gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => handleResolve(selectedDispute.id, 'rejected')}
                                disabled={processing}
                                className="flex-1 h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest text-red-500 hover:bg-red-50"
                            >
                                <XCircle className="h-4 w-4 mr-2" /> Rechazar
                            </Button>
                            <Button
                                onClick={() => handleResolve(selectedDispute.id, 'approved')}
                                disabled={processing}
                                className="flex-[2] h-14 rounded-2xl bg-slate-900 hover:bg-primary text-white font-black text-[10px] uppercase tracking-widest shadow-xl transition-all active:scale-95"
                            >
                                {processing ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <CheckCircle className="h-4 w-4 mr-2 text-primary" />
                                )}
                                Aprobar y Reembolsar
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default DisputesTab;
