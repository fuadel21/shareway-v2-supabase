import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Loader2, Quote, MessageSquare } from 'lucide-react';
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

    if (loading) return (
        <div className="flex flex-col items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary opacity-20 mb-2" />
            <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.3em]">Cargando testimonios...</p>
        </div>
    );

    if (reviews.length === 0) return (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border-2 border-dashed border-slate-100 italic shadow-inner">
            <MessageSquare className="h-10 w-10 text-slate-100 mb-3" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                Aún no tiene valoraciones.<br/>¡Sé el primero en viajar con este usuario!
            </p>
        </div>
    );

    return (
        <div className="space-y-4">
            {reviews.map((review, idx) => (
                <div
                    key={review.id}
                    className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 group"
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
                                    {format(new Date(review.created_at), "d MMM yyyy", { locale: es })}
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
