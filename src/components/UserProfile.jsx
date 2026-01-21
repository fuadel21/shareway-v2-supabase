import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
    Loader2, Star, Calendar, Pencil, Music, MessageCircle,
    Car, ShieldCheck, MapPin, Share2, Info, ChevronRight,
    Sparkles, UserCheck, ShieldClose, Leaf, Award, Sprout, Trees, Mountain,
    ChevronLeft, TrendingUp, Zap, Heart,
    History as HistoryIcon
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import ReviewsList from './ReviewsList';
import { getImpactEquivalency } from '@/utils/climateImpact';

const StatCard = ({ icon: Icon, value, label, color }) => (
    <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center text-center gap-1 transition-all hover:shadow-md">
        <div className={cn("p-2 rounded-xl mb-1", color)}>
            {Icon && <Icon className="h-4 w-4" />}
        </div>
        <p className="font-black text-lg text-slate-900 leading-none">{value}</p>
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    </div>
);

// BLINDAJE: Esquema de fallback para evitar Null Pointers en el renderizado
const DEFAULT_PROFILE = {
    display_name: 'Miembro',
    rating: '5.0',
    rides_count: 0,
    total_co2_saved: 0,
    eco_tier: 'Seed',
    eco_points: 0,
    verification_status: 'not_verified',
    vehicle: { make: '', model: '', color: '' },
    preferences: {}
};

function UserProfile() {
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
                // RPC blindado para datos públicos
                const { data: pData, error: pErr } = await supabase.rpc('get_public_profile', { p_user_id: userId });
                
                if (pErr) throw pErr;
                if (isMounted && pData) {
                    setProfile({
                        ...DEFAULT_PROFILE,
                        ...pData,
                        vehicle: pData.vehicle || DEFAULT_PROFILE.vehicle
                    });
                }

                // Carga de logros con validación defensiva
                const { data: aData } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', userId);
                if (isMounted && aData && aData.length > 0) {
                    const ids = aData.map(a => a.achievement_id);
                    const { data: achs } = await supabase.from('achievements').select('*').in('id', ids);
                    if (isMounted) setAchievements(achs || []);
                }
            } catch (e) {
                console.error("⛔ CRITICAL: Profile Load Failure:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchProfileData();
        return () => { isMounted = false; };
    }, [userId]);

    const memberDate = useMemo(() => {
        if (!profile?.created_at) return 'Recientemente';
        const d = new Date(profile.created_at);
        return isValid(d) ? format(d, "MMM yyyy", { locale: es }) : 'Recientemente';
    }, [profile?.created_at]);

    // BLINDAJE: Lógica de Tiers dinámicos para evitar ReferenceErrors
    const ecoSystem = useMemo(() => {
        const tier = profile.eco_tier || 'Seed';
        const config = {
            Forest: { icon: Mountain, color: 'bg-emerald-50 text-emerald-600' },
            Tree: { icon: Trees, color: 'bg-green-50 text-green-600' },
            Seed: { icon: Sprout, color: 'bg-lime-50 text-lime-600' }
        };
        return config[tier] || config.Seed;
    }, [profile.eco_tier]);

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" /></div>;

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20">
                <div className="max-w-xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12" onClick={() => navigate(-1)}>
                            <ChevronLeft className="h-6 w-6 text-slate-900" />
                        </Button>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Perfil</h1>
                    </div>
                    {isOwnProfile && (
                        <Button variant="outline" size="icon" className="rounded-2xl size-12 border-slate-100" onClick={() => navigate('/edit-profile')}>
                            <Pencil className="h-5 w-5 text-slate-600" />
                        </Button>
                    )}
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 space-y-8">
                <div className="relative text-center space-y-4">
                    <div className="relative inline-block">
                        <Avatar className="h-32 w-32 border-4 border-white shadow-2xl relative z-10 mx-auto">
                            <AvatarImage src={profile.photo_url || profile.avatar_url} />
                            <AvatarFallback className="bg-slate-900 text-white text-3xl font-black">{profile.display_name?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                        {profile.verification_status === 'verified' && (
                            <div className="absolute bottom-1 right-1 bg-emerald-500 border-4 border-white h-8 w-8 rounded-full z-20 flex items-center justify-center shadow-lg animate-in zoom-in">
                                <ShieldCheck className="h-4 w-4 text-white" />
                            </div>
                        )}
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic truncate px-4">{profile.display_name}</h2>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            <div className="flex items-center gap-1 text-amber-500"><Star className="h-4 w-4 fill-current" /><span className="font-black text-sm">{profile.rating}</span></div>
                            <span className="text-slate-300">•</span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Miembro desde {memberDate}</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <StatCard icon={TrendingUp} value={profile.rides_count} label="Viajes" color="bg-indigo-50 text-indigo-600" />
                    <StatCard icon={Leaf} value={parseFloat(profile.total_co2_saved).toFixed(1)} label="kg CO2" color="bg-emerald-50 text-emerald-600" />
                    <StatCard icon={ecoSystem.icon} value={profile.eco_tier} label="Nivel Eco" color={ecoSystem.color} />
                    <StatCard icon={Sprout} value={profile.eco_points || 0} label="Green Miles" color="bg-lime-50 text-lime-600" />
                    <StatCard icon={Award} value={achievements.length} label="Logros" color="bg-amber-50 text-amber-600" />
                </div>

                {parseFloat(profile.total_co2_saved) > 0 && (
                    <div className="bg-emerald-50 rounded-[2rem] p-6 border border-emerald-100 relative overflow-hidden shadow-sm">
                        <div className="absolute top-0 right-0 p-6 opacity-10">
                            <Leaf size={100} className="text-emerald-600 rotate-12" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="bg-white p-2 rounded-xl shadow-sm text-emerald-600">
                                    <Leaf className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="font-black text-lg text-emerald-900 uppercase italic tracking-tighter leading-none">Impacto Real</h3>
                                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Planeta Agradecido</p>
                                </div>
                            </div>
                            <p className="text-emerald-800 text-sm font-medium mb-3 leading-relaxed">
                                Gracias a tus decisiones de movilidad compartida, has evitado la emisión de <span className="font-black text-2xl align-middle mx-1">{parseFloat(profile.total_co2_saved).toFixed(1)} kg</span> de CO₂.
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

                {profile.vehicle && (profile.vehicle.make || profile.vehicle.model) && (
                    <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-900 overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-8 opacity-10"><Car size={120} className="text-white" /></div>
                        <div className="p-8 text-white relative z-10">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="bg-white/10 p-3 rounded-2xl backdrop-blur-md"><Car className="h-6 w-6 text-primary" /></div>
                                <div><h3 className="font-black text-lg uppercase tracking-tighter italic leading-none">Vehículo</h3><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Transporte Premium</p></div>
                            </div>
                            <div className="flex justify-between items-end">
                                <div><p className="text-2xl font-black tracking-tight uppercase italic leading-none">{profile.vehicle.make} {profile.vehicle.model}</p><p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{profile.vehicle.color || 'Estándar'}</p></div>
                            </div>
                        </div>
                    </Card>
                )}

                <div className="space-y-4">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4 italic">Medallero Elite</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {achievements.length > 0 ? achievements.map((ach, idx) => (
                            <div key={idx} className="bg-white p-5 rounded-[2rem] border border-slate-100 flex flex-col items-center text-center gap-2 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${idx * 100}ms` }}>
                                <div className="bg-slate-50 p-3 rounded-2xl shadow-inner"><Award className="h-6 w-6 text-primary" /></div>
                                <div><p className="font-black text-[10px] text-slate-900 uppercase tracking-tighter italic">{ach.name}</p><p className="text-[8px] font-bold text-slate-400 uppercase">Verificado</p></div>
                            </div>
                        )) : (
                            <div className="col-span-2 py-10 bg-white/50 rounded-[2rem] border-2 border-dashed border-slate-200 flex flex-col items-center"><Zap className="h-8 w-8 text-slate-200 mb-2" /><p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Sin medallas todavía</p></div>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4 italic">Testimonios Corales</h3>
                    <ReviewsList userId={userId} />
                </div>
            </main>
        </div>
    );
}

export default UserProfile;
