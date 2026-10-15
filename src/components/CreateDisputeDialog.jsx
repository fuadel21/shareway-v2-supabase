import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, Upload, ShieldAlert, Fingerprint, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Componente para crear una disputa de cancelación por fuerza mayor
 * @param {Object} props
 * @param {boolean} props.open - Si el diálogo está abierto
 * @param {Function} props.onOpenChange - Callback para cambiar el estado
 * @param {string} props.rideId - ID del viaje cancelado
 * @param {Function} props.onSuccess - Callback al crear exitosamente
 */
const CreateDisputeDialog = ({ open, onOpenChange, rideId, onSuccess }) => {
    const [reason, setReason] = useState('');
    const [evidenceFiles, setEvidenceFiles] = useState([]);
    const [safetyEvidence, setSafetyEvidence] = useState(null);
    const [includeSafetyEvidence, setIncludeSafetyEvidence] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loadingSafety, setLoadingSafety] = useState(false);

    // Buscar evidencias SOS vinculadas a este viaje
    React.useEffect(() => {
        if (open && rideId) {
            const fetchSafety = async () => {
                setLoadingSafety(true);
                try {
                    const { data, error } = await supabase
                        .from('safety_evidence')
                        .select('id, type, created_at')
                        .eq('ride_id', rideId)
                        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
                        .maybeSingle();

                    if (data) setSafetyEvidence(data);
                } catch (e) {
                    console.error("Error fetching safety evidence:", e);
                } finally {
                    setLoadingSafety(false);
                }
            };
            fetchSafety();
        }
    }, [open, rideId]);

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length + evidenceFiles.length > 3) {
            toast.error('Máximo 3 archivos de evidencia');
            return;
        }
        setEvidenceFiles([...evidenceFiles, ...files]);
    };

    const removeFile = (index) => {
        setEvidenceFiles(evidenceFiles.filter((_, i) => i !== index));
    };

    const uploadEvidence = async () => {
        if (evidenceFiles.length === 0) return [];

        setUploading(true);
        const uploadedUrls = [];

        try {
            for (const file of evidenceFiles) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
                const filePath = `dispute-evidence/${fileName}`;

                const { data, error } = await supabase.storage
                    .from('public')
                    .upload(filePath, file);

                if (error) throw error;

                const { data: { publicUrl } } = supabase.storage
                    .from('public')
                    .getPublicUrl(filePath);

                uploadedUrls.push(publicUrl);
            }
        } catch (error) {
            toast.error('Error al subir archivos', { description: error.message });
            throw error;
        } finally {
            setUploading(false);
        }

        return uploadedUrls;
    };

    const handleSubmit = async () => {
        if (!reason.trim()) {
            toast.error('Debes proporcionar un motivo');
            return;
        }

        setSubmitting(true);

        try {
            // Subir evidencia si existe
            const evidenceUrls = await uploadEvidence();

            // Crear la disputa con integración SOS
            const { data, error } = await supabase.rpc('create_cancellation_dispute', {
                p_ride_id: rideId,
                p_reason: reason,
                p_evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : null,
                p_safety_evidence_id: (includeSafetyEvidence && safetyEvidence) ? safetyEvidence.id : null
            });

            if (error) throw error;
            if (data && data.success === false) throw new Error(data.message);

            toast.success('Disputa creada', {
                description: includeSafetyEvidence && safetyEvidence
                    ? 'Se ha incluido la grabación SOS en el reporte.'
                    : 'Un administrador revisará tu caso pronto.'
            });

            setReason('');
            setEvidenceFiles([]);
            onOpenChange(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            toast.error('Error al crear disputa', { description: error.message });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg rounded-3xl border-none shadow-2xl p-0 overflow-hidden">
                <div className="bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] p-6 text-white relative">
                    <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12">
                        <AlertCircle size={80} />
                    </div>
                    <DialogHeader className="relative z-10">
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                            <ShieldAlert className="h-6 w-6 text-amber-400" />
                            Revisión de Seguridad
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 font-bold uppercase text-[10px] tracking-[0.2em] pt-1">
                            Centro de Disputas y Fuerza Mayor
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="p-8 space-y-6">
                    {/* Sección de Evidencia SOS Automática */}
                    {!loadingSafety && safetyEvidence && (
                        <div className={cn(
                            "p-5 rounded-3xl border-2 transition-all duration-300 flex items-center justify-between gap-4",
                            includeSafetyEvidence ? "bg-amber-50 border-amber-200 shadow-lg shadow-amber-100/50" : "bg-slate-50 border-slate-100 opacity-60"
                        )}>
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "size-12 rounded-2xl flex items-center justify-center shadow-inner",
                                    includeSafetyEvidence ? "bg-amber-100 text-amber-600" : "bg-slate-200 text-slate-400"
                                )}>
                                    <Fingerprint size={24} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none mb-1">Evidencia SOS Detectada</p>
                                    <p className="text-xs font-bold text-slate-900">Grabación de Seguridad SOS</p>
                                    <p className="text-[9px] font-medium text-slate-400 italic">ID: {safetyEvidence.id.substring(0, 8)}...</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIncludeSafetyEvidence(!includeSafetyEvidence)}
                                className={cn(
                                    "rounded-xl font-black text-[9px] uppercase tracking-widest px-4 h-10 transition-all",
                                    includeSafetyEvidence ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-slate-200 text-slate-500"
                                )}
                            >
                                {includeSafetyEvidence ? 'Incluida' : 'Incluir'}
                            </Button>
                        </div>
                    )}

                    <div className="space-y-3">
                        <Label htmlFor="reason" className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-2">
                            Declaración de los hechos
                        </Label>
                        <Textarea
                            id="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Describe detalladamente qué sucedió..."
                            className="min-h-[120px] rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:bg-white transition-all text-sm font-medium resize-none p-5"
                            maxLength={500}
                        />
                        <div className="flex justify-end">
                            <span className="text-[9px] font-black uppercase text-slate-300 tracking-widest italic">{reason.length}/500</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-2">Anexos Manuales (Máx. 3)</Label>
                        <div className="grid grid-cols-1 gap-2">
                            {evidenceFiles.map((file, index) => (
                                <div key={index} className="flex items-center justify-between p-3 bg-white border-2 border-slate-50 rounded-2xl shadow-sm animate-in slide-in-from-right-2">
                                    <div className="flex items-center gap-3 truncate">
                                        <div className="size-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                                            <Upload size={14} className="text-slate-400" />
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-600 truncate">{file.name}</span>
                                    </div>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => removeFile(index)}
                                        className="size-8 rounded-xl text-red-400 hover:text-red-500 hover:bg-red-50"
                                    >
                                        <X size={16} />
                                    </Button>
                                </div>
                            ))}

                            {evidenceFiles.length < 3 && (
                                <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-3xl cursor-pointer hover:border-primary/40 hover:bg-primary/[0.02] transition-all group">
                                    <div className="size-10 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                        <Upload size={18} className="text-slate-300 group-hover:text-primary" />
                                    </div>
                                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest group-hover:text-primary">Adjuntar Documentos</span>
                                    <input
                                        type="file"
                                        accept="image/*,.pdf"
                                        onChange={handleFileChange}
                                        className="hidden"
                                        multiple
                                    />
                                </label>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-8 bg-slate-50 flex flex-row gap-3">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting || uploading}
                        className="h-14 flex-1 rounded-2xl font-black uppercase tracking-widest text-[10px] text-slate-400 hover:bg-white"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={submitting || uploading || !reason.trim()}
                        className="h-14 flex-[2] rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase italic tracking-normal text-[11px] shadow-xl active:scale-95 transition-all"
                    >
                        {(submitting || uploading) ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                            'Enviar Reporte Elite'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CreateDisputeDialog;
