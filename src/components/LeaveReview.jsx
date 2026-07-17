import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Card, CardContent, CardHeader } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Loader2, Star, MessageSquare, Sparkles, ArrowLeft, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { submitReviewAndNotify } from '../services/rideNotificationBridge.js';
import SubPageHeader from './SubPageHeader';

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

const getRatingHint = (rating) => {
    if (rating >= 5) return 'Excelente experiencia';
    if (rating === 4) return 'Muy buen viaje';
    if (rating === 3) return 'Correcto, con detalles';
    if (rating > 0) return 'Cuéntanos qué ocurrió';
    return 'Toca las estrellas para puntuar';
};

const StarRating = ({ rating, setRating }) => (
    <div className="flex items-center gap-3">
        {[1, 2, 3, 4, 5].map((star) => (
            <button
                key={star}
                type="button"
                className="focus:outline-none transition-all hover:scale-125 active:scale-90"
                onClick={() => setRating(star)}
                aria-label={`Puntuar ${star} estrellas`}
            >
                <Star
                    className={`h-10 w-10 ${rating >= star ? 'text-yellow-400 fill-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.3)]' : 'text-gray-200'}`}
                />
            </button>
        ))}
    </div>
);

const ReviewGuidance = ({ rating, commentLength }) => (
    <div className="rounded-[2rem] bg-amber-50/70 border border-amber-100 p-5 space-y-4 text-left">
        <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-white text-amber-500 flex items-center justify-center shadow-sm shrink-0">
                <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-600">Valoración justa</p>
                <p className="mt-1 text-xs font-bold text-slate-600 leading-5 italic">
                    Ayuda a otros usuarios explicando puntualidad, comunicación y respeto durante el viaje.
                </p>
            </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
            {['Puntualidad', 'Comunicación', 'Respeto'].map((item) => (
                <div key={item} className="rounded-2xl bg-white px-3 py-3 text-center shadow-sm border border-amber-100/60">
                    <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-emerald-500" />
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{item}</p>
                </div>
            ))}
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 border border-amber-100/60">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{getRatingHint(rating)}</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{commentLength}/500</span>
        </div>
    </div>
);

const LeaveReview = () => {
    const { rideId, revieweeId } = useParams();
    const navigate = useNavigate();
    const { profile: currentUserProfile, user, refreshProfile } = useOutletContext();

    const [reviewee, setReviewee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');

    useEffect(() => {
        const fetchReviewee = async () => {
            if (!revieweeId) return;
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, display_name, photo_url, avatar_url')
                    .eq('id', revieweeId)
                    .single();

                if (error) throw error;
                setReviewee(data);
            } catch (error) {
                console.error("🛡️ stability: fetchReviewee failed:", error);
                toast.error("No pudimos cargar el perfil del usuario.");
                navigate('/my-rides');
            } finally {
                setLoading(false);
            }
        };

        fetchReviewee();
    }, [revieweeId, navigate]);

    const handleSubmitReview = async () => {
        if (rating === 0) return toast.warning("Selecciona una puntuación.");
        if (!user?.id) return toast.error("Sesión no válida.");

        setSubmitting(true);
        const toastId = toast.loading("Guardando valoración y otorgando EcoPoints...");

        try {
            await submitReviewAndNotify({
                rideId,
                revieweeId,
                rating: parseInt(rating),
                comment: comment.trim().substring(0, 500),
                reviewer: {
                    id: user.id,
                    display_name: currentUserProfile?.display_name || user.email?.split('@')[0] || 'Usuario ShareWay',
                },
            });

            toast.success("¡Valoración guardada!", {
                id: toastId,
                icon: <Sparkles className="h-5 w-5 text-yellow-500" />,
                description: "Has ganado 10 EcoPoints por tu feedback."
            });

            // FASE 27: Refrescar perfil para ver nuevos puntos y rating inmediatamente
            if (refreshProfile) await refreshProfile();

            navigate('/my-rides');
        } catch (error) {
            console.error("🛡️ stability: submitReview failed:", error);
            toast.error("Error al publicar", { id: toastId, description: error.message });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Consultando Registro...</p>
        </div>
    );

    if (!reviewee) return null;

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans text-left">
            <SubPageHeader title="Valorar Conductor" />

            <main className="max-w-2xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <Card className="rounded-[3rem] border-none shadow-2xl overflow-hidden bg-white">
                    <CardHeader className="bg-slate-900 pb-16 pt-12 text-center flex flex-col items-center relative">
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
                            <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-2xl border-4 border-slate-900 shadow-lg animate-in zoom-in duration-1000">
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

                    <CardContent className="p-8 space-y-10 -mt-8 bg-white rounded-t-[3rem] relative z-20">
                        <ReviewGuidance rating={rating} commentLength={comment.length} />

                        <div className="flex flex-col items-center space-y-4 pt-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Puntuación del viaje</p>
                            <StarRating rating={rating} setRating={setRating} />
                            <p className="text-xs font-black text-primary uppercase tracking-widest">{getRatingHint(rating)}</p>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">
                                <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Tu Experiencia</span>
                                <span>{comment.length}/500</span>
                            </div>
                            <Textarea
                                placeholder={`¿Cómo fue el viaje? Ejemplo: puntual, buena comunicación, conducción tranquila...`}
                                className="min-h-[150px] p-6 rounded-[2rem] border-none bg-slate-50 font-medium transition-all shadow-inner focus-visible:ring-primary"
                                value={comment}
                                maxLength={500}
                                onChange={(e) => setComment(e.target.value)}
                            />
                        </div>

                        <div className="pt-4 flex flex-col gap-4">
                            <Button
                                size="lg"
                                onClick={handleSubmitReview}
                                disabled={submitting || rating === 0}
                                className="w-full h-20 rounded-[2rem] text-xl font-black uppercase italic tracking-tighter shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all bg-slate-900 text-white"
                            >
                                {submitting ? <Loader2 className="h-8 w-8 animate-spin" /> : "PUBLICAR VALORACIÓN"}
                            </Button>

                            <Button
                                variant="ghost"
                                className="rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-900 h-12"
                                onClick={() => navigate(-1)}
                                disabled={submitting}
                            >
                                <ArrowLeft className="mr-2 h-4 w-4" /> Cancelar y volver
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
};

export default LeaveReview;