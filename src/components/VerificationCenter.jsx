import { useState, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import {
    Loader2, AlertCircle, Clock, UploadCloud,
    CheckCircle2, FileX2, Shield, Fingerprint, BadgeCheck,
    Sparkles, AlertTriangle, FileCheck2, Camera, ShieldCheck
} from 'lucide-react';
import SubPageHeader from './SubPageHeader';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import imageCompression from 'browser-image-compression';
import { cn } from '@/lib/utils';
import { createNotification } from '../services/notificationService';

const VerificationStatus = ({ profile }) => {
    const verification = profile?.verification || {};
    const status = verification.status || 'not_verified';

    const STATUS_MAP = {
        not_verified: {
            text: 'Pendiente de Inicio',
            icon: Shield,
            color: 'bg-slate-900 border-white/10 text-white',
            badge: 'bg-white/10 text-white/40',
            description: 'Verifica tu identidad para poder publicar viajes y generar confianza.'
        },
        pending: {
            text: 'En Revisión',
            icon: Clock,
            color: 'bg-indigo-600 border-indigo-400 text-white',
            badge: 'bg-white/10 text-white/40',
            description: 'Estamos validando tus documentos. Este proceso suele tardar menos de 24h.'
        },
        verified: {
            text: 'Verificado',
            icon: BadgeCheck,
            color: 'bg-emerald-600 border-emerald-400 text-white',
            badge: 'bg-white/10 text-white/60',
            description: '¡Felicidades! Tu cuenta cumple con todos los estándares de seguridad.'
        },
        rejected: {
            text: 'Rechazado',
            icon: AlertTriangle,
            color: 'bg-red-600 border-red-400 text-white',
            badge: 'bg-white/10 text-white/60',
            description: verification.rejectionReason || 'Algunos documentos no fueron válidos. Por favor, revísalos.'
        }
    };

    const current = STATUS_MAP[status] || STATUS_MAP.not_verified;
    const Icon = current.icon; // Sintaxis correcta para componentes dinámicos

    return (
        <Card className={cn("rounded-[3rem] border-none shadow-2xl overflow-hidden relative", current.color)}>
            <div className="absolute top-0 right-0 p-10 opacity-10"><Icon className="size-32" /></div>
            <CardContent className="p-10 relative z-10 space-y-6 text-left">
                <div className="flex items-center gap-4">
                    <div className={cn("size-14 rounded-2xl flex items-center justify-center shadow-xl", current.badge)}><Icon className="h-8 w-8" /></div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">ShareWay Trust Hub</p>
                        <h2 className="text-3xl font-black tracking-tighter italic uppercase leading-none">{current.text}</h2>
                    </div>
                </div>
                <p className="text-sm font-bold opacity-70 max-w-[80%] leading-relaxed">{current.description}</p>
            </CardContent>
        </Card>
    );
};

const DocumentUploader = ({ type, title, description, status, onFileSelect, isUploading, isDisabled }) => {
    const STATUS_MAP = {
        pending: { text: 'PENDIENTE', icon: Clock, color: 'text-indigo-400 bg-indigo-500/10' },
        verified: { text: 'ACEPTADO', icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10' },
        rejected: { text: 'RECHAZADO', icon: FileX2, color: 'text-red-400 bg-red-500/10' },
    };
    const currentStatus = STATUS_MAP[status];
    const StatusIcon = currentStatus?.icon;

    return (
        <div className={cn(
            "p-8 bg-white border border-slate-100 rounded-[2.5rem] transition-all duration-500 group relative overflow-hidden",
            isDisabled && "opacity-40 grayscale pointer-events-none"
        )}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                    <div className={cn("size-16 rounded-[1.5rem] flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 duration-500", status === 'verified' ? "bg-emerald-50 text-emerald-500" : "bg-slate-50 text-slate-400")}>
                        {type === 'idCard' ? <Fingerprint className="size-8" /> : (type === 'driverLicense' ? <Camera className="size-8" /> : <FileCheck2 className="size-8" />)}
                    </div>
                    <div className="space-y-1 text-left">
                        <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic">{title}</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest max-w-[240px] leading-relaxed">{description}</p>
                    </div>
                </div>

                <div className="flex flex-col items-start md:items-end gap-3 min-w-[140px]">
                    {currentStatus ? (
                        <div className={cn("flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 text-[9px] font-black uppercase tracking-widest shadow-sm", currentStatus.color)}>
                            <StatusIcon className="h-3.5 w-3.5" /> {currentStatus.text}
                        </div>
                    ) : (
                        <Button
                            onClick={() => onFileSelect(type)}
                            disabled={isUploading || isDisabled}
                            className="h-14 rounded-2xl bg-slate-900 shadow-2xl hover:scale-105 active:scale-95 transition-all text-[10px] font-black uppercase tracking-[0.2em] px-8 text-white border-none"
                        >
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UploadCloud className="h-4 w-4 mr-2" />}
                            VINCULAR
                        </Button>
                    )}
                </div>
            </div>
            {isUploading && <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-20"><Loader2 className="size-8 text-primary animate-spin" /></div>}
        </div>
    );
};

function VerificationCenter() {
    const { profile, user: currentUser, isLoading: profileLoading, refreshProfile } = useOutletContext();
    const [uploading, setUploading] = useState({});
    const fileInputRef = useRef(null);
    const currentUploadType = useRef(null);

    const handleFileSelect = (uploadType) => {
        currentUploadType.current = uploadType;
        fileInputRef.current.click();
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        const uploadType = currentUploadType.current;
        if (!file || !currentUser || !uploadType) return;

        setUploading(prev => ({ ...prev, [uploadType]: true }));
        const toastId = toast.loading(`Cifrando y subiendo documento...`);

        try {
            const compressedFile = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1600 });
            const filePath = `${currentUser.id}/${uploadType}_${Date.now()}.jpg`;

            // 1. Subida a Storage
            const { error: uploadError } = await supabase.storage
                .from('verification-documents')
                .upload(filePath, compressedFile, { upsert: true });

            if (uploadError) throw uploadError;

            // 2. Actualización de Perfil
            const updatedDocuments = {
                ...(profile?.documents || {}),
                [uploadType]: {
                    status: 'pending',
                    path: filePath,
                    lastUpdated: new Date().toISOString()
                }
            };

            const { error: updateError } = await supabase
                .from('profiles')
                .update({
                    documents: updatedDocuments,
                    verification: {
                        ...(profile?.verification || {}),
                        status: 'pending'
                    }
                })
                .eq('id', currentUser.id);

            if (updateError) throw updateError;

            // 3. Notificación Feedback (Silenciosa si falla)
            try {
                await createNotification({
                    userId: currentUser.id,
                    title: 'Validación Iniciada',
                    content: 'Hemos recibido tu documento. Te avisaremos cuando se complete la revisión.',
                    type: 'info'
                });
            } catch (e) {
                console.warn("Notification failed, but upload succeeded.");
            }

            toast.success("Documento enviado", { id: toastId });
            if (refreshProfile) await refreshProfile();
        } catch (error) {
            console.error("Verification upload failed:", error);
            toast.error("Error al subir documento", { id: toastId, description: error.message || "Verifica tu conexión." });
        } finally {
            setUploading(prev => ({ ...prev, [uploadType]: false }));
            currentUploadType.current = null;
            if (event.target) event.target.value = '';
        }
    };

    if (profileLoading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin h-12 w-12 text-primary opacity-20" strokeWidth={1} /></div>;
    if (!profile) return <div className="h-screen flex items-center justify-center bg-slate-50"><p className="text-xs font-black uppercase text-slate-400 tracking-widest">Error al cargar perfil</p></div>;

    const documents = profile.documents || {};
    const isIdentityVerified = profile.verification?.status === 'verified';

    return (
        <div className="min-h-screen bg-slate-50 pb-40 font-sans">
            <SubPageHeader title="Trust Center" />
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/png, image/jpeg" hidden />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-12">
                <VerificationStatus profile={profile} />

                <div className="space-y-6">
                    <div className="flex items-center justify-between px-4">
                        <div className="space-y-1 text-left">
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest italic">1. Protocolo de Identidad</h3>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Requerido para generar confianza</p>
                        </div>
                        <div className="size-10 bg-white rounded-full border border-slate-100 shadow-sm flex items-center justify-center text-[10px] font-black text-slate-400">01</div>
                    </div>

                    <DocumentUploader
                        type="idCard"
                        title="Documento Nacional"
                        description="Parte frontal legible de tu ID oficial / DNI"
                        status={documents.idCard?.status}
                        onFileSelect={handleFileSelect}
                        isUploading={uploading.idCard}
                    />
                </div>

                <div className="space-y-6">
                    <div className="flex items-center justify-between px-4">
                        <div className="space-y-1 text-left">
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest italic">2. Credenciales de Conducción</h3>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Necesario para ofrecer plazas</p>
                        </div>
                        <div className="size-10 bg-white rounded-full border border-slate-100 shadow-sm flex items-center justify-center text-[10px] font-black text-slate-400">02</div>
                    </div>

                    {!isIdentityVerified && (
                        <div className="p-8 bg-indigo-50 border border-indigo-100 rounded-[2.5rem] flex items-start gap-5 animate-in fade-in duration-700 text-left">
                            <AlertCircle className="h-5 w-5 text-indigo-500 shrink-0" />
                            <p className="text-[10px] font-black text-indigo-900/60 leading-relaxed uppercase tracking-widest">
                                Debes completar el Paso 1 antes de poder subir credenciales de conductor.
                            </p>
                        </div>
                    )}

                    <div className="space-y-4">
                        <DocumentUploader
                            type="driverLicense"
                            title="Licencia de Conducir"
                            description="Permiso oficial de conducción vigente"
                            status={documents.driverLicense?.status}
                            onFileSelect={handleFileSelect}
                            isUploading={uploading.driverLicense}
                            isDisabled={!isIdentityVerified}
                        />
                        <DocumentUploader
                            type="vehicleRegistration"
                            title="Permiso de Circulación"
                            description="Documentación técnica del vehículo"
                            status={documents.vehicleRegistration?.status}
                            onFileSelect={handleFileSelect}
                            isUploading={uploading.vehicleRegistration}
                            isDisabled={!isIdentityVerified}
                        />
                    </div>
                </div>

                <div className="bg-slate-900 p-10 rounded-[3rem] relative overflow-hidden group shadow-2xl text-left">
                    <div className="absolute top-0 right-0 p-10 opacity-5"><ShieldCheck className="size-24 text-white" /></div>
                    <div className="relative z-10 space-y-4">
                        <div className="flex items-center gap-3">
                            <ShieldCheck className="size-5 text-primary" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Seguridad de Nivel Militar</h4>
                        </div>
                        <p className="text-[10px] font-bold text-white/40 leading-relaxed uppercase tracking-widest">
                            Tus documentos son encriptados y procesados exclusivamente para validación de cuenta. Cumplimos con los estándares RGPD para garantizar tu privacidad total.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default VerificationCenter;
