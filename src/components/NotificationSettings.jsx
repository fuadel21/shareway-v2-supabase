import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { MessageSquare, Briefcase, Clock, Sparkles, Bell, BellOff, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';
import SubPageHeader from './SubPageHeader';
import { cn } from '@/lib/utils';

const NOTIFICATION_OPTIONS = [
    { id: 'messages', icon: MessageSquare, title: 'Mensajes Directos', description: 'Notificar cuando alguien te escriba en el chat.', color: 'text-blue-500' },
    { id: 'rideUpdates', icon: Briefcase, title: 'Alertas de Viaje', description: 'Cambios de estado, confirmaciones y cancelaciones.', color: 'text-indigo-500' },
    { id: 'reminders', icon: Clock, title: 'Recordatorios SOS', description: 'Avisos 30 min antes de la salida programada.', color: 'text-amber-500' },
    { id: 'promotions', icon: Sparkles, title: 'ShareWay Insider', description: 'Noticias, logros y ofertas de la comunidad.', color: 'text-rose-500' },
];

function NotificationSettings() {
    const { profile, refreshProfile } = useOutletContext();
    const [isUpdating, setIsUpdating] = useState(false);

    // Preferencias actuales (del perfil o default)
    const settings = profile?.preferences?.notifications || {
        messages: true,
        rideUpdates: true,
        reminders: true,
        promotions: false
    };

    const handleToggle = async (id, value) => {
        setIsUpdating(true);
        try {
            const newPreferences = {
                ...profile?.preferences,
                notifications: {
                    ...settings,
                    [id]: value
                }
            };

            const { error } = await supabase
                .from('profiles')
                .update({ preferences: newPreferences })
                .eq('id', profile.id);

            if (error) throw error;

            toast.success("Preferencia guardada", {
                icon: value ? <Bell className="size-4" /> : <BellOff className="size-4" />
            });
            refreshProfile();
        } catch (error) {
            toast.error("Error al actualizar");
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="Notificaciones" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-8">

                {/* HERO: Smart Notification Status */}
                <div className="bg-white rounded-[3rem] p-8 shadow-2xl shadow-slate-200 border border-slate-100 relative overflow-hidden group">
                    <div className="absolute -right-6 -top-6 opacity-5 rotate-12 group-hover:scale-110 transition-transform">
                        <Bell size={120} className="text-primary" />
                    </div>

                    <div className="flex items-start gap-6 relative z-10">
                        <div className="p-4 bg-primary/10 rounded-2xl">
                            <Zap className="size-8 text-primary animate-pulse" />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Smart Alerts</h2>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Sincronización en tiempo real activa</p>
                        </div>
                    </div>

                    <div className="mt-8 p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                        <div className="flex gap-2 items-center">
                            <ShieldCheck className="size-4 text-emerald-500" />
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Servicio de Push Encriptado</span>
                        </div>
                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">VÍA FCM 2.0</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-4 italic">Canales de Comunicación</p>

                    <div className="space-y-4">
                        {NOTIFICATION_OPTIONS.map((opt, idx) => {
                            const isEnabled = settings[opt.id];
                            return (
                                <div
                                    key={opt.id}
                                    className="bg-white p-6 rounded-[2.5rem] border border-slate-100 flex items-center justify-between shadow-sm hover:shadow-xl transition-all group animate-in fade-in slide-in-from-bottom-4"
                                    style={{ animationDelay: `${idx * 100}ms` }}
                                >
                                    <div className="flex items-center gap-5">
                                        <div className={cn("p-4 rounded-2xl bg-slate-50 group-hover:scale-110 transition-transform", opt.color.replace('text', 'bg').replace('-500', '-50'))}>
                                            <opt.icon className={cn("size-6", opt.color)} />
                                        </div>
                                        <div>
                                            <p className="font-black text-slate-900 tracking-tight uppercase italic">{opt.title}</p>
                                            <p className="text-[10px] font-bold text-slate-400">{opt.description}</p>
                                        </div>
                                    </div>
                                    <Switch
                                        checked={isEnabled}
                                        onCheckedChange={(val) => handleToggle(opt.id, val)}
                                        disabled={isUpdating}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-8 bg-indigo-50/50 rounded-[3rem] border border-indigo-100 flex flex-col items-center gap-4 text-center">
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]">Optimización de Batería</p>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed italic">
                        ShareWay utiliza notificaciones Push silenciosas para ahorrar hasta un 15% de batería en comparación con otras apps de movilidad.
                    </p>
                </div>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Push Cloud Engine v2.0 • ShareWay
                </p>
            </main>
        </div>
    );
}

export default NotificationSettings;
