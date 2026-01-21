import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';

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
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

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

            // Crear la disputa
            const { data, error } = await supabase.rpc('create_cancellation_dispute', {
                p_ride_id: rideId,
                p_reason: reason,
                p_evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : null
            });

            if (error) throw error;

            toast.success('Disputa creada', {
                description: 'Un administrador revisará tu caso pronto.'
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
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                        Solicitar Revisión por Fuerza Mayor
                    </DialogTitle>
                    <DialogDescription>
                        Si tuviste una emergencia médica, accidente u otra situación de fuerza mayor,
                        puedes solicitar un reembolso excepcional. Proporciona evidencia si es posible.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <Label htmlFor="reason" className="text-sm font-bold">
                            Motivo de la Cancelación <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Describe detalladamente qué sucedió (ej: tuve un accidente de tráfico, enfermedad repentina, etc.)"
                            className="mt-2"
                            rows={4}
                            maxLength={500}
                        />
                        <p className="text-xs text-slate-400 mt-1">{reason.length}/500 caracteres</p>
                    </div>

                    <div>
                        <Label className="text-sm font-bold">Evidencia (Opcional)</Label>
                        <p className="text-xs text-slate-500 mb-2">
                            Sube hasta 3 archivos (parte médico, fotos del accidente, etc.)
                        </p>

                        <div className="space-y-2">
                            {evidenceFiles.map((file, index) => (
                                <div key={index} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                                    <span className="text-xs truncate flex-1">{file.name}</span>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => removeFile(index)}
                                        className="h-6 w-6 p-0 text-red-500 hover:bg-red-50"
                                    >
                                        ×
                                    </Button>
                                </div>
                            ))}

                            {evidenceFiles.length < 3 && (
                                <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-primary hover:bg-slate-50 transition-colors">
                                    <Upload className="h-4 w-4 text-slate-400" />
                                    <span className="text-sm text-slate-600">Subir archivo</span>
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

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <p className="text-xs text-amber-800">
                            <strong>Importante:</strong> Las disputas son revisadas manualmente por nuestro equipo.
                            Solo se aprueban casos excepcionales con evidencia verificable.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting || uploading}
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={submitting || uploading || !reason.trim()}
                        className="bg-amber-600 hover:bg-amber-700"
                    >
                        {(submitting || uploading) ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {uploading ? 'Subiendo...' : 'Enviando...'}
                            </>
                        ) : (
                            'Enviar Solicitud'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CreateDisputeDialog;
