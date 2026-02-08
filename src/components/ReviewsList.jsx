import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Loader2, Quote } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (!name) return '?';
    const words = name.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

const ReviewsList = ({ userId }) => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchReviews = async () => {
            if (!userId) return;
            try {
                // Fetch reviews where target_id is the user
                const { data, error } = await supabase
                    .from('reviews')
                    .select(`
                        *,
                        author:profiles!author_id (
                            display_name,
                            photo_url,
                            avatar_url
                        )
                    `)
                    .eq('target_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (error) throw error;
                setReviews(data || []);
            } catch (error) {
                console.error("Error fetching reviews:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchReviews();
    }, [userId]);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary opacity-20" /></div>;

    if (reviews.length === 0) return (
        <div className="flex flex-col items-center justify-center p-12 bg-white/30 rounded-[2.5rem] border-2 border-dashed border-slate-100 italic">
            <Quote className="h-8 w-8 text-slate-200 mb-3" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sin testimonios todavía</p>
        </div>
    );

    return (
        <div className="space-y-4">
            {reviews.map((review, idx) => (
                <div
                    key={review.id}
                    className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm animate-in fade-in slide-in-from-bottom-4"
                    style={{ animationDelay: `${idx * 100}ms` }}
                >
                    <div className="flex items-start gap-4">
                        <Avatar className="h-10 w-10 border-2 border-white shadow-md">
                            <AvatarImage src={review.author?.photo_url || review.author?.avatar_url} />
                            <AvatarFallback className="bg-slate-900 text-white font-black text-xs italic">
                                {getInitials(review.author?.display_name)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center mb-1">
                                <p className="text-xs font-black text-slate-900 uppercase tracking-tight italic truncate">
                                    {review.author?.display_name || 'Miembro Elite'}
                                </p>
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                                    {format(new Date(review.created_at), "d MMM yyyy", { locale: es })}
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5 mb-3">
                                {[...Array(5)].map((_, i) => (
                                    <Star
                                        key={i}
                                        className={cn(
                                            "h-2.5 w-2.5 transition-all",
                                            i < review.rating ? "fill-amber-400 text-amber-400" : "text-slate-100"
                                        )}
                                    />
                                ))}
                            </div>
                            {review.comment && (
                                <div className="relative">
                                    <Quote className="absolute -left-2 -top-2 h-4 w-4 text-primary/10 -scale-x-100" />
                                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed italic pl-3 border-l-2 border-primary/20">
                                        {review.comment}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ReviewsList;
