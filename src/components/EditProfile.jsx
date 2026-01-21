import { useState, useEffect, useRef } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// --- UI & Icons ---
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.jsx";
import { Label } from '@/components/ui/label.jsx';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger
} from "@/components/ui/accordion";
import {
    Loader2, Camera, User, Car, Heart, Sparkles,
    Phone, MessageSquare, Music, ShieldCheck,
    ChevronLeft, UserCircle2, Mail, Users2, Info
} from 'lucide-react';
import SubPageHeader from './SubPageHeader';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (!name) return '?';
    const words = name.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

function EditProfile() {
    const { profile: currentUser, refreshProfile, user: authUser } = useOutletContext();
    const navigate = useNavigate();
    const location = useLocation();

    const queryParams = new URLSearchParams(location.search);
    const initialSection = queryParams.get('section') || 'personal';

    const [formData, setFormData] = useState(null);
    const [profileImageFile, setProfileImageFile] = useState(null);
    const [vehicleImageFile, setVehicleImageFile] = useState(null);
    const [profileImageUrl, setProfileImageUrl] = useState('');
    const [vehicleImageUrl, setVehicleImageUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [activeSection, setActiveSection] = useState(initialSection);

    const vehicleRef = useRef(null);

    useEffect(() => {
        if (currentUser) {
            setFormData({
                display_name: currentUser.display_name || '',
                phone: currentUser.phone || '',
                bio: currentUser.bio || '',
                gender: currentUser.gender || 'unspecified',
                vehicle: currentUser.vehicle || { make: '', model: '', year: '', color: '', plate: '' },
                preferences: currentUser.preferences || { smoking: 'any', pets: 'any', music: 'any', conversation: 'any' }
            });
            setProfileImageUrl(currentUser.photo_url || currentUser.avatar_url || '');
            setVehicleImageUrl(currentUser.vehicle?.photoURL || '');
        }
    }, [currentUser]);

    useEffect(() => {
        if (initialSection === 'vehicle' && formData) {
            setTimeout(() => {
                vehicleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500);
        }
    }, [initialSection, formData]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleVehicleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, vehicle: { ...prev.vehicle, [name]: value } }));
    };

    const handleFileChange = (e, type) => {
        const file = e.target.files[0];
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        if (type === 'profile') {
            setProfileImageFile(file);
            setProfileImageUrl(objectUrl);
        } else if (type === 'vehicle') {
            setVehicleImageFile(file);
            setVehicleImageUrl(objectUrl);
        }
    };

    const uploadImage = async (file, bucket, path) => {
        const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
        return publicUrl;
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!currentUser || !formData) return;
        setIsSaving(true);
        const toastId = toast.loading("Actualizando ADN ShareWay...");
        try {
            const dataToUpdate = { ...formData };
            if (profileImageFile) {
                const path = `${currentUser.id}/avatar_${Date.now()}.jpg`;
                dataToUpdate.photo_url = await uploadImage(profileImageFile, 'profile-photos', path);
                dataToUpdate.avatar_url = dataToUpdate.photo_url;
            }
            if (vehicleImageFile) {
                const path = `${currentUser.id}/vehicle_${Date.now()}.jpg`;
                const url = await uploadImage(vehicleImageFile, 'verification-documents', path);
                dataToUpdate.vehicle = { ...dataToUpdate.vehicle, photoURL: url };
            }
            const { error } = await supabase.from('profiles').update(dataToUpdate).eq('id', currentUser.id);
            if (error) throw error;
            await refreshProfile();
            toast.success("¡Perfil blindado con éxito!", { id: toastId });
            navigate(`/settings`);
        } catch (error) {
            toast.error("Error al sincronizar", { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    if (!formData) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary" /></div>;

    return (
        <div className="min-h-screen bg-slate-50 pb-40 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12" onClick={() => navigate('/settings')}>
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Mi ADN</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Personalización Elite</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8">
                <form onSubmit={handleSave} className="space-y-8">

                    {/* AVATAR PREMIUM */}
                    <div className="flex flex-col items-center mb-10">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full opacity-50" />
                            <Avatar className="size-44 border-8 border-white shadow-2xl relative z-10">
                                <AvatarImage src={profileImageUrl} />
                                <AvatarFallback className="text-5xl bg-slate-900 text-white font-black italic">{getInitials(formData.display_name)}</AvatarFallback>
                            </Avatar>
                            <Label htmlFor="profile-upload" className="absolute bottom-2 right-2 z-20 bg-primary border-4 border-white text-white rounded-2xl h-14 w-14 flex items-center justify-center cursor-pointer shadow-xl active:scale-90 transition-all">
                                <Camera className="h-6 w-6" />
                            </Label>
                            <Input id="profile-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'profile')} />
                        </div>
                        {currentUser?.verification?.status === 'verified' && (
                            <div className="mt-4 bg-emerald-500/10 text-emerald-600 px-4 py-2 rounded-2xl flex items-center gap-2 border border-emerald-500/20 animate-in zoom-in duration-500">
                                <ShieldCheck size={16} className="text-emerald-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest italic">Conductor Verificado de Élite</span>
                            </div>
                        )}
                    </div>

                    <Accordion type="single" collapsible value={activeSection} onValueChange={setActiveSection} className="space-y-4">

                        {/* DATOS PERSONALES BLINDADOS */}
                        <AccordionItem value="personal" className="bg-white rounded-[2.5rem] shadow-sm border-none overflow-hidden px-2">
                            <AccordionTrigger className="px-8 py-6 hover:no-underline group">
                                <div className="flex items-center gap-4 text-left">
                                    <div className="size-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform"><UserCircle2 className="h-6 w-6" /></div>
                                    <div>
                                        <p className="font-black text-lg tracking-tight text-slate-900 leading-none mb-1 uppercase italic">Identidad</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ADN del Usuario</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-8 pb-10 space-y-6">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><User size={12} className="text-primary" /> Nombre Público</Label>
                                    <Input name="display_name" value={formData.display_name} onChange={handleInputChange} className="h-16 px-6 rounded-2xl bg-slate-50 border-none font-black text-slate-900 shadow-inner text-lg italic tracking-tighter" />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Phone size={12} className="text-primary" /> Teléfono WhatsApp</Label>
                                        <Input name="phone" value={formData.phone} onChange={handleInputChange} className="h-16 px-6 rounded-2xl bg-slate-50 border-none font-black shadow-inner italic" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Users2 size={12} className="text-primary" /> Género</Label>
                                            {currentUser?.verification?.status === 'verified' && <ShieldCheck size={10} className="text-emerald-500" />}
                                        </div>
                                        <Select
                                            value={formData.gender}
                                            onValueChange={(v) => handleInputChange({ target: { name: 'gender', value: v } })}
                                            disabled={currentUser?.verification?.status === 'verified'}
                                        >
                                            <SelectTrigger className="h-16 px-6 rounded-2xl bg-slate-50 border-none font-black shadow-inner disabled:opacity-70 disabled:cursor-not-allowed italic">
                                                <SelectValue placeholder="Seleccionar" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-3xl border-none shadow-2xl">
                                                <SelectItem value="male" className="font-bold uppercase text-[10px]">Masculino</SelectItem>
                                                <SelectItem value="female" className="font-bold uppercase text-[10px]">Femenino</SelectItem>
                                                <SelectItem value="unspecified" className="font-bold uppercase text-[10px]">Privado</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {currentUser?.verification?.status === 'verified' && (
                                            <p className="text-[8px] text-emerald-600 font-bold ml-4 uppercase tracking-wider">Identidad Verificada: Género Bloqueado</p>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Info size={12} className="text-primary" /> Biografía de Conductor</Label>
                                    <Textarea name="bio" value={formData.bio} onChange={handleInputChange} className="min-h-[120px] p-6 rounded-3xl bg-slate-50 border-none font-medium text-slate-700 shadow-inner resize-none italic" placeholder="Ej: Amante de los podcast y el café. Conducción tranquila..." />
                                </div>
                            </AccordionContent>
                        </AccordionItem>

                        {/* MI VEHÍCULO ELITE */}
                        <AccordionItem value="vehicle" className="bg-white rounded-[2.5rem] shadow-sm border-none overflow-hidden px-2" ref={vehicleRef}>
                            <AccordionTrigger className="px-8 py-6 hover:no-underline group">
                                <div className="flex items-center gap-4 text-left">
                                    <div className="size-12 rounded-2xl bg-slate-900 text-primary flex items-center justify-center group-hover:scale-110 transition-transform"><Car className="h-6 w-6" /></div>
                                    <div>
                                        <p className="font-black text-lg tracking-tight text-slate-900 leading-none mb-1 uppercase italic">Mi Vehículo</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ShareWay Garage</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-8 pb-10 space-y-8">
                                <div className="relative group mx-auto w-full">
                                    <div className="aspect-[16/9] rounded-3xl bg-slate-900 border-4 border-white shadow-2xl overflow-hidden flex items-center justify-center relative">
                                        {vehicleImageUrl ? (
                                            <img src={vehicleImageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                        ) : (
                                            <div className="flex flex-col items-center gap-3">
                                                <Car className="size-16 text-white/5" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em]">Sube tu nave</p>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-6">
                                            <p className="text-white text-[10px] font-black uppercase tracking-widest">Cambiar foto del vehículo</p>
                                        </div>
                                    </div>
                                    <Label htmlFor="vehicle-upload" className="absolute -bottom-2 -right-2 bg-primary text-white rounded-xl h-12 w-12 flex items-center justify-center cursor-pointer shadow-xl border-4 border-white active:scale-95 transition-all"><Camera className="h-5 w-5" /></Label>
                                    <Input id="vehicle-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'vehicle')} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label className="text-[9px] font-black uppercase text-slate-400 ml-4">Marca</Label><Input name="make" value={formData.vehicle.make} onChange={handleVehicleChange} placeholder="Ej: Tesla" className="h-14 px-5 rounded-xl bg-slate-50 border-none font-black shadow-inner uppercase tracking-tighter" /></div>
                                    <div className="space-y-2"><Label className="text-[9px] font-black uppercase text-slate-400 ml-4">Modelo</Label><Input name="model" value={formData.vehicle.model} onChange={handleVehicleChange} placeholder="Ej: Model 3" className="h-14 px-5 rounded-xl bg-slate-50 border-none font-black shadow-inner uppercase tracking-tighter" /></div>
                                    <div className="space-y-2 col-span-2">
                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-4 italic">Matrícula Premium</Label>
                                        <Input name="plate" value={formData.vehicle.plate} onChange={handleVehicleChange} placeholder="0000 BBB" className="h-16 px-5 rounded-2xl bg-slate-900 text-primary border-none font-mono font-black shadow-2xl uppercase text-xl text-center tracking-[0.3em]" />
                                        <p className="text-[8px] text-center font-bold text-slate-400 uppercase tracking-widest mt-2">Solo los pasajeros confirmados verán tu matrícula</p>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>

                        {/* PREFERENCIAS DE VIAJE */}
                        <AccordionItem value="preferences" className="bg-white rounded-[2.5rem] shadow-sm border-none overflow-hidden px-2">
                            <AccordionTrigger className="px-8 py-6 hover:no-underline group">
                                <div className="flex items-center gap-4 text-left">
                                    <div className="size-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center group-hover:scale-110 transition-transform"><Heart className="h-6 w-6" /></div>
                                    <div>
                                        <p className="font-black text-lg tracking-tight text-slate-900 leading-none mb-1 uppercase italic">Preferencias</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Style & Vibe</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-8 pb-10 space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    {[
                                        { key: 'smoking', label: 'Tabaco', icon: <Camera size={14} /> },
                                        { key: 'pets', label: 'Mascotas', icon: <Heart size={14} /> },
                                        { key: 'music', label: 'Playlist', icon: <Music size={14} /> },
                                        { key: 'conversation', label: 'Charla', icon: <MessageSquare size={14} /> }
                                    ].map((pref) => (
                                        <div key={pref.key} className="space-y-2">
                                            <Label className="text-[9px] font-black uppercase text-slate-400 ml-4">{pref.label}</Label>
                                            <Select
                                                value={formData.preferences[pref.key || pref.label.toLowerCase()]}
                                                onValueChange={(v) => setFormData(prev => ({ ...prev, preferences: { ...prev.preferences, [pref.key]: v } }))}
                                            >
                                                <SelectTrigger className="h-14 rounded-2xl bg-slate-50 border-none font-black shadow-inner">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                    <SelectItem value="yes" className="font-bold text-[10px] uppercase">Sí</SelectItem>
                                                    <SelectItem value="no" className="font-bold text-[10px] uppercase">No</SelectItem>
                                                    <SelectItem value="any" className="font-bold text-[10px] uppercase">Indiferente</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>

                    </Accordion>

                    <Button type="submit" disabled={isSaving} className="w-full h-20 rounded-[2.5rem] bg-slate-900 hover:bg-slate-800 text-white font-black text-xl tracking-tighter shadow-2xl active:scale-95 transition-all border-none group">
                        {isSaving ? <Loader2 className="animate-spin h-8 w-8" /> : <>ACTUALIZAR ADN <Sparkles className="ml-3 h-6 w-6 text-primary group-hover:rotate-12 transition-transform" /></>}
                    </Button>
                </form>
            </main>
        </div>
    );
}

export default EditProfile;
