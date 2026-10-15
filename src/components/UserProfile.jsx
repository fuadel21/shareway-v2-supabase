import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
    Loader2, Star, Pencil,
    Car, ShieldCheck, Info,
    Leaf, Sprout, Trees, Mountain,
    ChevronLeft, TrendingUp, Navigation
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReviewsList from './ReviewsList';
import { getImpactEquivalency } from '@/utils/climateImpact';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        title: 'Perfil',
        member: 'Miembro',
        trips: 'viajes',
        memberSince: 'Miembro desde',
        statTrips: 'Viajes',
        statLevel: 'Nivel',
        biography: 'Biografía',
        realImpact: 'Impacto Real',
        gratefulPlanet: 'Planeta Agradecido',
        avoidedCo2: 'Has evitado la emisión de',
        vehicle: 'Vehículo',
        premiumTransport: 'Transporte Premium',
        standard: 'Estándar',
        testimonials: 'Testimonios Corales',
        trustTitle: 'Confianza del perfil',
        trustReady: 'Perfil fuerte para compartir viaje',
        trustPending: 'Perfil en progreso',
        trustDescReady: 'Este perfil ya muestra señales clave antes de reservar.',
        trustDescPending: 'Completar estos puntos ayuda a que otros usuarios reserven con más tranquilidad.',
        verified: 'Verificación',
        verifiedOk: 'Identidad verificada',
        verifiedPending: 'Pendiente de verificación',
        ridesSignal: 'Historial',
        ridesOk: 'Tiene viajes registrados',
        ridesPending: 'Aún sin viajes',
        vehicleSignal: 'Vehículo',
        vehicleOk: 'Vehículo visible',
        vehiclePending: 'Vehículo pendiente',
        bioSignal: 'Presentación',
        bioOk: 'Biografía añadida',
        bioPending: 'Añadir biografía',
        editProfile: 'Editar perfil',
        locale: 'es-ES'
    },
    en: {
        title: 'Profile',
        member: 'Member',
        trips: 'rides',
        memberSince: 'Member since',
        statTrips: 'Rides',
        statLevel: 'Level',
        biography: 'Biography',
        realImpact: 'Real Impact',
        gratefulPlanet: 'Grateful Planet',
        avoidedCo2: 'You have avoided the emission of',
        vehicle: 'Vehicle',
        premiumTransport: 'Premium Transport',
        standard: 'Standard',
        testimonials: 'Community Testimonials',
        trustTitle: 'Profile trust',
        trustReady: 'Strong ride-sharing profile',
        trustPending: 'Profile in progress',
        trustDescReady: 'This profile already shows key trust signals before booking.',
        trustDescPending: 'Completing these points helps other users book with more confidence.',
        verified: 'Verification',
        verifiedOk: 'Identity verified',
        verifiedPending: 'Verification pending',
        ridesSignal: 'History',
        ridesOk: 'Has ride history',
        ridesPending: 'No rides yet',
        vehicleSignal: 'Vehicle',
        vehicleOk: 'Vehicle visible',
        vehiclePending: 'Vehicle pending',
        bioSignal: 'Intro',
        bioOk: 'Bio added',
        bioPending: 'Add a bio',
        editProfile: 'Edit profile',
        locale: 'en-US'
    },
    ar: {
        title: 'الملف الشخصي',
        member: 'عضو',
        trips: 'رحلات',
        memberSince: 'عضو منذ',
        statTrips: 'الرحلات',
        statLevel: 'المستوى',
        biography: 'نبذة شخصية',
        realImpact: 'الأثر الحقيقي',
        gratefulPlanet: 'الكوكب ممتن',
        avoidedCo2: 'لقد تجنبت انبعاث',
        vehicle: 'المركبة',
        premiumTransport: 'نقل مميز',
        standard: 'قياسي',
        testimonials: 'آراء المجتمع',
        trustTitle: 'ثقة الملف',
        trustReady: 'ملف قوي لمشاركة الرحلات',
        trustPending: 'الملف قيد الإكمال',
        trustDescReady: 'يعرض هذا الملف إشارات ثقة مهمة قبل الحجز.',
        trustDescPending: 'إكمال هذه النقاط يساعد الآخرين على الحجز بثقة أكبر.',
        verified: 'التحقق',
        verifiedOk: 'الهوية موثقة',
        verifiedPending: 'التحقق معلق',
        ridesSignal: 'السجل',
        ridesOk: 'لديه رحلات مسجلة',
        ridesPending: 'لا توجد رحلات بعد',
        vehicleSignal: 'المركبة',
        vehicleOk: 'المركبة ظاهرة',
        vehiclePending: 'المركبة غير مكتملة',
        bioSignal: 'التعريف',
        bioOk: 'تمت إضافة نبذة',
        bioPending: 'أضف نبذة',
        editProfile: 'تعديل الملف',
        locale: 'ar-SA'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const StatCard = ({ icon: Icon, value, label, color }) => (
    <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center text-center gap-1 transition-all hover:shadow-md">
        <div className={cn('p-2 rounded-xl mb-1', color)}>
            {Icon && <Icon className="h-4 w-4" />}
        </div>
        <p className="font-black text-lg text-slate-900 leading-none">{value}</p>
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    </div>
);

const TrustSignal = ({ active, label, detail, icon: Icon }) => (
    <div className={cn(
        'rounded-3xl border p-4 flex items-start gap-3 transition-all',
        active ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
    )}>
        <div className={cn(
            'h-10 w-10 rounded-2xl flex items-center justify-center shrink-0',
            active ? 'bg-emerald-500 text-white' : 'bg-white text-slate-300'
        )}>
            <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 text-left">
            <p className={cn('text-[10px] font-black uppercase tracking-widest', active ? 'text-emerald-700' : 'text-slate-400')}>{label}</p>
            <p className="text-xs font-bold text-slate-700 leading-5">{detail}</p>
        </div>
    </div>
);

const DEFAULT_PROFILE = {
    display_name: '',
    rating: '5.0',
    rides_count: 0,
    total_co2_saved: 0,
    total_km_shared: 0,
    eco_tier: 'Seed',
    eco_points: 0,
    verification_status: 'not_verified',
    vehicle: { make: '', model: '', color: '' },
    bio: '',
    preferences: {}
};

function UserProfile() {
    const { i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];
    const { userId } = useParams();
    const navigate = useNavigate();
    const { profile: currentUser } = useOutletContext();
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [achievements, setAchievements] = useState([]);
    const [loading, setLoading] = useState(true);

    const isOwnProfile = currentUser?.id === userId;

    useEffect(() => {
        let isMounted = true;
        if (!userId) return;

        const fetchProfileData = async () => {
            setLoading(true);
            try {
                const { data: pData, error: pErr } = await supabase.rpc('get_public_profile', { p_user_id: userId });

                if (pErr) throw pErr;
                if (isMounted && pData) {
                    setProfile({
                        ...DEFAULT_PROFILE,
                        ...pData,
                        display_name: pData.display_name || copy.member,
                        rating: pData.rating ? parseFloat(pData.rating).toFixed(1) : '5.0',
                        vehicle: pData.vehicle || DEFAULT_PROFILE.vehicle
                    });
                }

                const { data: aData } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', userId);
                if (isMounted && aData && aData.length > 0) {
                    const ids = aData.map(a => a.achievement_id);
                    const { data: achs } = await supabase.from('achievements').select('*').in('id', ids);
                    if (isMounted) setAchievements(achs || []);
                }
            } catch (e) {
                console.error('⛔ CRITICAL: Profile Load Failure:', e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchProfileData();
        return () => { isMounted = false; };
    }, [userId, copy.member]);

    const memberDate = useMemo(() => {
        if (!profile?.created_at) return '...';
        const d = new Date(profile.created_at);
        if (Number.isNaN(d.getTime())) return '...';
        return new Intl.DateTimeFormat(copy.locale, { month: 'short', year: 'numeric' }).format(d);
    }, [profile?.created_at, copy.locale]);

    const ecoSystem = useMemo(() => {
        const tier = profile.eco_tier || 'Seed';
        const config = {
            Forest: { icon: Mountain, color: 'bg-emerald-50 text-emerald-600' },
            Tree: { icon: Trees, color: 'bg-green-50 text-green-600' },
            Seed: { icon: Sprout, color: 'bg-lime-50 text-lime-600' }
        };
        return config[tier] || config.Seed;
    }, [profile.eco_tier]);

    const trustSignals = useMemo(() => {
        const hasVehicle = Boolean(profile.vehicle?.make || profile.vehicle?.model || profile.vehicle?.photoURL);
        const hasRides = Number(profile.rides_count || 0) > 0;
        const isVerified = profile.verification_status === 'verified';
        const hasBio = Boolean(String(profile.bio || '').trim());
        const signals = [
            { key: 'verified', active: isVerified, label: copy.verified, detail: isVerified ? copy.verifiedOk : copy.verifiedPending, icon: ShieldCheck },
            { key: 'rides', active: hasRides, label: copy.ridesSignal, detail: hasRides ? copy.ridesOk : copy.ridesPending, icon: TrendingUp },
            { key: 'vehicle', active: hasVehicle, label: copy.vehicleSignal, detail: hasVehicle ? copy.vehicleOk : copy.vehiclePending, icon: Car },
            { key: 'bio', active: hasBio, label: copy.bioSignal, detail: hasBio ? copy.bioOk : copy.bioPending, icon: Info }
        ];
        return {
            signals,
            completed: signals.filter((signal) => signal.active).length
        };
    }, [profile, copy]);

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" /></div>;

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans text-left">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12" onClick={() => navigate(-1)}>
                            <ChevronLeft className="h-6 w-6 text-slate-900" />
                        </Button>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{copy.title}</h1>
                    </div>
                    {isOwnProfile && (
                        <Button variant="outline" size="icon" className="rounded-2xl size-12 border-slate-100" onClick={() => navigate('/profile/edit')}>
                            <Pencil className="h-5 w-5 text-slate-600" />
                        </Button>
                    )}
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 space-y-5 text-left">
                <div className="relative text-center space-y-4">
                    <div className="relative inline-block">
                        <Avatar className="h-32 w-32 border-4 border-white shadow-2xl relative z-10 mx-auto transition-transform hover:scale-105 duration-500">
                            <AvatarImage src={profile.photo_url || profile.avatar_url} />
                            <AvatarFallback className="bg-gradient-to-br from-[#1267FF] to-[#0FC6A6] text-white text-3xl font-black">{profile.display_name?.[0] || 'U'}</AvatarFallback>
                        </Avatar>

                        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white px-4 py-1.5 rounded-full shadow-xl border border-slate-100 flex items-center gap-1.5 animate-in zoom-in duration-700 delay-300">
                            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                            <span className="font-black text-slate-900 text-sm">{profile.rating}</span>
                            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest ml-1">{profile.rides_count} {copy.trips}</span>
                        </div>

                        {profile.verification_status === 'verified' && (
                            <div className="absolute top-0 right-0 bg-emerald-500 border-4 border-white h-8 w-8 rounded-full z-20 flex items-center justify-center shadow-lg animate-in zoom-in">
                                <ShieldCheck className="h-4 w-4 text-white" />
                            </div>
                        )}
                    </div>
                    <div className="pt-4">
                        <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic truncate px-4">{profile.display_name}</h2>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{copy.memberSince} {memberDate}</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                    <StatCard icon={TrendingUp} value={profile.rides_count} label={copy.statTrips} color="bg-indigo-50 text-indigo-600" />
                    <StatCard icon={Navigation} value={Math.round(profile.total_km_shared || 0)} label="KM" color="bg-blue-50 text-blue-600" />
                    <StatCard icon={Leaf} value={parseFloat(profile.total_co2_saved).toFixed(1)} label="kg CO2" color="bg-emerald-50 text-emerald-600" />
                    <StatCard icon={ecoSystem.icon} value={profile.eco_tier} label={copy.statLevel} color={ecoSystem.color} />
                </div>

                <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="text-left">
                            <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em] mb-2">{copy.trustTitle}</p>
                            <h3 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 leading-none">
                                {trustSignals.completed >= 3 ? copy.trustReady : copy.trustPending}
                            </h3>
                            <p className="text-xs font-bold text-slate-400 leading-5 mt-2">
                                {trustSignals.completed >= 3 ? copy.trustDescReady : copy.trustDescPending}
                            </p>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-[#0FC6A6] via-[#1267FF] to-[#0B2A86] px-4 py-3 text-center shrink-0">
                            <p className="text-[8px] font-black uppercase tracking-widest text-white/40">Trust</p>
                            <p className="text-xl font-black text-primary">{trustSignals.completed}/4</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                        {trustSignals.signals.map((signal) => (
                            <TrustSignal key={signal.key} {...signal} />
                        ))}
                    </div>
                    {isOwnProfile && trustSignals.completed < 4 && (
                        <Button onClick={() => navigate('/profile/edit')} className="w-full h-14 rounded-2xl font-black uppercase tracking-normal">
                            {copy.editProfile}
                        </Button>
                    )}
                </section>

                {profile.bio && (
                    <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Info size={12} className="text-primary" /> {copy.biography}</p>
                        <p className="text-slate-600 font-medium italic whitespace-pre-line leading-relaxed">
                            "{profile.bio}"
                        </p>
                    </div>
                )}

                {parseFloat(profile.total_co2_saved) > 0 && (
                    <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 relative overflow-hidden shadow-sm">
                        <div className="absolute top-0 right-0 p-6 opacity-10">
                            <Leaf size={100} className="text-emerald-600 rotate-12" />
                        </div>
                        <div className="relative z-10 text-left">
                            <div className="flex items-center gap-3 mb-3 text-left">
                                <div className="bg-white p-2 rounded-xl shadow-sm text-emerald-600">
                                    <Leaf className="h-5 w-5" />
                                </div>
                                <div className="text-left">
                                    <h3 className="font-black text-lg text-emerald-900 uppercase italic tracking-tighter leading-none">{copy.realImpact}</h3>
                                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">{copy.gratefulPlanet}</p>
                                </div>
                            </div>
                            <p className="text-emerald-800 text-sm font-medium mb-3 leading-relaxed">
                                {copy.avoidedCo2} <span className="font-black text-2xl align-middle mx-1">{parseFloat(profile.total_co2_saved).toFixed(1)} kg</span> CO₂.
                            </p>
                            <div className="bg-white/60 rounded-xl p-3 border border-emerald-100/50 backdrop-blur-sm">
                                <p className="text-emerald-700 text-xs font-bold italic flex items-center gap-2">
                                    <Trees className="h-4 w-4 flex-shrink-0" />
                                    {getImpactEquivalency(parseFloat(profile.total_co2_saved))}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {profile.vehicle && (profile.vehicle.make || profile.vehicle.model || profile.vehicle.photoURL) && (
                    <Card className="rounded-3xl border-none shadow-xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-8 opacity-10"><Car size={120} className="text-white" /></div>
                        <div className="p-8 text-white relative z-10 text-left">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="bg-white/10 p-3 rounded-2xl backdrop-blur-md"><Car className="h-6 w-6 text-primary" /></div>
                                <div className="text-left"><h3 className="font-black text-lg uppercase tracking-tighter italic leading-none">{copy.vehicle}</h3><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{copy.premiumTransport}</p></div>
                            </div>
                            <div className="flex flex-col md:flex-row md:items-center gap-6">
                                {profile.vehicle.photoURL && (
                                    <div className="h-32 w-full md:w-48 rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl shrink-0">
                                        <img src={profile.vehicle.photoURL} alt={copy.vehicle} className="w-full h-full object-cover" />
                                    </div>
                                )}
                                <div className="text-left">
                                    <p className="text-2xl font-black tracking-tight uppercase italic leading-none">{profile.vehicle.make} {profile.vehicle.model}</p>
                                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{profile.vehicle.color || copy.standard}</p>
                                </div>
                            </div>
                        </div>
                    </Card>
                )}

                <div className="space-y-4">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4 italic">{copy.testimonials}</h3>
                    <ReviewsList userId={userId} />
                </div>
            </main>
        </div>
    );
}

export default UserProfile;
