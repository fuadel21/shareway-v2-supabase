import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
    BadgeCheck,
    ShieldCheck,
    Mail,
    Briefcase,
    Fingerprint,
    Star,
    ShieldAlert,
    ChevronRight,
    Loader2,
    CheckCircle2,
    Shield,
    History,
    Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import SafetyHistory from './security/SafetyHistory';

export default function TrustCenter() {
    const { user, profile, fetchProfile } = useOutletContext();
    const [isVerifying, setIsVerifying] = useState(null); // 'id', 'work', 'social'
    const [activeTab, setActiveTab] = useState('verification'); // 'verification', 'safety'

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
            <div className="flex flex-col gap-1">
                <h2 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">Trust Center</h2>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Eleva tu reputación y gestiona tu seguridad</p>
            </div>

            {/* Tabs de Navegación */}
            <div className="flex bg-slate-100/50 p-1 rounded-2xl gap-1">
                <button
                    onClick={() => setActiveTab('verification')}
                    className={cn(
                        "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                        activeTab === 'verification' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                >
                    <ShieldCheck className="size-3.5" /> Verificación
                </button>
                <button
                    onClick={() => setActiveTab('safety')}
                    className={cn(
                        "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                        activeTab === 'safety' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                >
                    <History className="size-3.5" /> Seguridad SOS
                </button>
            </div>

            {activeTab === 'verification' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {/* Score de Confianza */}
                    <Card className="border-none shadow-diamond overflow-hidden relative group bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] text-white rounded-3xl">
                        <div className="absolute inset-0 bg-gradient-premium opacity-20" />
                        <CardContent className="p-5 relative z-10 flex items-center justify-between">
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
                        <Card className="border-none shadow-sm hover:shadow-md transition-shadow overflow-hidden group rounded-3xl">
                            <CardContent className="p-0">
                                <div className="flex items-center justify-between p-6">
                                    <div className="flex items-center gap-4">
                                        <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            <Fingerprint size={24} />
                                        </div>
                                        <div className="text-left">
                                            <h4 className="font-black text-slate-900 tracking-tight uppercase text-sm">Identidad Oficial</h4>
                                            <p className="text-[10px] font-bold text-slate-400 tracking-wider">DNI, Pasaporte o Carnet</p>
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
                                            className="rounded-full font-black text-[10px] uppercase px-4 border-2"
                                        >
                                            {isVerifying === 'id' ? <Loader2 className="animate-spin size-3" /> : 'Verificar'}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Trabajo / Empresa */}
                        <Card className="border-none shadow-sm hover:shadow-md transition-shadow overflow-hidden group rounded-3xl">
                            <CardContent className="p-0">
                                <div className="flex items-center justify-between p-6">
                                    <div className="flex items-center gap-4">
                                        <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            <Briefcase size={24} />
                                        </div>
                                        <div className="text-left">
                                            <h4 className="font-black text-slate-900 tracking-tight uppercase text-sm">Email Corporativo</h4>
                                            <p className="text-[10px] font-bold text-slate-400 tracking-wider">Valida tu lugar de trabajo</p>
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
                                            className="rounded-full font-black text-[10px] uppercase px-4 border-2"
                                        >
                                            {isVerifying === 'work' ? <Loader2 className="animate-spin size-3" /> : 'Añadir'}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Contactos de Emergencia (Acceso rápido) */}
                    <div className="pt-4">
                        <Card onClick={() => toast.info("Configuración de Contactos")} className="border-none shadow-diamond bg-red-50 hover:bg-red-100 transition-colors cursor-pointer group rounded-3xl">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-red-100 rounded-2xl">
                                        <ShieldAlert size={20} className="text-red-600" />
                                    </div>
                                    <div className="space-y-1">
                                        <h4 className="font-black text-red-900 uppercase text-xs tracking-tight">Contactos SOS</h4>
                                        <p className="text-[10px] font-bold text-red-700/60 tracking-wider">Gestiona tus contactos de confianza</p>
                                    </div>
                                </div>
                                <ChevronRight className="text-red-400 group-hover:translate-x-1 transition-transform" />
                            </CardContent>
                        </Card>
                    </div>
                </div>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <SafetyHistory />
                </div>
            )}
        </div>
    );
}
