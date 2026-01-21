import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import {
    Loader2, Award, CheckCircle2, Trophy, Sparkles,
    Leaf, ShieldCheck, Zap, ZapOff, Star,
    Crown, Medal, Rocket, Flame, Heart,
    Lock, BadgeCheck, Fingerprint
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Mapa de iconos disponibles para logros
const ICON_MAP = {
    'first_ride': Rocket,
    'eco_friendly': Leaf,
    'verified_user': BadgeCheck,
    'popular': flame => Flame, // Soporte para strings
    'default': Award,
    'Award': Award,
    'Leaf': Leaf,
    'ShieldCheck': ShieldCheck,
    'Trophy': Trophy,
    'Star': Star,
    'Crown': Crown,
    'Medal': Medal,
    'Flame': Flame,
    'Heart': Heart,
    'Fingerprint': Fingerprint
};

const AchievementCard = ({ achievement, isUnlocked, unlockedAt, index }) => {
    const IconComponent = ICON_MAP[achievement.icon] || ICON_MAP[achievement.id] || ICON_MAP.default;

    return (
        <div
            className={cn(
                "group relative overflow-hidden rounded-[2.5rem] p-8 flex items-center gap-6 transition-all duration-700 animate-in fade-in slide-in-from-bottom-8",
                isUnlocked
                    ? "bg-white shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-primary/10"
                    : "bg-white/40 backdrop-blur-xl border border-white/60 grayscale opacity-70 hover:grayscale-0 hover:opacity-100"
            )}
            style={{ animationDelay: `${index * 100}ms` }}
        >
            {/* ICONO CON ESTILO PREMIUM */}
            <div className={cn(
                "h-20 w-20 rounded-[1.8rem] flex items-center justify-center shrink-0 shadow-2xl transition-all duration-700 group-hover:scale-110",
                isUnlocked
                    ? "bg-navy text-primary shadow-primary/20 rotate-3 group-hover:rotate-6"
                    : "bg-slate-100 text-slate-300"
            )}>
                <IconComponent className={cn("h-10 w-10", isUnlocked && "animate-pulse")} strokeWidth={1.5} />
            </div>

            {/* TEXTO Y ESTADO */}
            <div className="flex-grow space-y-2">
                <div className="flex items-center justify-between">
                    <p className={cn(
                        "font-black text-xl tracking-tighter uppercase italic leading-none transition-colors",
                        isUnlocked ? "text-slate-900" : "text-slate-400"
                    )}>
                        {achievement.name}
                    </p>
                    {isUnlocked ? (
                        <div className="bg-primary/10 p-1.5 rounded-full">
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                        </div>
                    ) : (
                        <Lock className="h-4 w-4 text-slate-200" />
                    )}
                </div>

                <p className={cn(
                    "text-[10px] font-bold uppercase tracking-widest leading-relaxed",
                    isUnlocked ? "text-slate-500" : "text-slate-300"
                )}>
                    {achievement.description}
                </p>

                {isUnlocked && unlockedAt && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-50 mt-4">
                        <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                        <span className="text-[8px] font-black uppercase text-slate-300 tracking-[0.2em]">
                            ADQUIRIDO EL {format(new Date(unlockedAt), "dd/MM/yyyy", { locale: es })}
                        </span>
                    </div>
                )}
            </div>

            {/* DECORACIÓN BACKGROUND */}
            {isUnlocked && (
                <div className="absolute -top-6 -right-6 opacity-[0.03] group-hover:opacity-10 transition-opacity">
                    <IconComponent size={140} />
                </div>
            )}
        </div>
    );
};

const Achievements = () => {
    const { user, profile } = useOutletContext();
    const [allAchievements, setAllAchievements] = useState([]);
    const [userAchievements, setUserAchievements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!user) return;
            setLoading(true);
            try {
                // Sincronizar con la DB
                const [allAchievementsRes, userAchievementsRes] = await Promise.all([
                    supabase.from('achievements').select('*'),
                    supabase.from('user_achievements').select('*, achievement:achievements(*)').eq('user_id', user.id)
                ]);

                if (allAchievementsRes.error) throw allAchievementsRes.error;
                if (userAchievementsRes.error) throw userAchievementsRes.error;

                setAllAchievements(allAchievementsRes.data || []);
                setUserAchievements(userAchievementsRes.data || []);
            } catch (error) {
                console.error("Error achievements:", error);
                toast.error("Error de sincronización", { description: "No pudimos cargar tu salón de la fama." });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [user]);

    const mergedAchievements = useMemo(() => {
        const userAchievementMap = new Map(userAchievements.map(ua => [ua.achievement_id, ua]));
        return allAchievements.map(ach => ({
            ...ach,
            isUnlocked: userAchievementMap.has(ach.id),
            unlockedAt: userAchievementMap.get(ach.id)?.created_at
        })).sort((a, b) => b.isUnlocked - a.isUnlocked);
    }, [allAchievements, userAchievements]);

    const stats = useMemo(() => {
        const total = allAchievements.length;
        const unlocked = userAchievements.length;
        const percent = total > 0 ? (unlocked / total) * 100 : 0;
        return { total, unlocked, percent };
    }, [allAchievements, userAchievements]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="animate-spin h-10 w-10 text-primary" strokeWidth={1} />
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Escaneando Medallas</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-40">
            <SubPageHeader title="Hall of Fame" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-12">

                {/* PROGRESS HERO CARD */}
                <div className="bg-navy rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-110 transition-transform duration-1000">
                        <Trophy size={160} className="text-primary rotate-12" />
                    </div>

                    <div className="relative z-10 space-y-8">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mb-2">Progreso General</p>
                            <h2 className="text-4xl font-black tracking-tighter uppercase italic leading-none">Nivel de Leyenda</h2>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <p className="text-sm font-bold opacity-60 uppercase tracking-widest">{stats.unlocked} de {stats.total} Logros</p>
                                <p className="text-3xl font-black text-primary italic tracking-tight">{Math.round(stats.percent)}%</p>
                            </div>
                            <div className="h-4 bg-white/5 rounded-full overflow-hidden p-1 border border-white/5">
                                <div
                                    className="h-full bg-gradient-to-r from-primary to-orange-400 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                                    style={{ width: `${stats.percent}%` }}
                                />
                            </div>
                        </div>

                        {/* IMPACT STATS */}
                        <div className="flex gap-4">
                            <div className="flex-1 bg-white/5 backdrop-blur-lg rounded-2xl p-4 border border-white/5 flex items-center gap-3">
                                <div className="size-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                                    <Leaf className="size-5 text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-[8px] font-black uppercase tracking-widest opacity-40">CO2 AHORRADO</p>
                                    <p className="text-lg font-black tracking-tight">{profile?.total_co2_saved || 0}kg</p>
                                </div>
                            </div>
                            <div className="flex-1 bg-white/5 backdrop-blur-lg rounded-2xl p-4 border border-white/5 flex items-center gap-3">
                                <div className="size-10 bg-primary/20 rounded-xl flex items-center justify-center">
                                    <Star className="size-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-[8px] font-black uppercase tracking-widest opacity-40">PUNTOS XP</p>
                                    <p className="text-lg font-black tracking-tight">{stats.unlocked * 150}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ACHIEVEMENTS GRID */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-4">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Colección de Insignias</h3>
                        <Trophy className="size-4 text-slate-200" />
                    </div>
                    {mergedAchievements.map((ach, idx) => (
                        <AchievementCard
                            key={ach.id}
                            achievement={ach}
                            isUnlocked={ach.isUnlocked}
                            unlockedAt={ach.unlockedAt}
                            index={idx}
                        />
                    ))}
                </div>

                <div className="py-10 text-center">
                    <p className="text-[9px] font-black uppercase tracking-[0.5em] text-slate-300">ShareWay Gamification System v1.5</p>
                </div>
            </main>
        </div>
    );
};

export default Achievements;
