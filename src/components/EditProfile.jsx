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
import { useTranslation } from 'react-i18next';

const getInitials = (name) => {
    if (!name) return '?';
    const words = name.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

function EditProfile() {
    const { t } = useTranslation();
    const { user, profile: currentUser, refreshProfile } = useOutletContext();
    const navigate = useNavigate();
    const location = useLocation();

    const queryParams = new URLSearchParams(location.search);
    const initialSection = queryParams.get('section') || 'personal';

    const [formData, setFormData] = useState({
        display_name: '',
        phone: '',
        bio: '',
        gender: 'unspecified',
        vehicle: { make: '', model: '', year: '', color: '', plate: '' },
        preferences: { smoking: 'any', pets: 'any', music: 'any', conversation: 'any' }
    });

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
        return () => {
            if (profileImageUrl && profileImageUrl.startsWith('blob:')) URL.revokeObjectURL(profileImageUrl);
            if (vehicleImageUrl && vehicleImageUrl.startsWith('blob:')) URL.revokeObjectURL(vehicleImageUrl);
        };
    }, [profileImageUrl, vehicleImageUrl]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleVehicleChange = (e) => {
        const { name, value } = e.target;
        const val = name === 'plate' ? value.replace(/\s+/g, '').toUpperCase() : value;
        setFormData(prev => ({ ...prev, vehicle: { ...prev.vehicle, [name]: val } }));
    };

    const handleFileChange = (e, type) => {
        const file = e.target.files[0];
        if (!file) return;

        if (type === 'profile' && profileImageUrl.startsWith('blob:')) URL.revokeObjectURL(profileImageUrl);
        if (type === 'vehicle' && vehicleImageUrl.startsWith('blob:')) URL.revokeObjectURL(vehicleImageUrl);

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
        if (!currentUser || isSaving) return;
        setIsSaving(true);
        const toastId = toast.loading(t('edit_profile.saving_toast'));
        try {
            const dataToUpdate = { ...formData };
            if (profileImageFile) {
                const path = `${currentUser.id}/avatar_${Date.now()}.jpg`;
                dataToUpdate.photo_url = await uploadImage(profileImageFile, 'profile-photos', path);
                dataToUpdate.avatar_url = dataToUpdate.photo_url;
            }
            if (vehicleImageFile) {
                const path = `${currentUser.id}/vehicle_${Date.now()}.jpg`;
                const url = await uploadImage(vehicleImageFile, 'profile-photos', path);
                dataToUpdate.vehicle = { ...dataToUpdate.vehicle, photoURL: url };
            }
            const { error } = await supabase.from('profiles').update(dataToUpdate).eq('id', currentUser.id);
            if (error) throw error;
            await refreshProfile();
            toast.success(t('edit_profile.success_toast'), { id: toastId });
            navigate(`/settings`);
        } catch (error) {
            toast.error(t('edit_profile.error_toast'), { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-40 font-sans">
            <header className="bg-white px-4 md:px-6 py-6 md:py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-10 md:size-12" onClick={() => navigate('/settings')}>
                        <ChevronLeft className="h-5 w-5 md:h-6 md:w-6 text-slate-900" />
                    </Button>
                    <div className="text-left">
                        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('edit_profile.title')}</h1>
                        <p className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{t('edit_profile.subtitle')}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8">
                <form onSubmit={handleSave} className="space-y-8">

                    <div className="flex flex-col items-center mb-10 text-center">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full opacity-50" />
                            <Avatar className="size-36 md:size-44 border-8 border-white shadow-2xl relative z-10">
                                <AvatarImage src={profileImageUrl} />
                                <AvatarFallback className="text-4xl md:text-5xl bg-slate-900 text-white font-black italic">{getInitials(formData.display_name)}</AvatarFallback>
                            </Avatar>
                            <Label htmlFor="profile-upload" className="absolute bottom-1 right-1 md:bottom-2 md:right-2 z-20 bg-primary border-4 border-white text-white rounded-2xl h-12 w-12 md:h-14 md:w-14 flex items-center justify-center cursor-pointer shadow-xl active:scale-90 transition-all">
                                <Camera className="h-5 w-5 md:h-6 md:w-6" />
                            </Label>
                            <Input id="profile-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'profile')} />
                        </div>
                        {currentUser?.verification?.status === 'verified' && (
                            <div className="mt-4 bg-emerald-500/10 text-emerald-600 px-4 py-2 rounded-2xl flex items-center gap-2 border border-emerald-500/20 mx-auto">
                                <ShieldCheck size={16} className="text-emerald-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest italic">{t('edit_profile.verified_driver')}</span>
                            </div>
                        )}
                    </div>

                    <Accordion type="single" collapsible value={activeSection} onValueChange={setActiveSection} className="space-y-4">

                        <AccordionItem value="personal" className="bg-white rounded-3xl shadow-sm border-none overflow-hidden px-2">
                            <AccordionTrigger className="px-8 py-6 hover:no-underline group">
                                <div className="flex items-center gap-4 text-left">
                                    <div className="size-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform"><UserCircle2 className="h-6 w-6" /></div>
                                    <div className="text-left">
                                        <p className="font-black text-lg tracking-tight text-slate-900 leading-none mb-1 uppercase italic">{t('edit_profile.sections.identity')}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('edit_profile.sections.identity_sub')}</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-8 pb-10 space-y-6 text-left">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><User size={12} className="text-primary" /> {t('edit_profile.fields.display_name')}</Label>
                                    <Input name="display_name" value={formData.display_name} onChange={handleInputChange} className="h-12 px-6 rounded-2xl bg-slate-50 border-none font-black text-slate-900 shadow-inner text-lg italic tracking-tighter" />
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Mail size={12} className="text-primary" /> Email</Label>
                                    <Input value={user?.email || ''} readOnly className="h-12 px-6 rounded-2xl bg-slate-100 border-none font-bold text-slate-500 shadow-none text-base" />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Phone size={12} className="text-primary" /> {t('edit_profile.fields.phone')}</Label>
                                        <Input name="phone" value={formData.phone} onChange={handleInputChange} className="h-12 px-6 rounded-2xl bg-slate-50 border-none font-black shadow-inner italic" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Users2 size={12} className="text-primary" /> {t('edit_profile.fields.gender')}</Label>
                                        <Select value={formData.gender} onValueChange={(v) => setFormData(prev => ({ ...prev, gender: v }))} disabled={currentUser?.verification?.status === 'verified'}>
                                            <SelectTrigger className="h-12 px-6 rounded-2xl bg-slate-50 border-none font-black shadow-inner italic">
                                                <SelectValue placeholder={t('edit_profile.select_options.placeholder')} />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-3xl">
                                                <SelectItem value="male">{t('edit_profile.gender_options.male')}</SelectItem>
                                                <SelectItem value="female">{t('edit_profile.gender_options.female')}</SelectItem>
                                                <SelectItem value="unspecified">{t('edit_profile.gender_options.unspecified')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-4 flex items-center gap-2"><Info size={12} className="text-primary" /> {t('edit_profile.fields.bio')}</Label>
                                    <Textarea name="bio" value={formData.bio} onChange={handleInputChange} className="min-h-[120px] p-6 rounded-3xl bg-slate-50 border-none font-medium shadow-inner resize-none italic" placeholder={t('edit_profile.fields.bio_placeholder')} />
                                </div>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="vehicle" className="bg-white rounded-3xl shadow-sm border-none overflow-hidden px-2" ref={vehicleRef}>
                            <AccordionTrigger className="px-8 py-6 hover:no-underline group">
                                <div className="flex items-center gap-4 text-left">
                                    <div className="size-12 rounded-2xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] text-primary flex items-center justify-center group-hover:scale-110 transition-transform"><Car className="h-6 w-6" /></div>
                                    <div className="text-left">
                                        <p className="font-black text-lg tracking-tight text-slate-900 leading-none mb-1 uppercase italic">{t('edit_profile.sections.vehicle')}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Garage</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-8 pb-10 space-y-8 text-left">
                                <div className="relative group mx-auto w-full">
                                    <div className="aspect-[16/9] rounded-3xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] border-4 border-white shadow-2xl overflow-hidden flex items-center justify-center relative">
                                        {vehicleImageUrl ? (
                                            <img src={vehicleImageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt="Vehículo" />
                                        ) : (
                                            <div className="text-center">
                                                <Car className="size-16 text-white/5 mx-auto mb-2" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em]">{t('edit_profile.fields.upload_vehicle')}</p>
                                            </div>
                                        )}
                                    </div>
                                    <Label htmlFor="vehicle-upload" className="absolute -bottom-2 -right-2 bg-primary text-white rounded-xl h-12 w-12 flex items-center justify-center cursor-pointer shadow-xl border-4 border-white active:scale-95 transition-all"><Camera className="h-5 w-5" /></Label>
                                    <Input id="vehicle-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'vehicle')} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2"><Label className="text-[9px] font-black uppercase text-slate-400 ml-4">{t('edit_profile.fields.make')}</Label><Input name="make" value={formData.vehicle.make} onChange={handleVehicleChange} placeholder="Tesla" className="h-14 px-5 rounded-xl bg-slate-50 border-none font-black shadow-inner uppercase" /></div>
                                    <div className="space-y-2"><Label className="text-[9px] font-black uppercase text-slate-400 ml-4">{t('edit_profile.fields.model')}</Label><Input name="model" value={formData.vehicle.model} onChange={handleVehicleChange} placeholder="Model 3" className="h-14 px-5 rounded-xl bg-slate-50 border-none font-black shadow-inner uppercase" /></div>
                                    <div className="space-y-2 col-span-2">
                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-4 italic">{t('edit_profile.fields.plate')}</Label>
                                        <Input name="plate" value={formData.vehicle.plate} onChange={handleVehicleChange} placeholder="0000 BBB" className="h-12 px-5 rounded-2xl bg-slate-900 text-primary border-none font-mono font-black shadow-2xl text-xl text-center tracking-[0.3em]" />
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    <Button type="submit" disabled={isSaving} className="w-full h-12 md:h-14 rounded-3xl md:rounded-3xl bg-primary text-white font-black text-lg md:text-xl tracking-tighter shadow-2xl active:scale-95 border-none group">
                        {isSaving ? <Loader2 className="animate-spin h-6 w-6 md:h-8 md:w-8" /> : <>{t('edit_profile.save_button')} <Sparkles className="ml-3 h-5 w-5 md:h-6 md:w-6 text-primary group-hover:rotate-12 transition-transform" /></>}
                    </Button>
                </form>
            </main>
        </div>
    );
}

export default EditProfile;
