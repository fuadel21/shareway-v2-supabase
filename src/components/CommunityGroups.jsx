import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    ShieldCheck, Building2, Loader2, Info, Building,
    ChevronRight, Sparkles, AlertCircle, CheckCircle2,
    XCircle, Users, GraduationCap, Briefcase
} from 'lucide-react';

// --- Componentes UI ---
import SubPageHeader from './SubPageHeader';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';

const CommunityGroups = () => {
    const { profile, user, refreshProfile } = useOutletContext();
    const [communities, setCommunities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isJoining, setIsJoining] = useState(null);

    const fetchCommunities = async () => {
        try {
            const { data, error } = await supabase
                .from('communities')
                .select('*')
                .order('name');

            if (error) throw error;
            setCommunities(data || []);
        } catch (error) {
            console.error("Error al cargar comunidades:", error);
            toast.error("Error al cargar las comunidades.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCommunities();
    }, []);

    const handleJoinCommunity = async (community) => {
        if (!user?.email) {
            toast.error("Error", { description: "No se pudo encontrar tu email para la verificación." });
            return;
        }

        const userEmailDomain = user.email.split('@')[1].toLowerCase();
        const allowedDomain = community.allowed_domain?.toLowerCase();

        if (userEmailDomain !== allowedDomain) {
            toast.error("Dominio no válido", {
                description: `Para unirte a esta comunidad necesitas un email académico o corporativo con el dominio \"@${allowedDomain}\".`
            });
            return;
        }

        setIsJoining(community.id);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    community_id: community.id,
                    community_name: community.name
                })
                .eq('id', user.id);

            if (error) throw error;

            toast.success(`¡Bienvenido a ${community.name}!`, {
                description: "Ahora podrás acceder a viajes exclusivos de tu comunidad."
            });
            await refreshProfile();
        } catch (error) {
            toast.error("Error al unirse a la comunidad.");
        } finally {
            setIsJoining(null);
        }
    };

    const handleLeaveCommunity = async () => {
        setIsJoining('leave');
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    community_id: null,
                    community_name: null
                })
                .eq('id', user.id);

            if (error) throw error;

            toast.success("Has abandonado la comunidad.");
            await refreshProfile();
        } catch (error) {
            toast.error("Error al abandonar la comunidad.");
        } finally {
            setIsJoining(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="Comunidades" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-5">

                {/* ESTADO ACTUAL PREMIUM */}
                <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
                    {profile?.community_id ? (
                        <Card className="rounded-3xl border-none shadow-[0_30px_60px_rgba(0,0,0,0.06)] overflow-hidden bg-slate-900 text-white relative">
                            <div className="absolute top-0 right-0 p-10 opacity-10">
                                <ShieldCheck className="size-24 text-primary" />
                            </div>
                            <CardContent className="p-10 space-y-6">
                                <div className="space-y-4">
                                    <div className="h-14 w-14 bg-primary/20 rounded-[1.25rem] flex items-center justify-center border border-primary/30">
                                        <BadgeCheckIcon className="h-8 w-8 text-primary" />
                                    </div>
                                    <div className="space-y-1">
                                        <h2 className="text-3xl font-black tracking-tighter uppercase italic tracking-widest text-white leading-none">Miembro Verificado</h2>
                                        <p className="text-sm font-bold text-slate-400">Perteneces a <span className="text-primary font-black uppercase">{profile.community_name}</span></p>
                                    </div>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-relaxed max-w-[80%]">
                                        Tu perfil ahora muestra la insignia de tu comunidad, permitiéndote conectar con personas de tu mismo entorno universitario o laboral.
                                    </p>
                                </div>

                                <Button
                                    variant="outline"
                                    onClick={handleLeaveCommunity}
                                    disabled={isJoining === 'leave'}
                                    className="h-14 rounded-2xl border-white/10 bg-white/5 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                                >
                                    {isJoining === 'leave' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Abandonar Comunidad'}
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="rounded-3xl border-none shadow-[0_30px_60px_rgba(0,0,0,0.06)] overflow-hidden bg-white/70 backdrop-blur-3xl p-10">
                            <div className="flex flex-col items-center text-center space-y-6">
                                <div className="h-20 w-20 bg-indigo-50 rounded-3xl flex items-center justify-center border border-indigo-100 relative">
                                    <Building2 className="h-10 w-10 text-indigo-500" />
                                    <div className="absolute -top-1 -right-1 h-5 w-5 bg-primary rounded-lg flex items-center justify-center border-2 border-white shadow-lg">
                                        <PlusIcon className="h-3 w-3 text-white" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-3xl font-black tracking-tighter text-slate-900 uppercase italic">Busca tu Entorno</h2>
                                    <p className="text-xs font-bold text-slate-400 max-w-[280px] leading-relaxed uppercase tracking-widest text-[9px]">
                                        Únete a una comunidad mediante tu email corporativo o universitario para acceder a rutas exclusivas y de confianza.
                                    </p>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                {/* LISTADO DE COMUNIDADES */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between px-4">
                        <div className="space-y-1">
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Descubrir Comunidades</h3>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Cerca de tu entorno laboral o académico</p>
                        </div>
                        <div className="px-3 py-1 bg-white rounded-full border border-slate-100 shadow-sm text-[10px] font-black text-slate-400">
                            {communities.length} DISPONIBLES
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {loading ? (
                            <div className="flex flex-col items-center py-20 animate-pulse space-y-6 text-center">
                                <div className="h-20 w-20 bg-slate-200 rounded-3xl flex items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                                </div>
                                <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em]">Sincronizando servidores...</p>
                            </div>
                        ) : communities.length > 0 ? (
                            communities.map((community, index) => {
                                const isMember = profile?.community_id === community.id;
                                const isUniversity = community.allowed_domain?.endsWith('.edu') || community.allowed_domain?.includes('universidad') || community.allowed_domain?.includes('upm') || community.allowed_domain?.includes('ucm');

                                return (
                                    <Card
                                        key={community.id}
                                        className={cn(
                                            "rounded-3xl border-none shadow-[0_20px_40px_rgba(0,0,0,0.04)] bg-white/60 backdrop-blur-3xl p-8 hover:shadow-xl transition-all duration-700 animate-in fade-in slide-in-from-bottom-8",
                                            isMember && "ring-2 ring-primary/20",
                                            "mb-2"
                                        )}
                                        style={{ animationDelay: `${index * 100}ms` }}
                                    >
                                        <div className="flex items-center justify-between gap-6">
                                            <div className="flex items-center gap-6">
                                                <div className={cn(
                                                    "h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg transition-transform",
                                                    isUniversity ? "bg-indigo-50 text-indigo-500" : "bg-emerald-50 text-emerald-500"
                                                )}>
                                                    {isUniversity ? <GraduationCap className="h-8 w-8" /> : <Briefcase className="h-8 w-8" />}
                                                </div>
                                                <div className="space-y-1">
                                                    <h4 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic">{community.name}</h4>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                        <Building className="h-3 w-3" /> @{community.allowed_domain}
                                                    </p>
                                                </div>
                                            </div>

                                            <Button
                                                variant={isMember ? 'ghost' : 'default'}
                                                disabled={isMember || isJoining === community.id || !!profile?.community_id}
                                                onClick={() => handleJoinCommunity(community)}
                                                className={cn(
                                                    "h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest px-8 shadow-2xl transition-all active:scale-95 group",
                                                    isMember
                                                        ? "bg-emerald-50 text-emerald-500"
                                                        : (!!profile?.community_id ? "opacity-20 bg-slate-100 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800")
                                                )}
                                            >
                                                {isJoining === community.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    isMember ? (
                                                        <div className="flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4" /> ERES MIEMBRO
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            {!!profile?.community_id ? 'OTRA COMUNIDAD' : 'UNIRSE'}
                                                            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                                        </div>
                                                    )
                                                )}
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                                <div className="h-24 w-24 bg-slate-50 rounded-full flex items-center justify-center">
                                    <AlertCircle className="h-12 w-12 text-slate-200" />
                                </div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">No hay comunidades cerca</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* INFO ADICIONAL */}
                <div className="bg-indigo-50/50 p-8 rounded-3xl border border-indigo-100/50 flex items-start gap-4">
                    <Info className="h-6 w-6 text-indigo-500 flex-shrink-0 mt-1" />
                    <p className="text-[10px] font-bold text-indigo-900/60 leading-relaxed uppercase tracking-widest">
                        Tu email ya ha sido verificado al registrarte. Solo puedes unirte a una comunidad que coincida exactamente con el dominio de tu correo electrónico corporativo o académico.
                    </p>
                </div>
            </main>
        </div>
    );
};

export default CommunityGroups;

// --- Iconos Internos ---
const BadgeCheckIcon = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
);

const PlusIcon = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
);
