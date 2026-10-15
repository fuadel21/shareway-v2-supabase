/**
 * LeaveReview Component - Mejorado con Sistema de Rating Completo
 * Interfaz para valorar usuarios con validaciones y feedback visual
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Loader2, Star, MessageSquare, Send, Sparkles, UserCheck, ArrowLeft, ShieldCheck, Trophy, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { submitReviewSecure, canReviewUser, getUserRating, getUserBadges } from '../services/ratingService.js';
import SubPageHeader from './SubPageHeader';

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

const StarRating = ({ rating, setRating, disabled = false }) => (
    <div className="flex items-center gap-3">
        {[1, 2, 3, 4, 5].map((star) => (
            <button
                key={star}
                type="button"
                className={`focus:outline-none transition-all hover:scale-125 active:scale-90 ${disabled ? 'cursor-not-allowed' : ''}`}
                onClick={() => !disabled && setRating(star)}
                disabled={disabled}
            >
                <Star
                    className={`h-10 w-10 transition-all duration-300 ${
                        rating >= star 
                            ? 'text-yellow-400 fill-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.3)]' 
                            : 'text-gray-200 hover:text-gray-300'
                    }`}
                />
            </button>
        ))}
    </div>
);

const RatingDistribution = ({ stats }) => {
    const distribution = stats.rating_distribution || {};
    const total = stats.total_reviews || 0;

    return (
        <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
                const count = distribution[star] || 0;
                const percentage = total > 0 ? (count / total) * 100 : 0;
                
                return (
                    <div key={star} className="flex items-center gap-3">
                        <div className="flex items-center gap-1 w-12">
                            <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                            <span className="text-sm font-medium">{star}</span>
                        </div>
                        <Progress value={percentage} className="flex-1" />
                        <span className="text-sm text-muted-foreground w-12 text-right">
                            {count}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

const ReputationBadge = ({ badge }) => {
    const badgeConfig = {
        new_driver: { icon: '🚗', label: 'Nuevo Conductor', color: 'bg-blue-500' },
        experienced_driver: { icon: '🏆', label: 'Conductor Exp.', color: 'bg-purple-500' },
        top_driver: { icon: '⭐', label: 'Top Conductor', color: 'bg-yellow-500' },
        five_star_driver: { icon: '💎', label: '5 Estrellas', color: 'bg-emerald-500' },
        eco_warrior: { icon: '🌱', label: 'Eco Warrior', color: 'bg-green-500' },
        community_hero: { icon: '🦸', label: 'Héroe Comunitario', color: 'bg-red-500' }
    };

    const config = badgeConfig[badge.badge_type] || { icon: '🏅', label: badge.badge_type, color: 'bg-gray-500' };

    return (
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs font-medium ${config.color}`}>
            <span>{config.icon}</span>
            <span>{config.label}</span>
            {badge.badge_level > 1 && <span className="ml-1">Lv.{badge.badge_level}</span>}
        </div>
    );
};

const LeaveReview = () => {
    const { rideId, revieweeId } = useParams();
    const navigate = useNavigate();
    const { profile: currentUserProfile, user, refreshProfile } = useOutletContext();

    const [reviewee, setReviewee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [canReview, setCanReview] = useState(null);
    const [reviewCheckLoading, setReviewCheckLoading] = useState(true);

    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [characterCount, setCharacterCount] = useState(0);

    // Cargar datos del reviewee
    useEffect(() => {
        const fetchReviewee = async () => {
            if (!revieweeId) return;
            
            try {
                // Obtener perfil básico
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('id, display_name, photo_url, avatar_url')
                    .eq('id', revieweeId)
                    .single();

                if (profileError) throw profileError;

                // Obtener rating y badges
                const [ratingData, badges] = await Promise.all([
                    getUserRating(revieweeId),
                    getUserBadges(revieweeId)
                ]);

                setReviewee({
                    ...profile,
                    rating: ratingData,
                    badges: badges
                });
            } catch (error) {
                console.error('Error fetching reviewee:', error);
                toast.error('Error al cargar datos del usuario');
            } finally {
                setLoading(false);
            }
        };

        fetchReviewee();
    }, [revieweeId]);

    // Verificar si puede valorar
    useEffect(() => {
        const checkCanReview = async () => {
            if (!rideId || !revieweeId || !user?.id) return;

            try {
                setReviewCheckLoading(true);
                const result = await canReviewUser(rideId, revieweeId);
                setCanReview(result);
            } catch (error) {
                console.error('Error checking can review:', error);
                setCanReview({ canReview: false, reason: 'Error al verificar permisos' });
            } finally {
                setReviewCheckLoading(false);
            }
        };

        checkCanReview();
    }, [rideId, revieweeId, user?.id]);

    // Manejar cambio de comentario
    const handleCommentChange = (e) => {
        const text = e.target.value;
        if (text.length <= 500) {
            setComment(text);
            setCharacterCount(text.length);
        }
    };

    // Enviar review
    const handleSubmitReview = async () => {
        if (rating === 0) {
            return toast.warning("Selecciona una puntuación.");
        }
        
        if (!user?.id) {
            return toast.error("Sesión no válida.");
        }

        if (!canReview?.canReview) {
            return toast.error(canReview?.reason || "No puedes valorar a este usuario.");
        }

        setSubmitting(true);
        const toastId = toast.loading("Guardando valoración y otorgando EcoPoints...");
        
        try {
            await submitReviewSecure({
                rideId,
                revieweeId,
                rating: parseInt(rating),
                comment: comment.trim()
            });

            toast.success("¡Valoración guardada!", {
                id: toastId,
                icon: <Sparkles className="h-5 w-5 text-yellow-500" />,
                description: "Has ganado 10 EcoPoints por tu feedback."
            });

            // Refrescar perfil para ver nuevos puntos y rating
            if (refreshProfile) await refreshProfile();
            
            navigate('/my-rides');
        } catch (error) {
            console.error("🛡️ [LeaveReview] submitReview failed:", error);
            toast.error("Error al publicar", { 
                id: toastId, 
                description: error.message || 'Intenta nuevamente' 
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading || reviewCheckLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Cargando información...
                </p>
            </div>
        );
    }

    if (!reviewee) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <p className="text-sm text-slate-600">Usuario no encontrado</p>
                <Button onClick={() => navigate(-1)}>Volver</Button>
            </div>
        );
    }

    if (!canReview?.canReview) {
        return (
            <div className="min-h-screen bg-slate-50 pb-32">
                <SubPageHeader title="Valorar Miembro" />
                
                <main className="max-w-2xl mx-auto px-4 py-8">
                    <Card className="rounded-3xl border-none shadow-2xl overflow-hidden">
                        <CardContent className="p-5 text-center">
                            <ShieldCheck className="h-16 w-16 text-amber-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold mb-2">No puedes valorar a este usuario</h3>
                            <p className="text-muted-foreground mb-6">{canReview?.reason}</p>
                            <Button onClick={() => navigate(-1)}>Volver</Button>
                        </CardContent>
                    </Card>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans">
            <SubPageHeader title="Valorar Miembro" />

            <main className="max-w-2xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Perfil del Reviewee */}
                <Card className="rounded-3xl border-none shadow-2xl overflow-hidden bg-white mb-6">
                    <CardHeader className="bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] pb-16 pt-12 text-center flex flex-col items-center relative">
                        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none overflow-hidden">
                            <Sparkles className="size-64 -translate-x-20 -translate-y-20 text-white" />
                        </div>
                        
                        <div className="relative mb-6 z-10">
                            <Avatar className="h-32 w-32 border-4 border-white shadow-2xl">
                                <AvatarImage src={reviewee.photo_url || reviewee.avatar_url} />
                                <AvatarFallback className="text-3xl font-black bg-slate-100 text-slate-900 uppercase italic">
                                    {getInitials(reviewee.display_name)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-2xl border-4 border-slate-900 shadow-lg">
                                <ShieldCheck className="h-5 w-5" />
                            </div>
                        </div>
                        
                        <div className="z-10 space-y-2">
                            <h2 className="text-3xl font-black tracking-tighter text-white uppercase italic leading-none px-4">
                                {reviewee.display_name}
                            </h2>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Protocolo de Confianza</p>
                        </div>
                    </CardHeader>

                    <CardContent className="p-5 -mt-8 bg-white rounded-t-[3rem] relative z-20">
                        {/* Rating Actual */}
                        {reviewee.rating && (
                            <div className="mb-6 p-4 bg-slate-50 rounded-2xl">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center">
                                            <Star className="h-5 w-5 text-yellow-400 fill-yellow-400" />
                                            <span className="text-2xl font-bold ml-2">
                                                {reviewee.rating.average_rating?.toFixed(1) || '0.0'}
                                            </span>
                                        </div>
                                        <span className="text-sm text-muted-foreground">
                                            ({reviewee.rating.total_reviews} valoraciones)
                                        </span>
                                    </div>
                                    <TrendingUp className="h-5 w-5 text-green-500" />
                                </div>
                                
                                {/* Badges */}
                                {reviewee.badges && reviewee.badges.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {reviewee.badges.slice(0, 3).map((badge) => (
                                            <ReputationBadge key={badge.id} badge={badge} />
                                        ))}
                                        {reviewee.badges.length > 3 && (
                                            <Badge variant="secondary">
                                                +{reviewee.badges.length - 3} más
                                            </Badge>
                                        )}
                                    </div>
                                )}
                                
                                {/* Distribución de rating */}
                                {reviewee.rating.total_reviews > 0 && (
                                    <div className="space-y-2">
                                        <p className="text-xs font-medium text-muted-foreground">Distribución de valoraciones</p>
                                        <RatingDistribution stats={reviewee.rating} />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Formulario de Valoración */}
                        <div className="space-y-10">
                            <div className="flex flex-col items-center space-y-4 pt-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Tu valoración</p>
                                <StarRating rating={rating} setRating={setRating} disabled={submitting} />
                                {rating > 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        {rating === 5 && '¡Excelente experiencia!'}
                                        {rating === 4 && 'Muy buena experiencia'}
                                        {rating === 3 && 'Experiencia regular'}
                                        {rating === 2 && 'Algunos problemas'}
                                        {rating === 1 && 'Mala experiencia'}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">
                                    <MessageSquare className="h-4 w-4 text-primary" />
                                    <span>Tu experiencia (opcional)</span>
                                </div>
                                <Textarea
                                    placeholder={`¿Cómo fue el viaje? (Máx. 500 caracteres)`}
                                    className="min-h-[150px] p-6 rounded-3xl border-none bg-slate-50 font-medium transition-all shadow-inner focus-visible:ring-primary"
                                    value={comment}
                                    onChange={handleCommentChange}
                                    disabled={submitting}
                                    maxLength={500}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Comparte detalles específicos de tu experiencia</span>
                                    <span>{characterCount}/500</span>
                                </div>
                            </div>

                            <div className="pt-4 flex flex-col gap-4">
                                <Button
                                    size="lg"
                                    onClick={handleSubmitReview}
                                    disabled={submitting || rating === 0}
                                    className="w-full h-14 rounded-3xl text-xl font-black uppercase italic tracking-tighter shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all bg-slate-900 text-white"
                                >
                                    {submitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                            Publicando valoración...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="mr-2 h-5 w-5" />
                                            Publicar Valoración
                                        </>
                                    )}
                                </Button>
                                
                                <Button
                                    variant="ghost"
                                    onClick={() => navigate(-1)}
                                    className="w-full h-12 rounded-3xl"
                                    disabled={submitting}
                                >
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
};

export default LeaveReview;
