/**
 * Simple Gamification Widget - Versión Mini
 * Optimizada para ahorrar espacio vertical en el Dashboard
 */

import React, { useState, useEffect } from 'react';
import { Trophy, Star, Zap, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { supabase } from '@/lib/supabase';

const SimpleGamificationWidget = ({ userId }) => {
    const [userStats, setUserStats] = useState({
        level: 1,
        xp: 0,
        points: 0,
        streak: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) return;
        const loadBasicStats = async () => {
            try {
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('total_co2_saved')
                    .eq('id', userId)
                    .single();

                if (error) throw error;
                const co2Saved = parseFloat(profile?.total_co2_saved) || 0;
                const calculatedLevel = Math.min(10, Math.floor(co2Saved / 10) + 1);
                const calculatedXP = Math.floor(co2Saved * 10);

                setUserStats({
                    level: calculatedLevel,
                    xp: calculatedXP,
                    points: calculatedXP,
                    streak: 0
                });
            } catch (error) {
                console.error('🛡️ [Simple Gamification] Error:', error);
            } finally {
                setLoading(false);
            }
        };
        loadBasicStats();
    }, [userId]);

    if (loading) return <div className="h-14 bg-slate-50 rounded-2xl animate-pulse" />;

    const getLevelIcon = (level) => {
        const icons = { 1: '🌱', 2: '🍃', 3: '🌿', 4: '🌳', 5: '🌲', 6: '🏆', 7: '💎', 8: '👑', 9: '🌍', 10: '✨' };
        return icons[level] || '🌱';
    };

    return (
        <Card className="w-full bg-gradient-to-br from-emerald-50/50 to-teal-50/50 border-emerald-100/50 shadow-sm rounded-3xl overflow-hidden">
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="size-10 bg-emerald-500 rounded-2xl flex items-center justify-center text-lg shadow-sm">
                            {getLevelIcon(userStats.level)}
                        </div>
                        <div className="text-left leading-tight">
                            <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Nivel {userStats.level}</p>
                            <p className="text-[9px] font-bold text-emerald-600/60 uppercase">{userStats.xp} XP acumulados</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-black text-emerald-700 italic">{userStats.points} <span className="text-[8px] uppercase not-italic opacity-50">pts</span></p>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex justify-between text-[8px] font-black text-emerald-800/40 uppercase tracking-widest">
                        <span>Progreso</span>
                        <span>{Math.min(100, (userStats.xp % 100))}%</span>
                    </div>
                    <Progress value={Math.min(100, (userStats.xp % 100))} className="h-1 bg-emerald-100" />
                </div>

                <div className="flex justify-between pt-2 border-t border-emerald-100/50">
                    <div className="flex items-center gap-1">
                        <Star size={10} className="text-amber-500" />
                        <span className="text-[9px] font-black text-slate-600">{userStats.level}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Zap size={10} className="text-emerald-500" />
                        <span className="text-[9px] font-black text-slate-600">{userStats.points}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <TrendingUp size={10} className="text-blue-500" />
                        <span className="text-[9px] font-black text-slate-600">{userStats.streak}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default SimpleGamificationWidget;
