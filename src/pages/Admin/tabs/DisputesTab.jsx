import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, AlertCircle, CheckCircle, XCircle, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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
            const { data, error } = await supabase
                .from('cancellation_disputes')
                .select(`
                    *,
                    user:profiles!user_id(display_name, email),
                    ride:rides(id, origin, destination, departure_time)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDisputes(data || []);
        } catch (error) {
            toast.error('Error al cargar disputas', { description: error.message });
        } finally {
            setLoading(false);
        }
    };

    const handleResolve = async (disputeId, status) => {
        setProcessing(true);
        try {
            const { data, error } = await supabase.rpc('resolve_cancellation_dispute', {
                p_dispute_id: disputeId,
                p_status: status,
                p_admin_notes: adminNotes || null
            });

            if (error) throw error;

            toast.success(status === 'approved' ? 'Disputa aprobada' : 'Disputa rechazada');
            setSelectedDispute(null);
            setAdminNotes('');
            fetchDisputes();
        } catch (error) {
            toast.error('Error al resolver disputa', { description: error.message });
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
            <Badge className={`${variant.bg} ${variant.text} border-none font-bold text-[10px] rounded-lg px-3 py-1`}>
                {variant.label}
            </Badge>
        );
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center p-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <>
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500" /> Disputas por Fuerza Mayor
                    </CardTitle>
                    <CardDescription>
                        Usuarios solicitando reembolso excepcional por cancelaciones justificadas.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead>Usuario</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Viaje</TableHead>
                                <TableHead>Monto</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {disputes.length > 0 ? (
                                disputes.map(dispute => (
                                    <TableRow key={dispute.id} className="border-slate-50">
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-bold">{dispute.user?.display_name || 'Usuario'}</span>
                                                <span className="text-[10px] text-slate-400">{dispute.user?.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize text-[10px]">
                                                {dispute.user_type === 'driver' ? 'Conductor' : 'Pasajero'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            <div className="max-w-[200px] truncate">
                                                {dispute.ride?.origin?.name} → {dispute.ride?.destination?.name}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-black text-slate-900">
                                            {parseFloat(dispute.refund_amount || 0).toFixed(2)}€
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-500">
                                            {format(new Date(dispute.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(dispute.status)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 rounded-lg hover:bg-slate-50"
                                                onClick={() => setSelectedDispute(dispute)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-10 text-slate-400 font-medium">
                                        No hay disputas pendientes.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Dialog de Detalles */}
            <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Detalles de la Disputa
                        </DialogTitle>
                        <DialogDescription>
                            Revisa la información y evidencia antes de tomar una decisión.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedDispute && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Usuario</label>
                                    <p className="text-sm">{selectedDispute.user?.display_name}</p>
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Tipo</label>
                                    <p className="text-sm capitalize">{selectedDispute.user_type === 'driver' ? 'Conductor' : 'Pasajero'}</p>
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Monto a Reembolsar</label>
                                    <p className="text-lg font-black text-primary">{parseFloat(selectedDispute.refund_amount || 0).toFixed(2)}€</p>
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Estado</label>
                                    <div className="mt-1">{getStatusBadge(selectedDispute.status)}</div>
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-bold text-slate-700">Motivo</label>
                                <p className="text-sm mt-1 p-3 bg-slate-50 rounded-lg">{selectedDispute.reason}</p>
                            </div>

                            {selectedDispute.evidence_urls && selectedDispute.evidence_urls.length > 0 && (
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Evidencia</label>
                                    <div className="flex gap-2 mt-2">
                                        {selectedDispute.evidence_urls.map((url, idx) => (
                                            <a
                                                key={idx}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-primary hover:underline flex items-center gap-1"
                                            >
                                                <FileText className="h-3 w-3" />
                                                Archivo {idx + 1}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedDispute.status === 'pending' && (
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Notas del Administrador</label>
                                    <Textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        placeholder="Añade notas sobre tu decisión (opcional)"
                                        className="mt-2"
                                        rows={3}
                                    />
                                </div>
                            )}

                            {selectedDispute.admin_notes && (
                                <div>
                                    <label className="text-sm font-bold text-slate-700">Notas del Administrador</label>
                                    <p className="text-sm mt-1 p-3 bg-slate-50 rounded-lg">{selectedDispute.admin_notes}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {selectedDispute?.status === 'pending' && (
                        <DialogFooter className="gap-2">
                            <Button
                                variant="outline"
                                onClick={() => handleResolve(selectedDispute.id, 'rejected')}
                                disabled={processing}
                                className="border-red-200 text-red-600 hover:bg-red-50"
                            >
                                <XCircle className="h-4 w-4 mr-2" />
                                Rechazar
                            </Button>
                            <Button
                                onClick={() => handleResolve(selectedDispute.id, 'approved')}
                                disabled={processing}
                                className="bg-emerald-600 hover:bg-emerald-700"
                            >
                                {processing ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                )}
                                Aprobar Reembolso
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};

export default DisputesTab;
