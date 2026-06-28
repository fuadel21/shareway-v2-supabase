import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import { Star, Loader2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { toast } from 'sonner';
import { cn } from '../lib/utils.js';
import { createNotification, NOTIFICATION_TYPES } from '../services/notificationService.js';

const RideRatingModal = ({ isOpen, onClose, rideId, driverId, driverName, onSuccess }) => {
    const [rating, setRating] = useState(0);
    const [hover, setHover] = useState(0);
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const notifyDriver = async () => {
        try {
            const { data: authData } = await supabase.auth.getUser();
            const currentUser = authData?.user;

            if (!driverId || !currentUser?.id || String(driverId) === String(currentUser.id)) return;

            await createNotification({
                userId: driverId,
                actorId: currentUser.id,
                type: NOTIFICATION_TYPES.REVIEW,
                title: 'Nueva valoración recibida',
                message: `Has recibido una valoración de ${rating} estrellas${comment ? `: ${comment.slice(0, 120)}` : '.'}`,
                actionUrl: `/ride/${rideId}`,
                entityType: 'ride',
                entityId: rideId,
                priority: 'normal',
                metadata: {
                    ride_id: rideId,
                    rating,
                    has_comment: Boolean(comment?.trim()),
                },
            });
        } catch (error) {
            console.warn('Review notification failed:', error.message);
        }
    };

    const handleSubmit = async () => {
        if (rating === 0) {
            toast.error("Por favor, selecciona una puntuación");
            return;
        }

        setIsSubmitting(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('rate_ride', {
                p_ride_id: rideId,
                p_rating: rating,
                p_comment: comment
            });

            if (rpcError) throw rpcError;

            // Manejar respuesta del RPC
            const result = Array.isArray(data) ? data[0] : data;

            if (result?.success) {
                await notifyDriver();
                toast.success("¡Gracias por tu valoración!");
                // Pasamos los pasajeros actualizados al componente padre para consistencia inmediata
                if (onSuccess) onSuccess(result.passengers);
                onClose();
            } else {
                throw new Error(result?.error || "No se pudo guardar la valoración");
            }
        } catch (error) {
            console.error("Error detallado en rate_ride:", error);
            toast.error("Error: " + (error.message || "Fallo en el servidor"));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[400px] rounded-[2.5rem] border-none shadow-2xl p-8 bg-white overflow-hidden outline-none">
                <DialogHeader className="text-center space-y-2">
                    <div className="size-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-2 border-2 border-amber-100">
                        <Star className="h-8 w-8 text-amber-500 fill-amber-500" />
                    </div>
                    <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900">
                        ¿Qué tal el viaje?
                    </DialogTitle>
                    <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Califica tu experiencia con {driverName || 'el conductor'}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-6 space-y-8">
                    {/* Estrellas */}
                    <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                type="button"
                                className="transition-transform active:scale-90"
                                onClick={() => setRating(star)}
                                onMouseEnter={() => setHover(star)}
                                onMouseLeave={() => setHover(0)}
                            >
                                <Star
                                    size={40}
                                    className={cn(
                                        "transition-all duration-200",
                                        (hover || rating) >= star
                                            ? "text-amber-500 fill-amber-500 scale-110"
                                            : "text-slate-200 fill-slate-200"
                                    )}
                                />
                            </button>
                        ))}
                    </div>

                    {/* Comentario */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-4">Tu opinión (opcional)</label>
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Escribe algo sobre el viaje..."
                            className="w-full min-h-[100px] p-4 rounded-3xl bg-slate-50 border-2 border-transparent focus:border-primary/20 focus:bg-white outline-none transition-all text-sm font-medium resize-none"
                        />
                    </div>

                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || rating === 0}
                        className="w-full h-16 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl shadow-slate-200 disabled:opacity-50"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <span className="flex items-center gap-2">Enviar Valoración <Send size={16} /></span>}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default RideRatingModal;
