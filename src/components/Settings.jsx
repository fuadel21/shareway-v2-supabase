import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- UI Components ---
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// --- Icons (Renombrado extremo para evitar colisiones) ---
import {
    ChevronLeft, ChevronRight, User, Wallet, Route, Shield, Bell,
    Palette, LogOut, Award, ShieldCheck, Fingerprint,
    Smartphone, HelpCircle, FileText, Share2, Sparkles,
    BadgeCheck, CreditCard, Lock, Eye, Car, Zap,
    Languages, Trash2, Heart, Star, Mail, Map, UserX, ShieldAlert,
    Loader2, History as LucideHistory, Banknote, Users
} from 'lucide-react';
import SubPageHeader from './SubPageHeader';

const MiniSettingTile = ({ icon: Icon, title, to, action, color, badge }) => {
    const navigate = useNavigate();
    return (
        <button
            type="button"
            onClick={() => {
                if (action) action();
                else if (to) navigate(to);
            }}
            className="group relative flex flex-col items-center justify-center p-4 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 active:scale-90 transition-all aspect-square animate-in zoom-in duration-500"
        >
            <div className={cn(
                "size-12 rounded-2xl flex items-center justify-center mb-2 transition-transform group-hover:scale-110 shadow-lg shadow-slate-100",
                color
            )}>
                <Icon className="h-6 w-6 text-white" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-900 leading-none text-center">
                {title}
            </span>
            {badge && (
                <span className="absolute top-4 right-4 size-2.5 bg-primary rounded-full ring-4 ring-white" />
            )}
        </button>
    );
};

const SettingsSection = ({ title, children }) => (
    <div className="space-y-4">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 ml-6 italic">{title}</h3>
        <div className="grid grid-cols-3 gap-4">
            {children}
        </div>
    </div>
);

const Settings = () => {
    const { profile: contextProfile, handleSignOut, user } = useOutletContext();
    const navigate = useNavigate();
    const [fullProfile, setFullProfile] = useState(contextProfile);
    const [loading, setLoading] = useState(!contextProfile);

    useEffect(() => {
        const fetchProfile = async () => {
            if (!user?.id) return;
            try {
                const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
                if (data) setFullProfile(data);
            } catch (e) { console.error(e); } finally { setLoading(false); }
        };
        fetchProfile();
    }, [user?.id]);

    const handleShareApp = async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: 'ShareWay', text: '¡Únete a la movilidad inteligente!', url: window.location.origin });
            } catch (e) { console.error(e); }
        } else {
            navigator.clipboard.writeText(window.location.origin);
            toast.success("Enlace copiado.");
        }
    };

    const isVerified = ['verified', 'approved'].includes(fullProfile?.verification?.status);

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" /></div>;

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <SubPageHeader title="Ajustes" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-12">
                <div onClick={() => navigate(`/profile/${user?.id}`)} className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer border border-white/5 group">
                    <div className="absolute -right-4 -top-4 opacity-10 rotate-12 group-hover:scale-110 transition-transform"><Zap size={140} className="text-white" /></div>
                    <div className="flex items-center gap-5 relative z-10">
                        <Avatar className="h-16 w-16 border-2 border-white/20 shadow-xl">
                            <AvatarImage src={fullProfile?.photo_url || fullProfile?.avatar_url} />
                            <AvatarFallback className="bg-primary text-white font-black italic">{fullProfile?.display_name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-black tracking-tighter uppercase italic truncate">{fullProfile?.display_name || 'Usuario'}</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={cn("px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border", isVerified ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30")}>{isVerified ? 'Verificado' : 'Sin Verificar'}</span>
                                <span className="bg-white/10 px-2 py-0.5 rounded-md text-[8px] font-black text-white/60 uppercase">Elite Member</span>
                            </div>
                        </div>
                        <ChevronRight className="size-5 text-white/40" />
                    </div>
                </div>

                <SettingsSection title="Conducción & Vehículo">
                    <MiniSettingTile icon={Car} title="Mi Coche" to="/edit-profile?section=vehicle" color="bg-slate-900" />
                    <MiniSettingTile icon={Route} title="Historial" to="/my-rides" color="bg-indigo-600" />
                    <MiniSettingTile icon={Map} title="Rutas" to="/settings" color="bg-emerald-600" />
                </SettingsSection>

                <SettingsSection title="Seguridad & Trust">
                    <MiniSettingTile icon={ShieldCheck} title="Seguridad" to="/settings/security" color="bg-primary" />
                    <MiniSettingTile icon={Fingerprint} title="Identidad" to="/settings/verification" color="bg-blue-600" />
                    <MiniSettingTile icon={Lock} title="PIN SOS" to="/settings/security" color="bg-slate-700" />
                </SettingsSection>

                <SettingsSection title="Economía & Cartera">
                    <MiniSettingTile icon={Wallet} title="Cartera" to="/wallet" color="bg-amber-500" />
                    <MiniSettingTile icon={Banknote} title="Cobros" to="/settings/payouts" color="bg-violet-600" />
                    <MiniSettingTile icon={LucideHistory} title="Pagos" to="/wallet" color="bg-slate-500" />
                </SettingsSection>

                <SettingsSection title="Comunidad & App">
                    <MiniSettingTile icon={Heart} title="Invitar" action={handleShareApp} color="bg-rose-500" />
                    <MiniSettingTile icon={Users} title="Grupos" to="/help" color="bg-indigo-400" />
                    <MiniSettingTile icon={Palette} title="Diseño" to="/settings/appearance" color="bg-cyan-500" />
                </SettingsSection>

                <div className="pt-6">
                    <button type="button" onClick={handleSignOut} className="w-full flex flex-col items-center justify-center gap-2 p-8 bg-red-500/5 border border-red-500/10 rounded-[2.5rem] active:scale-95 transition-all group shadow-sm">
                        <div className="size-14 rounded-full bg-white flex items-center justify-center shadow-lg shadow-red-100 group-hover:scale-110 transition-transform"><LogOut className="size-6 text-red-500" /></div>
                        <span className="font-black text-[10px] uppercase tracking-[0.4em] text-red-600 italic">Terminar Sesión</span>
                    </button>
                </div>
            </main>
        </div>
    );
};

export default Settings;
