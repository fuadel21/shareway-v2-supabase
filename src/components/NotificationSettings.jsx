import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { MessageSquare, Briefcase, Clock, Sparkles, Bell, BellOff, ShieldCheck, Zap, Star, Megaphone } from 'lucide-react';
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
    const { profile, refreshProfile } = useOutletContext();
    const [isUpdating, setIsUpdating] = useState(false);

    const NOTIFICATION_OPTIONS = [
        { id: 'messages', icon: MessageSquare, title: t('notifications.options.messages_title', 'Mensajes'), description: t('notifications.options.messages_desc', 'Avisos cuando recibes un nuevo mensaje.'), color: 'text-blue-500' },
        { id: 'rideUpdates', icon: Briefcase, title: t('notifications.options.ride_updates_title', 'Viajes y reservas'), description: t('notifications.options.ride_updates_desc', 'Reservas, cancelaciones y cambios importantes.'), color: 'text-indigo-500' },
        { id: 'reminders', icon: Clock, title: t('notifications.options.reminders_title', 'Recordatorios'), description: t('notifications.options.reminders_desc', 'Avisos antes de la salida y tareas pendientes.'), color: 'text-amber-500' },
        { id: 'reviews', icon: Star, title: 'Valoraciones', description: 'Avisos cuando recibes una valoración nueva.', color: 'text-yellow-500' },
        { id: 'adminAnnouncements', icon: Megaphone, title: 'Avisos ShareWay', description: 'Comunicados importantes del equipo o administración.', color: 'text-emerald-500' },
        { id: 'promotions', icon: Sparkles, title: t('notifications.options.promotions_title', 'Promociones'), description: t('notifications.options.promotions_desc', 'Campañas, beneficios y comunicaciones comerciales.'), color: 'text-rose-500' },
    ];

    const settings = {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(profile?.preferences?.notifications || {}),
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
                                                <p className="font-black text-slate-900 tracking-tight uppercase italic truncate">{opt.title}</p>
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
