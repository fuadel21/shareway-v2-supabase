import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ChevronDown,
    HeartHandshake,
    Share2,
    Mic,
    ShieldQuestion,
    Trash2,
    Plus,
    Loader2,
    ArrowLeft,
    Lock,
    ShieldCheck,
    AlertTriangle,
    BellRing,
    Key,
    UserPlus,
    Phone,
    Shield,
    Navigation
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import SubPageHeader from './SubPageHeader';

// --- Sub-componente para Contactos de Emergencia (Versión Premium) ---
const EmergencyContactsManager = () => {
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
            toast.error('Nombre y teléfono requeridos.');
            return;
        }
        if (contacts.length >= 5) {
            toast.error('Capacidad máxima alcanzada (5).');
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
            toast.success('¡Protección activada!', { description: `${newName} ahora es tu contacto de confianza.` });
            fetchContacts();
        } catch (error) {
            toast.error('Error al asegurar el contacto.');
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
            toast.success('Contacto retirado.');
            fetchContacts();
        } catch (error) {
            toast.error('No se pudo eliminar.');
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
                            <div>
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
                        <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">Añade hasta 5 guardianes</p>
                    </div>
                )}
            </div>

            <div className="pt-6 border-t border-slate-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Alias / Nombre</label>
                        <Input
                            placeholder="Ej. Mi Padre"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="rounded-2xl h-14 bg-white border-none shadow-inner font-bold"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Teléfono</label>
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
                    className="w-full rounded-2xl h-16 font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-primary/20"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <><Plus className="mr-2 h-5 w-5" /> Vincular Guardián</>}
                </Button>
                <p className="text-[9px] text-center mt-4 text-slate-400 font-bold uppercase tracking-widest">
                    {contacts.length}/5 contactos de confianza añadidos
                </p>
            </div>
        </div>
    );
};

// --- Sub-componente Toggle Premium ---
const SecurityToggleItem = ({ settingKey, title, description, icon: Icon, colorClass }) => {
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
            toast.success(value ? "Función activada" : "Función desactivada", {
                description: `${title} se ha ${value ? 'habilitado' : 'deshabilitado'}.`
            });
            refreshProfile();
        } catch {
            toast.error('Error al sincronizar seguridad.');
        }
    }

    return (
        <div className="p-8 bg-white/50 space-y-6">
            <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <Icon className={cn("h-5 w-5 mt-0.5", colorClass)} />
                <p className="text-xs font-medium text-slate-600 leading-relaxed italic">
                    {description}
                </p>
            </div>
            <div className="flex items-center justify-between p-6 bg-white rounded-3xl border shadow-sm">
                <div>
                    <p className="font-black text-slate-900 tracking-tight">Estado del Servicio</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {isEnabled ? 'Operativo y Protegiendo' : 'Inactivo / No configurado'}
                    </p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={handleToggle} className="data-[state=checked]:bg-primary" />
            </div>
        </div>
    )
}

const FeatureCard = ({ icon: Icon, title, description, children, isOpen, onClick, colorClass }) => (
    <div className={cn(
        "rounded-[2.5rem] border-none transition-all duration-500 overflow-hidden",
        isOpen ? "bg-white shadow-[0_30px_60px_rgba(0,0,0,0.1)] ring-2 ring-primary/5" : "bg-white/60 hover:bg-white hover:shadow-xl shadow-sm"
    )}>
        <button
            onClick={onClick}
            className="w-full text-left p-8 flex items-center justify-between group active:scale-[0.98] transition-transform"
        >
            <div className="flex items-center gap-6">
                <div className={cn(
                    "p-4 rounded-[1.5rem] transition-all duration-500",
                    isOpen ? "bg-primary text-white scale-110 shadow-lg shadow-primary/20" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100"
                )}>
                    <Icon className="h-7 w-7" />
                </div>
                <div>
                    <h3 className={cn(
                        "font-black text-xl tracking-tighter transition-colors",
                        isOpen ? "text-primary" : "text-slate-800"
                    )}>{title}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{description}</p>
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
    const navigate = useNavigate();
    const { profile } = useOutletContext();
    const [openItem, setOpenItem] = useState('emergencyContacts');

    const handleItemClick = (id) => {
        setOpenItem(openItem === id ? null : id);
    };

    const isFullSafe = profile?.is_phone_verified && (profile?.security_settings?.share_trip_enabled);

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="Centro de Seguridad" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-10">

                {/* HERO: Safety Status */}
                <div className="bg-navy rounded-[3.5rem] p-10 relative overflow-hidden group shadow-2xl shadow-navy/40">
                    <div className="absolute top-0 right-0 p-10 opacity-10 blur-xl group-hover:blur-md transition-all">
                        <ShieldCheck className="h-32 w-32 text-white" />
                    </div>
                    <div className="relative z-10 space-y-6">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "h-3 w-3 rounded-full animate-pulse",
                                isFullSafe ? "bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]" : "bg-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]"
                            )} />
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Estado de Protección</span>
                        </div>

                        <div className="space-y-1">
                            <h2 className="text-4xl font-black text-white tracking-tighter italic uppercase leading-none">
                                {isFullSafe ? "Nivel de Máxima Confianza" : "Seguridad Intermedia"}
                            </h2>
                            <p className="text-white/40 font-bold text-xs uppercase tracking-widest">
                                {isFullSafe ? "Tu perfil está blindado para este viaje." : "Añade guardianes para mayor tranquilidad."}
                            </p>
                        </div>

                        <div className="p-5 bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 flex items-center justify-between">
                            <div className="flex gap-2">
                                <Shield className="h-4 w-4 text-primary" />
                                <span className="text-[10px] font-black text-white/60 uppercase">Blindaje Activo</span>
                            </div>
                            <Button variant="ghost" className="h-8 px-4 text-[10px] font-black bg-white/10 text-white rounded-full hover:bg-white/20">
                                AUDITORÍA
                            </Button>
                        </div>
                    </div>
                </div>

                {/* FEATURE HUB */}
                <div className="space-y-4">
                    <FeatureCard
                        id="emergencyContacts"
                        icon={HeartHandshake}
                        title="Tus Guardianes"
                        description="Contactos de emergencia 24/7"
                        isOpen={openItem === 'emergencyContacts'}
                        onClick={() => handleItemClick('emergencyContacts')}
                    >
                        <EmergencyContactsManager />
                    </FeatureCard>

                    <FeatureCard
                        id="shareTrip"
                        icon={Navigation}
                        title="Seguimiento GPS"
                        description="Location sharing en tiempo real"
                        isOpen={openItem === 'shareTrip'}
                        onClick={() => handleItemClick('shareTrip')}
                        colorClass="text-blue-500"
                    >
                        <SecurityToggleItem
                            settingKey="share_trip_enabled"
                            title="Seguimiento GPS"
                            description="Al activar esta función, tus guardianes recibirán un enlace seguro con tu ubicación GPS exacta durante cada viaje que realices."
                            icon={BellRing}
                            colorClass="text-blue-500"
                        />
                    </FeatureCard>

                    <FeatureCard
                        id="audioRecording"
                        icon={Mic}
                        title="Caja Negra Audio"
                        description="Pruebas digitales de seguridad"
                        isOpen={openItem === 'audioRecording'}
                        onClick={() => handleItemClick('audioRecording')}
                        colorClass="text-purple-500"
                    >
                        <SecurityToggleItem
                            settingKey="audio_recording_enabled"
                            title="Caja Negra Audio"
                            description="Habilita el permiso para grabar fragmentos de audio encriptados que solo se enviarán al equipo de soporte en caso de emergencia reportada."
                            icon={Lock}
                            colorClass="text-purple-500"
                        />
                    </FeatureCard>

                    <FeatureCard
                        id="pinVerification"
                        icon={Key}
                        title="Verificación PIN"
                        description="Seguridad absoluta al abordar"
                        isOpen={openItem === 'pinVerification'}
                        onClick={() => handleItemClick('pinVerification')}
                        colorClass="text-emerald-500"
                    >
                        <SecurityToggleItem
                            settingKey="pin_verification_enabled"
                            title="Verificación PIN"
                            description="Tanto conductores como pasajeros deberán confirmar un código único antes de que el viaje comience formalmente en la plataforma."
                            icon={ShieldCheck}
                            colorClass="text-emerald-500"
                        />
                    </FeatureCard>
                </div>

                <div className="p-8 bg-blue-50/50 rounded-[3rem] border border-blue-100 flex items-start gap-5">
                    <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
                        <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-black text-slate-800 tracking-tight">Botón de Pánico</h4>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed">
                            Durante un viaje activo, verás un icono de escudo en el mapa. Al pulsarlo 3 veces, ShareWay llamará automáticamente al 112 y notificará a tus guardianes.
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
