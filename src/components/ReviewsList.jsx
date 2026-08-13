import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Loader2, Quote, MessageSquare, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const ReviewsList = ({ userId }) => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchReviews = async () => {
            if (!userId) return;
            try {
                // Usamos la versión V2 para evitar conflictos de sobrecarga
                const { data, error } = await supabase.rpc('get_user_reviews_v2', {
                    p_user_id: userId,
                    p_limit: 10,
                    p_offset: 0
                });

                if (error) throw error;

                setReviews(data?.reviews || []);
            } catch (error) {
                console.error("Error fetching reviews:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchReviews();
    }, [userId]);

    const reviewSummary = useMemo(() => {
        if (!reviews.length) return { average: '0.0', count: 0, trusted: false };
        const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
        const average = total / reviews.length;
        return {
            average: average.toFixed(1),
            count: reviews.length,
            trusted: average >= 4.5 && reviews.length >= 2,
        };
    }, [reviews]);

    const formatReviewDate = (date) => {
        const value = new Date(date);
        if (Number.isNaN(value.getTime())) return 'Fecha reciente';
        return format(value, 'd MMM yyyy', { locale: es });
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary opacity-20 mb-2" />
            <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.3em]">Cargando testimonios...</p>
        </div>
    );

    if (reviews.length === 0) return (
        <div className="flex flex-col items-center justify-center p-8 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 italic shadow-inner text-center">
            <div className="h-16 w-16 rounded-3xl bg-slate-50 flex items-center justify-center mb-4">
                <MessageSquare className="h-8 w-8 text-slate-200" />
            </div>
            <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Aún no tiene valoraciones</p>
            <p className="mt-2 max-w-xs text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-5">
                Las opiniones aparecerán aquí después de completar viajes. Ayudan a crear confianza antes de reservar.
            </p>
        </div>
    );

    return (
        <div className="space-y-4">
            <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="h-14 w-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center shadow-sm shrink-0">
                        <Star className="h-7 w-7 fill-current" />
                    </div>
                    <div className="text-left min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Resumen de confianza</p>
                        <h4 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 leading-none">
                            {reviewSummary.average}/5
                        </h4>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {reviewSummary.count} {reviewSummary.count === 1 ? 'valoración' : 'valoraciones'} visibles
                        </p>
                    </div>
                </div>
                <div className={cn(
                    'rounded-2xl px-3 py-2 text-center shrink-0 border',
                    reviewSummary.trusted ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-100 text-slate-400'
                )}>
                    <ShieldCheck className="h-5 w-5 mx-auto mb-1" />
                    <p className="text-[8px] font-black uppercase tracking-widest">
                        {reviewSummary.trusted ? 'Fuerte' : 'Nuevo'}
                    </p>
                </div>
            </section>

            {reviews.map((review, idx) => (
                <div
                    key={review.id}
                    className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 group"
                    style={{ animationDelay: `${idx * 100}ms` }}
                >
                    <div className="flex items-start gap-4">
                        <div className="relative">
                            <Avatar className="h-12 w-12 border-2 border-white shadow-lg transition-transform group-hover:scale-110">
                                <AvatarImage src={review.sender_photo} />
                                <AvatarFallback className="bg-primary/10 text-primary font-black text-sm italic">
                                    {review.sender_name?.[0] || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 bg-amber-400 rounded-full p-1 border-2 border-white shadow-sm">
                                <Star className="h-2 w-2 text-white fill-current" />
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center mb-1">
                                <p className="text-sm font-black text-slate-900 uppercase tracking-tighter italic leading-none">
                                    {review.sender_name || 'Miembro Elite'}
                                </p>
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-lg">
                                    {formatReviewDate(review.created_at)}
                                </span>
                            </div>

                            <div className="flex items-center gap-0.5 mb-3">
                                {[...Array(5)].map((_, i) => (
                                    <Star
                                        key={i}
                                        className={cn(
                                            "h-3 w-3 transition-all",
                                            i < review.rating ? "fill-amber-400 text-amber-400" : "text-slate-100"
                                        )}
                                    />
                                ))}
                            </div>

                            {review.comment ? (
                                <div className="relative mt-2">
                                    <Quote className="absolute -left-2 -top-2 h-4 w-4 text-primary/5 -scale-x-100" />
                                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed italic pl-4 border-l-2 border-primary/20 bg-slate-50/50 py-2 rounded-r-xl">
                                        "{review.comment}"
                                    </p>
                                </div>
                            ) : (
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic">Valoró positivamente el viaje</p>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            <div className="pt-4 text-center">
                <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em]">Mostrando {reviews.length} testimonios</p>
            </div>
        </div>
    );
};

export default ReviewsList;
