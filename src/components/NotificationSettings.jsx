import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { MessageSquare, Briefcase, Clock, Sparkles, Bell, BellOff, ShieldCheck, Zap, Star, Megaphone, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import SubPageHeader from './SubPageHeader';
import BrowserAlertsCard from './BrowserAlertsCard';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const DEFAULT_NOTIFICATION_SETTINGS = {
    messages: true,
    rideUpdates: true,
    reminders: true,
    reviews: true,
    adminAnnouncements: true,
    promotions: false,
};

function NotificationSettings() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { profile, refreshProfile } = useOutletContext();
    const [isUpdating, setIsUpdating] = useState(false);

    const NOTIFICATION_OPTIONS = [
        { id: 'messages', icon: MessageSquare, title: t('notifications.options.messages_title', 'Mensajes'), description: t('notifications.options.messages_desc', 'Avisos cuando recibes un nuevo mensaje.'), color: 'text-blue-500', critical: true },
        { id: 'rideUpdates', icon: Briefcase, title: t('notifications.options.ride_updates_title', 'Viajes y reservas'), description: t('notifications.options.ride_updates_desc', 'Reservas, cancelaciones y cambios importantes.'), color: 'text-indigo-500', critical: true },
        { id: 'reminders', icon: Clock, title: t('notifications.options.reminders_title', 'Recordatorios'), description: t('notifications.options.reminders_desc', 'Avisos antes de la salida y tareas pendientes.'), color: 'text-amber-500', critical: true },
        { id: 'reviews', icon: Star, title: 'Valoraciones', description: 'Avisos cuando recibes una valoración nueva.', color: 'text-yellow-500', critical: false },
        { id: 'adminAnnouncements', icon: Megaphone, title: 'Avisos ShareWay', description: 'Comunicados importantes del equipo o administración.', color: 'text-emerald-500', critical: true },
        { id: 'promotions', icon: Sparkles, title: t('notifications.options.promotions_title', 'Promociones'), description: t('notifications.options.promotions_desc', 'Campañas, beneficios y comunicaciones comerciales.'), color: 'text-rose-500', critical: false },
    ];

    const settings = {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(profile?.preferences?.notifications || {}),
    };

    const activeCount = NOTIFICATION_OPTIONS.filter((opt) => settings[opt.id]).length;
    const criticalCount = NOTIFICATION_OPTIONS.filter((opt) => opt.critical && settings[opt.id]).length;
    const totalCritical = NOTIFICATION_OPTIONS.filter((opt) => opt.critical).length;

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

            toast.success(t('notifications.success_toast', 'Preferencias actualizadas'), {
                icon: value ? <Bell className="size-4" /> : <BellOff className="size-4" />
            });
            refreshProfile();
        } catch (error) {
            toast.error(t('notifications.error_toast', 'No se pudieron actualizar las preferencias'));
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title={t('notifications.title', 'Notificaciones')} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-8 text-left">

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
                            <h2 className="text-2xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('notifications.smart_alerts', 'Alertas inteligentes')}</h2>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('notifications.realtime_sync', 'Sincronización en tiempo real')}</p>
                        </div>
                    </div>

                    <div className="mt-8 p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                        <div className="flex gap-2 items-center">
                            <ShieldCheck className="size-4 text-emerald-500" />
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{t('notifications.encrypted_push', 'Preferencias protegidas')}</span>
                        </div>
                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">REALTIME</span>
                    </div>
                </div>

                <Card className="border-none rounded-[2.5rem] bg-slate-950 text-white shadow-2xl shadow-slate-900/20 overflow-hidden">
                    <CardContent className="p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Centro de avisos</p>
                                <h3 className="mt-1 text-xl font-black uppercase italic tracking-tighter">{activeCount}/{NOTIFICATION_OPTIONS.length} canales activos</h3>
                                <p className="mt-2 text-xs font-bold text-white/45 leading-relaxed">
                                    Mantén activos mensajes, viajes y recordatorios para no perder solicitudes ni cambios importantes.
                                </p>
                            </div>
                            <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                                <Bell className="h-6 w-6 text-primary" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-white/10 border border-white/10 p-4">
                                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Críticos</p>
                                <p className="mt-1 text-lg font-black italic">{criticalCount}/{totalCritical}</p>
                            </div>
                            <div className="rounded-2xl bg-white/10 border border-white/10 p-4">
                                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Opcionales</p>
                                <p className="mt-1 text-lg font-black italic">{activeCount - criticalCount}/{NOTIFICATION_OPTIONS.length - totalCritical}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Button type="button" onClick={() => navigate('/chats')} className="h-12 rounded-2xl bg-white text-slate-950 hover:bg-white/90 text-[9px] font-black uppercase tracking-widest">
                                Mensajes <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                            <Button type="button" variant="outline" onClick={() => navigate('/my-rides?tab=active')} className="h-12 rounded-2xl bg-white/10 border-white/10 text-white hover:bg-white/20 text-[9px] font-black uppercase tracking-widest">
                                Mis viajes <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <BrowserAlertsCard userId={profile?.id} />

                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-4 italic">{t('notifications.channels_title', 'Canales activos')}</p>

                    <div className="space-y-4">
                        {NOTIFICATION_OPTIONS.map((opt, idx) => {
                            const isEnabled = settings[opt.id];
                            return (
                                <Card
                                    key={opt.id}
                                    className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all group animate-in fade-in slide-in-from-bottom-4"
                                    style={{ animationDelay: `${idx * 70}ms` }}
                                >
                                    <CardContent className="p-6 flex items-center justify-between gap-5">
                                        <div className="flex items-center gap-5 min-w-0">
                                            <div className={cn("p-4 rounded-2xl bg-slate-50 group-hover:scale-110 transition-transform", opt.color.replace('text', 'bg').replace('-500', '-50'))}>
                                                <opt.icon className={cn("size-6", opt.color)} />
                                            </div>
                                            <div className="text-left min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-black text-slate-900 tracking-tight uppercase italic truncate">{opt.title}</p>
                                                    {opt.critical && <span className="text-[7px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-full">Clave</span>}
                                                </div>
                                                <p className="text-[10px] font-bold text-slate-400 leading-relaxed">{opt.description}</p>
                                            </div>
                                        </div>
                                        <Switch
                                            checked={Boolean(isEnabled)}
                                            onCheckedChange={(val) => handleToggle(opt.id, val)}
                                            disabled={isUpdating}
                                            className="data-[state=checked]:bg-primary shrink-0"
                                        />
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>

                <div className="p-8 bg-indigo-50/50 rounded-[3rem] border border-indigo-100 flex flex-col items-center gap-4 text-center">
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]">{t('notifications.battery_optimization', 'Control de avisos')}</p>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed italic">
                        {t('notifications.battery_info', 'Puedes reducir ruido desactivando avisos no esenciales. Los avisos críticos de seguridad y pagos podrán seguir mostrándose para proteger el servicio.')}
                    </p>
                </div>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Notification Engine v1 • ShareWay
                </p>
            </main>
        </div>
    );
}

export default NotificationSettings;
