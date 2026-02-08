/**
 * Gamification Dashboard Component - Panel de Gamificación
 * Interfaz completa para mostrar puntos, niveles, desafíos y logros
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Star, Zap, Target, Flame, TrendingUp, Award, Gift, Calendar, Users, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Separator } from '@/components/ui/separator.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { toast } from 'sonner';
import {
    getUserGamificationStats,
    getEcoPointsBalance,
    getUserChallenges,
    getGamificationLeaderboard,
    getAvailableRewards,
    subscribeToGamificationUpdates,
    unsubscribeFromGamificationUpdates,
    awardDailyLogin
} from '../services/gamificationService.js';

const getLevelIcon = (level) => {
    const icons = {
        1: '🌱',
        2: '🍃',
        3: '🌿',
        4: '🌳',
        5: '🌲',
        6: '🏆',
        7: '💎',
        8: '👑',
        9: '🌍',
        10: '✨'
    };
    return icons[level] || '🌱';
};

const getLevelColor = (level) => {
    const colors = {
        1: 'bg-green-500',
        2: 'bg-green-600',
        3: 'bg-emerald-500',
        4: 'bg-emerald-600',
        5: 'bg-teal-500',
        6: 'bg-teal-600',
        7: 'bg-cyan-500',
        8: 'bg-cyan-600',
        9: 'bg-sky-500',
        10: 'bg-blue-600'
    };
    return colors[level] || 'bg-green-500';
};

const getDifficultyColor = (difficulty) => {
    const colors = {
        easy: 'bg-green-100 text-green-800',
        medium: 'bg-yellow-100 text-yellow-800',
        hard: 'bg-orange-100 text-orange-800',
        legendary: 'bg-purple-100 text-purple-800'
    };
    return colors[difficulty] || 'bg-gray-100 text-gray-800';
};

const ChallengeCard = ({ challenge, onUpdate }) => {
    const progress = challenge.progress_percentage || 0;
    const isCompleted = challenge.is_completed;
    
    return (
        <Card className={`transition-all hover:shadow-md ${isCompleted ? 'bg-green-50 border-green-200' : ''}`}>
            <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-sm">{challenge.name}</h4>
                            <Badge className={getDifficultyColor(challenge.difficulty)}>
                                {challenge.difficulty}
                            </Badge>
                            {challenge.reward_badge && (
                                <Badge variant="outline" className="text-xs">
                                    🏆 {challenge.reward_badge}
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                            {challenge.description}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="flex items-center gap-1 text-sm font-medium">
                            <Zap className="h-4 w-4 text-amber-500" />
                            {challenge.reward_points}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            puntos
                        </div>
                    </div>
                </div>
                
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span>Progreso</span>
                        <span className="font-medium">
                            {challenge.current_progress}/{challenge.requirement_value}
                        </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {isCompleted && (
                        <div className="flex items-center gap-2 text-green-600 text-xs">
                            <Trophy className="h-3 w-3" />
                            <span>¡Completado!</span>
                        </div>
                    )}
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>{challenge.type}</span>
                    {challenge.metadata?.icon && (
                        <span className="ml-auto">{challenge.metadata.icon}</span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const StatsCard = ({ icon: Icon, title, value, subtitle, color = 'text-blue-600' }) => (
    <Card className="border-none shadow-sm">
        <CardContent className="p-4">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-slate-100 ${color}`}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-2xl font-bold">{value}</p>
                    {subtitle && (
                        <p className="text-xs text-muted-foreground">{subtitle}</p>
                    )}
                </div>
            </div>
        </CardContent>
    </Card>
);

const LeaderboardItem = ({ entry, rank, type }) => {
    const getRankIcon = (rank) => {
        if (rank === 1) return '🥇';
        if (rank === 2) return '🥈';
        if (rank === 3) return '🥉';
        return `#${rank}`;
    };
    
    return (
        <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors">
            <div className="w-8 text-center font-bold text-lg">
                {getRankIcon(rank)}
            </div>
            <Avatar className="h-8 w-8">
                <AvatarImage src={entry.photo_url} />
                <AvatarFallback className="text-xs">
                    {entry.display_name?.split(' ').map(n => n[0]).join('').toUpperCase()}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <p className="font-medium text-sm">{entry.display_name}</p>
                {type === 'points' && (
                    <p className="text-xs text-muted-foreground">
                        {entry.available_points} puntos • Nivel {entry.level}
                    </p>
                )}
                {type === 'level' && (
                    <p className="text-xs text-muted-foreground">
                        Nivel {entry.current_level} • {entry.total_xp} XP
                    </p>
                )}
                {type === 'streak' && (
                    <p className="text-xs text-muted-foreground">
                        {entry.current_streak} días • Máx: {entry.longest_streak}
                    </p>
                )}
            </div>
        </div>
    );
};

const RewardCard = ({ reward, onRedeem, userPoints }) => {
    const canAfford = userPoints >= reward.cost_points;
    const isAvailable = reward.availability === -1 || reward.availability > 0;
    
    return (
        <Card className={`transition-all hover:shadow-md ${!canAfford || !isAvailable ? 'opacity-50' : ''}`}>
            <CardContent className="p-4">
                <div className="flex items-start gap-3">
                    {reward.image_url ? (
                        <img src={reward.image_url} alt={reward.name} className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold">
                            {reward.type === 'discount' && '%'}
                            {reward.type === 'free_ride' && '🚗'}
                            {reward.type === 'merchandise' && '👕'}
                            {reward.type === 'donation' && '🌱'}
                            {reward.type === 'badge' && '🏆'}
                            {reward.type === 'feature' && '⭐'}
                        </div>
                    )}
                    
                    <div className="flex-1">
                        <h4 className="font-semibold text-sm">{reward.name}</h4>
                        <p className="text-xs text-muted-foreground mb-2">
                            {reward.description}
                        </p>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                <Zap className="h-3 w-3 text-amber-500" />
                                <span className="text-sm font-medium">{reward.cost_points}</span>
                                <span className="text-xs text-muted-foreground">puntos</span>
                            </div>
                            {reward.availability > 0 && (
                                <Badge variant="outline" className="text-xs">
                                    {reward.availability} disponibles
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                
                <Button
                    size="sm"
                    className="w-full mt-3"
                    disabled={!canAfford || !isAvailable}
                    onClick={() => onRedeem(reward)}
                >
                    {canAfford ? 'Canjear' : 'Puntos insuficientes'}
                </Button>
            </CardContent>
        </Card>
    );
};

const GamificationDashboard = ({ userId }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const [stats, setStats] = useState(null);
    const [pointsBalance, setPointsBalance] = useState(null);
    const [challenges, setChallenges] = useState([]);
    const [leaderboard, setLeaderboard] = useState([]);
    const [rewards, setRewards] = useState([]);
    const [leaderboardType, setLeaderboardType] = useState('points');
    const [loading, setLoading] = useState(true);
    const [subscription, setSubscription] = useState(null);

    // Cargar datos iniciales
    const loadData = useCallback(async () => {
        if (!userId) {
            console.warn('🛡️ [Gamification Dashboard] No userId provided');
            setLoading(false);
            return;
        }
        
        setLoading(true);
        try {
            const [statsData, balanceData, challengesData, leaderboardData, rewardsData] = await Promise.all([
                getUserGamificationStats(userId),
                getEcoPointsBalance(userId),
                getUserChallenges(userId, false),
                getGamificationLeaderboard(leaderboardType, 10),
                getAvailableRewards()
            ]);
            
            setStats(statsData);
            setPointsBalance(balanceData);
            setChallenges(challengesData.challenges || []);
            setLeaderboard(leaderboardData.leaderboard || []);
            setRewards(rewardsData);
        } catch (error) {
            console.error('Error loading gamification data:', error);
            toast.error('Error al cargar datos de gamificación');
        } finally {
            setLoading(false);
        }
    }, [userId, leaderboardType]);

    // Recompensa diaria
    const claimDailyLogin = async () => {
        try {
            const result = await awardDailyLogin(userId);
            
            if (!result.alreadyAwarded) {
                toast.success('¡5 EcoPoints por tu login diario!');
                loadData(); // Recargar datos
            } else {
                toast.info('Ya recibiste tus puntos de hoy');
            }
        } catch (error) {
            console.error('Error claiming daily login:', error);
            toast.error('Error al reclamar puntos diarios');
        }
    };

    // Canjear recompensa
    const handleRedeemReward = async (reward) => {
        try {
            const { redeemReward } = await import('../services/gamificationService.js');
            const result = await redeemReward(userId, reward.id);
            
            toast.success(`¡Canjeaste "${reward.name}" con éxito!`);
            loadData(); // Recargar datos
        } catch (error) {
            console.error('Error redeeming reward:', error);
            toast.error(error.message || 'Error al canjear recompensa');
        }
    };

    // Suscripción a actualizaciones en tiempo real
    useEffect(() => {
        if (!userId) return;
        
        const channels = subscribeToGamificationUpdates(userId, (update) => {
            // Actualizar datos específicos según el tipo
            if (update.type === 'ecopoints') {
                getEcoPointsBalance(userId).then(setPointsBalance);
            } else if (update.type === 'level') {
                getUserGamificationStats(userId).then(setStats);
            } else if (update.type === 'challenge') {
                getUserChallenges(userId, false).then(data => setChallenges(data.challenges || []));
            } else if (update.type === 'streak') {
                getUserGamificationStats(userId).then(setStats);
            }
        });
        
        setSubscription(channels);
        
        return () => {
            unsubscribeFromGamificationUpdates(channels);
        };
    }, [userId]);

    // Cargar datos iniciales
    useEffect(() => {
        loadData();
    }, [loadData]);

    // Actualizar leaderboard cuando cambia el tipo
    useEffect(() => {
        if (userId) {
            getGamificationLeaderboard(leaderboardType, 10).then(data => {
                setLeaderboard(data.leaderboard || []);
            });
        }
    }, [userId, leaderboardType]);

    if (!userId) {
        return (
            <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>Inicia sesión para ver tu progreso</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-muted-foreground">Cargando gamificación...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header con puntos y nivel */}
            <Card className="border-none shadow-lg">
                <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`w-16 h-16 rounded-full ${getLevelColor(stats?.current_level || 1)} flex items-center justify-center text-white text-2xl font-bold`}>
                                {getLevelIcon(stats?.current_level || 1)}
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold">Nivel {stats?.current_level || 1}</h3>
                                <p className="text-muted-foreground">
                                    {stats?.current_xp || 0} / {stats?.total_xp || 0} XP
                                </p>
                            </div>
                        </div>
                        
                        <div className="text-right">
                            <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-6 w-6 text-amber-500" />
                                <span className="text-3xl font-bold">{pointsBalance?.available_points || 0}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">EcoPoints</p>
                            <Button size="sm" variant="outline" onClick={claimDailyLogin} className="mt-2">
                                <Gift className="h-3 w-3 mr-1" />
                                Diario
                            </Button>
                        </div>
                    </div>
                    
                    <Progress 
                        value={((stats?.current_xp || 0) / (stats?.total_xp || 1)) * 100} 
                        className="h-2 mt-4" 
                    />
                </CardContent>
            </Card>

            {/* Tabs de navegación */}
            <div className="flex gap-2">
                {['overview', 'challenges', 'leaderboard', 'rewards'].map((tab) => (
                    <Button
                        key={tab}
                        variant={activeTab === tab ? 'default' : 'ghost'}
                        onClick={() => setActiveTab(tab)}
                        className="capitalize"
                    >
                        {tab === 'overview' && '📊'}
                        {tab === 'challenges' && '🎯'}
                        {tab === 'leaderboard' && '🏆'}
                        {tab === 'rewards' && '🎁'}
                        {tab}
                    </Button>
                ))}
            </div>

            {/* Contenido según tab activa */}
            {activeTab === 'overview' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatsCard
                        icon={Trophy}
                        title="Viajes Completados"
                        value={stats?.total_rides || 0}
                        subtitle="Total de viajes"
                        color="text-blue-600"
                    />
                    <StatsCard
                        icon={Star}
                        title="Valoraciones"
                        value={`${stats?.total_reviews_given || 0}/${stats?.total_reviews_received || 0}`}
                        subtitle="Dadas/Recibidas"
                        color="text-purple-600"
                    />
                    <StatsCard
                        icon={Leaf}
                        title="CO₂ Ahorrado"
                        value={`${stats?.total_co2_saved || 0}kg`}
                        subtitle="Impacto ambiental"
                        color="text-green-600"
                    />
                    <StatsCard
                        icon={Flame}
                        title="Racha Actual"
                        value={`${stats?.current_streaks?.[0]?.current || 0} días`}
                        subtitle="Login consecutivo"
                        color="text-orange-600"
                    />
                </div>
            )}

            {activeTab === 'challenges' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Desafíos Activos</h3>
                        <Badge variant="outline">
                            {challenges.filter(c => !c.is_completed).length} activos
                        </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {challenges.map((challenge) => (
                            <ChallengeCard key={challenge.id} challenge={challenge} />
                        ))}
                    </div>
                    
                    {challenges.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Target className="h-12 w-12 mx-auto mb-2 opacity-20" />
                            <p>No hay desafíos activos</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'leaderboard' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Leaderboard</h3>
                        <div className="flex gap-2">
                            {['points', 'level', 'streak'].map((type) => (
                                <Button
                                    key={type}
                                    variant={leaderboardType === type ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setLeaderboardType(type)}
                                >
                                    {type === 'points' && '💰'}
                                    {type === 'level' && '📈'}
                                    {type === 'streak' && '🔥'}
                                    {type}
                                </Button>
                            ))}
                        </div>
                    </div>
                    
                    <Card>
                        <CardContent className="p-4">
                            <ScrollArea className="h-96">
                                <div className="space-y-2">
                                    {leaderboard.map((entry, index) => (
                                        <LeaderboardItem
                                            key={entry.user_id}
                                            entry={entry}
                                            rank={index + 1}
                                            type={leaderboardType}
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            )}

            {activeTab === 'rewards' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Recompensas Disponibles</h3>
                        <Badge variant="outline">
                            {rewards.length} disponibles
                        </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {rewards.map((reward) => (
                            <RewardCard
                                key={reward.id}
                                reward={reward}
                                onRedeem={handleRedeemReward}
                                userPoints={pointsBalance?.available_points || 0}
                            />
                        ))}
                    </div>
                    
                    {rewards.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Gift className="h-12 w-12 mx-auto mb-2 opacity-20" />
                            <p>No hay recompensas disponibles</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default GamificationDashboard;
