import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ChevronDown,
    HeartHandshake,
    Mic,
    Trash2,
    Plus,
    Loader2,
    Lock,
    ShieldCheck,
    AlertTriangle,
    BellRing,
    Key,
    UserPlus,
    Shield,
    Navigation
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import SubPageHeader from './SubPageHeader';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        maxCapacity: 'Capacidad máxima alcanzada (5).',
        guardianNamePlaceholder: 'Ej. Mi Padre',
        enabled: 'habilitado',
        disabled: 'deshabilitado',
        settingChanged: '{{title}} se ha {{state}}.'
    },
    en: {
        maxCapacity: 'Maximum capacity reached (5).',
        guardianNamePlaceholder: 'Example: My father',
        enabled: 'enabled',
        disabled: 'disabled',
        settingChanged: '{{title}} has been {{state}}.'
    },
    ar: {
        maxCapacity: 'تم الوصول إلى الحد الأقصى (5).',
        guardianNamePlaceholder: 'مثال: والدي',
        enabled: 'مفعّل',
        disabled: 'معطّل',
        settingChanged: 'تم جعل {{title}} {{state}}.'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const interpolate = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);

const EmergencyContactsManager = () => {
    const { t, i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const { profile } = useOutletContext();
    const [contacts, setContacts] = useState([]);
    const [newName, setNewName] = useState('');
    const [newPhone, setNewPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const fetchContacts = useCallback(async () => {
        if (!profile?.id) return;
        const { data, error } = await supabase
            .from('emergency_contacts')
            .select('*')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: true });

        if (!error) setContacts(data || []);
    }, [profile?.id]);

    useEffect(() => {
        fetchContacts();
    }, [fetchContacts]);

    const handleAddContact = async () => {
        if (!newName.trim() || !newPhone.trim()) {
            toast.error(t('common.error'));
            return;
        }
        if (contacts.length >= 5) {
            toast.error(copy.maxCapacity);
            return;
        }
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('emergency_contacts')
                .insert({ user_id: profile.id, name: newName, phone: newPhone });

            if (error) throw error;
            setNewName('');
            setNewPhone('');
            toast.success(t('security.protection_activated'), { description: t('security.contact_is_guardian', { name: newName }) });
            fetchContacts();
        } catch (error) {
            toast.error(error.message || t('common.error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteContact = async (contactId) => {
        try {
            const { error } = await supabase
                .from('emergency_contacts')
                .delete()
                .eq('id', contactId);

            if (error) throw error;
            toast.success(t('security.contact_removed'));
            fetchContacts();
        } catch (error) {
            toast.error(t('common.error'));
        }
    };

    return (
        <div className="p-8 space-y-8 bg-slate-50/50">
            <div className="space-y-4">
                {contacts.map((contact, idx) => (
                    <div
                        key={contact.id}
                        className="flex items-center justify-between p-5 bg-white rounded-3xl border border-slate-100 shadow-sm animate-in fade-in slide-in-from-left-4"
                        style={{ animationDelay: `${idx * 100}ms` }}
                    >
                        <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-black">
                                {contact.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-left">
                                <p className="font-black text-slate-900 tracking-tight">{contact.name}</p>
                                <p className="text-xs text-slate-400 font-bold tracking-widest uppercase">{contact.phone}</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-slate-300 hover:text-red-500 rounded-xl hover:bg-red-50"
                            onClick={() => handleDeleteContact(contact.id)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}

                {contacts.length === 0 && (
                    <div className="text-center py-10 px-6 bg-slate-100/50 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                        <UserPlus className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">{t('security.add_guardians_placeholder')}</p>
                    </div>
                )}
            </div>

            <div className="pt-6 border-t border-slate-100 text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">{t('security.alias_label')}</label>
                        <Input
                            placeholder={copy.guardianNamePlaceholder}
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="rounded-2xl h-14 bg-white border-none shadow-inner font-bold"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">{t('security.phone_label')}</label>
                        <Input
                            placeholder="+34 ..."
                            type="tel"
                            value={newPhone}
                            onChange={(e) => setNewPhone(e.target.value)}
                            className="rounded-2xl h-14 bg-white border-none shadow-inner font-bold"
                        />
                    </div>
                </div>
                <Button
                    onClick={handleAddContact}
                    disabled={isLoading || contacts.length >= 5}
                    className="w-full rounded-2xl h-14 md:h-16 font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-primary/20"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <><Plus className="mr-2 h-5 w-5" /> {t('security.link_guardian')}</>}
                </Button>
                <p className="text-[9px] text-center mt-3 md:mt-4 text-slate-400 font-bold uppercase tracking-widest">
                    {contacts.length}/5 {t('security.guardians_title')}
                </p>
            </div>
        </div>
    );
};

const SecurityToggleItem = ({ settingKey, title, description, icon: Icon, colorClass }) => {
    const { t, i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const { profile, refreshProfile } = useOutletContext();
    const isEnabled = profile?.security_settings?.[settingKey] || false;

    const handleToggle = async (value) => {
        try {
            const currentSettings = profile.security_settings || {};
            const { error } = await supabase
                .from('profiles')
                .update({ security_settings: { ...currentSettings, [settingKey]: value } })
                .eq('id', profile.id);

            if (error) throw error;
            toast.success(t('common.success'), {
                description: interpolate(copy.settingChanged, { title, state: value ? copy.enabled : copy.disabled })
            });
            refreshProfile();
        } catch {
            toast.error(t('common.error'));
        }
    };

    return (
        <div className="p-8 bg-white/50 space-y-6 text-left">
            <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <Icon className={cn("h-5 w-5 mt-0.5", colorClass)} />
                <p className="text-xs font-medium text-slate-600 leading-relaxed italic">
                    {description}
                </p>
            </div>
            <div className="flex items-center justify-between p-6 bg-white rounded-3xl border shadow-sm">
                <div>
                    <p className="font-black text-slate-900 tracking-tight">{t('security.service_status')}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {isEnabled ? t('security.status_active') : t('security.status_inactive')}
                    </p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={handleToggle} className="data-[state=checked]:bg-primary" />
            </div>
        </div>
    );
};

const FeatureCard = ({ icon: Icon, title, description, children, isOpen, onClick }) => (
    <div className={cn(
        "rounded-[2rem] md:rounded-[2.5rem] border-none transition-all duration-500 overflow-hidden",
        isOpen ? "bg-white shadow-[0_30px_60px_rgba(0,0,0,0.1)] ring-2 ring-primary/5" : "bg-white/60 hover:bg-white hover:shadow-xl shadow-sm"
    )}>
        <button
            onClick={onClick}
            className="w-full text-left p-6 md:p-8 flex items-center justify-between group active:scale-[0.98] transition-transform"
        >
            <div className="flex items-center gap-4 md:gap-6">
                <div className={cn(
                    "p-3 md:p-4 rounded-2xl md:rounded-[1.5rem] transition-all duration-500",
                    isOpen ? "bg-primary text-white scale-110 shadow-lg shadow-primary/20" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100"
                )}>
                    <Icon className="size-6 md:size-7" />
                </div>
                <div className="text-left">
                    <h3 className={cn(
                        "font-black text-lg md:text-xl tracking-tighter transition-colors",
                        isOpen ? "text-primary" : "text-slate-800"
                    )}>{title}</h3>
                    <p className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{description}</p>
                </div>
            </div>
            <div className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300",
                isOpen ? "bg-primary/5 text-primary rotate-180" : "bg-slate-50 text-slate-300 group-hover:bg-slate-100"
            )}>
                <ChevronDown className="h-5 w-5" />
            </div>
        </button>
        {isOpen && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                {children}
            </div>
        )}
    </div>
);

function SecuritySettings() {
    const { t } = useTranslation();
    const { profile } = useOutletContext();
    const [openItem, setOpenItem] = useState('emergencyContacts');

    const handleItemClick = (id) => {
        setOpenItem(openItem === id ? null : id);
    };

    const isFullSafe = profile?.is_phone_verified && (profile?.security_settings?.share_trip_enabled);

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title={t('security.title')} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-10 text-left">
                <div className="bg-navy rounded-[2.5rem] md:rounded-[3.5rem] p-8 md:p-10 relative overflow-hidden group shadow-2xl shadow-navy/40">
                    <div className="absolute top-0 right-0 p-10 opacity-10 blur-xl group-hover:blur-md transition-all">
                        <ShieldCheck className="h-24 w-24 md:h-32 md:w-32 text-white" />
                    </div>
                    <div className="relative z-10 space-y-6">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "h-2.5 w-2.5 md:h-3 md:w-3 rounded-full animate-pulse",
                                isFullSafe ? "bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]" : "bg-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]"
                            )} />
                            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em] text-white/40">{t('security.protection_status')}</span>
                        </div>

                        <div className="space-y-1">
                            <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter italic uppercase leading-none">
                                {isFullSafe ? t('security.max_trust_level') : t('security.mid_trust_level')}
                            </h2>
                            <p className="text-white/40 font-bold text-[10px] md:text-xs uppercase tracking-widest">
                                {isFullSafe ? t('security.max_trust_desc') : t('security.mid_trust_desc')}
                            </p>
                        </div>

                        <div className="p-4 md:p-5 bg-white/5 backdrop-blur-md rounded-[1.5rem] md:rounded-3xl border border-white/10 flex items-center justify-between">
                            <div className="flex gap-2">
                                <Shield className="h-4 w-4 text-primary" />
                                <span className="text-[9px] md:text-[10px] font-black text-white/60 uppercase">{t('security.active_shield')}</span>
                            </div>
                            <Button variant="ghost" className="h-7 md:h-8 px-3 md:px-4 text-[8px] md:text-[10px] font-black bg-white/10 text-white rounded-full hover:bg-white/20 whitespace-nowrap">
                                {t('security.audit_button')}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <FeatureCard
                        id="emergencyContacts"
                        icon={HeartHandshake}
                        title={t('security.guardians_title')}
                        description={t('security.guardians_desc')}
                        isOpen={openItem === 'emergencyContacts'}
                        onClick={() => handleItemClick('emergencyContacts')}
                    >
                        <EmergencyContactsManager />
                    </FeatureCard>

                    <FeatureCard
                        id="shareTrip"
                        icon={Navigation}
                        title={t('security.gps_tracking_title')}
                        description={t('security.gps_tracking_desc')}
                        isOpen={openItem === 'shareTrip'}
                        onClick={() => handleItemClick('shareTrip')}
                    >
                        <SecurityToggleItem
                            settingKey="share_trip_enabled"
                            title={t('security.gps_tracking_title')}
                            description={t('security.gps_tracking_info')}
                            icon={BellRing}
                            colorClass="text-blue-500"
                        />
                    </FeatureCard>

                    <FeatureCard
                        id="audioRecording"
                        icon={Mic}
                        title={t('security.audio_blackbox_title')}
                        description={t('security.audio_blackbox_desc')}
                        isOpen={openItem === 'audioRecording'}
                        onClick={() => handleItemClick('audioRecording')}
                    >
                        <SecurityToggleItem
                            settingKey="audio_recording_enabled"
                            title={t('security.audio_blackbox_title')}
                            description={t('security.audio_blackbox_info')}
                            icon={Lock}
                            colorClass="text-purple-500"
                        />
                    </FeatureCard>

                    <FeatureCard
                        id="pinVerification"
                        icon={Key}
                        title={t('security.pin_verification_title')}
                        description={t('security.pin_verification_desc')}
                        isOpen={openItem === 'pinVerification'}
                        onClick={() => handleItemClick('pinVerification')}
                    >
                        <SecurityToggleItem
                            settingKey="pin_verification_enabled"
                            title={t('security.pin_verification_title')}
                            description={t('security.pin_verification_info')}
                            icon={ShieldCheck}
                            colorClass="text-emerald-500"
                        />
                    </FeatureCard>
                </div>

                <div className="p-8 bg-blue-50/50 rounded-[3rem] border border-blue-100 flex items-start gap-5 text-left">
                    <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
                        <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-black text-slate-800 tracking-tight">{t('security.panic_button_title')}</h4>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed">
                            {t('security.panic_button_info')}
                        </p>
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Trusted Safety System v4.1 • ShareWay
                </p>
            </main>
        </div>
    );
}

export default SecuritySettings;
