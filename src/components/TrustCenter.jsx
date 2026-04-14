import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { BadgeCheck, ShieldCheck, Mail, Briefcase, Fingerprint, Star, ShieldAlert, ChevronRight, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export default function TrustCenter() {
    const { user, profile, fetchProfile } = useOutletContext();
    const [isVerifying, setIsVerifying] = useState(null); // 'id', 'work', 'social'

    const handleVerify = async (type) => {
        setIsVerifying(type);
        // Simulación de proceso de verificación Élite
        setTimeout(async () => {
            try {
                const updates = {};
                if (type === 'id') updates.is_verified_id = true;
                if (type === 'work') updates.is_verified_work = true;

                const { error } = await supabase
                    .from('profiles')
                    .update(updates)
                    .eq('id', user.id);

                if (error) throw error;
                
                toast.success(`¡Verificación de ${type.toUpperCase()} completada!`);
                fetchProfile();
            } catch (err) {
                toast.error("Error en la verificación");
            } finally {
                setIsVerifying(null);
            }
        }, 2000);
    };

    return (
        <div className="space-y-6 animate-elite-in pb-20">
            {/* Cabecera de Confianza */}
            <div className="text-left space-y-2">
                <h2 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">Trust Center</h2>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Eleva tu reputación y viaja con más seguridad</p>
            </div>

            {/* Score de Confianza */}
            <Card className="border-none shadow-diamond overflow-hidden relative group bg-slate-900 text-white">
                <div className="absolute inset-0 bg-gradient-premium opacity-20" />
                <CardContent className="p-8 relative z-10 flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Nivel de Confianza</p>
                        <h3 className="text-3xl font-black italic tracking-tighter">
                            {profile?.is_verified_id && profile?.is_verified_work ? 'PERFIL VERIFICADO' : 'PERFIL BÁSICO'}
                        </h3>
                    </div>
                    <div className="size-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/20">
                        <ShieldCheck className={cn("size-8", profile?.is_verified_id ? "text-primary" : "text-white/20")} />
                    </div>
                </CardContent>
            </Card>

            {/* Pasos de Verificación */}
            <div className="grid gap-4">
                {/* DNI / ID */}
                <Card className="border-none shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
                    <CardContent className="p-0">
                        <div className="flex items-center justify-between p-6">
                            <div className="flex items-center gap-4">
                                <div className="size-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                    <Fingerprint size={24} />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-black text-slate-900 tracking-tight uppercase text-sm">Identidad Oficial</h4>
                                    <p className="text-[10px] font-bold text-slate-400">DNI, Pasaporte o Carnet de Conducir</p>
                                </div>
                            </div>
                            {profile?.is_verified_id ? (
                                <CheckCircle2 className="text-emerald-500 size-6" />
                            ) : (
                                <Button 
                                    onClick={() => handleVerify('id')} 
                                    disabled={isVerifying === 'id'}
                                    variant="outline" 
                                    size="sm" 
                                    className="rounded-full font-black text-[10px] uppercase px-4"
                                >
                                    {isVerifying === 'id' ? <Loader2 className="animate-spin size-3" /> : 'Verificar'}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Trabajo / Empresa */}
                <Card className="border-none shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
                    <CardContent className="p-0">
                        <div className="flex items-center justify-between p-6">
                            <div className="flex items-center gap-4">
                                <div className="size-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                    <Briefcase size={24} />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-black text-slate-900 tracking-tight uppercase text-sm">Empresa / Trabajo</h4>
                                    <p className="text-[10px] font-bold text-slate-400">Añade tu email corporativo</p>
                                </div>
                            </div>
                            {profile?.is_verified_work ? (
                                <CheckCircle2 className="text-emerald-500 size-6" />
                            ) : (
                                <Button 
                                    onClick={() => handleVerify('work')} 
                                    disabled={isVerifying === 'work'}
                                    variant="outline" 
                                    size="sm" 
                                    className="rounded-full font-black text-[10px] uppercase px-4"
                                >
                                    {isVerifying === 'work' ? <Loader2 className="animate-spin size-3" /> : 'Añadir'}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Email Verification */}
                <Card className="border-none shadow-sm opacity-60">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="size-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
                                <Mail size={24} />
                            </div>
                            <div className="text-left">
                                <h4 className="font-black text-slate-900 tracking-tight uppercase text-sm">Email</h4>
                                <p className="text-[10px] font-bold text-slate-400 italic">{user?.email}</p>
                            </div>
                        </div>
                        <CheckCircle2 className="text-emerald-500 size-6" />
                    </CardContent>
                </Card>
            </div>

            {/* Sección de Seguridad SOS */}
            <div className="pt-6 space-y-4">
                <h3 className="text-lg font-black italic tracking-tighter text-slate-900 uppercase flex items-center gap-2">
                    <ShieldAlert size={20} className="text-red-500" /> Seguridad Avanzada
                </h3>
                <Card onClick={() => toast.info("Función en desarrollo")} className="border-none shadow-diamond bg-red-50 hover:bg-red-100 transition-colors cursor-pointer group">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div className="space-y-1">
                            <h4 className="font-black text-red-900 uppercase text-xs tracking-tight">Contactos de Emergencia</h4>
                            <p className="text-[10px] font-bold text-red-700/60">Gestiona quién recibe tu alerta SOS</p>
                        </div>
                        <ChevronRight className="text-red-400 group-hover:translate-x-1 transition-transform" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
