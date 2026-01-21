import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Componentes ---
import SubPageHeader from './SubPageHeader';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import {
    Loader2, BadgeCheck, AlertTriangle, User, Calendar,
    MapPin, Milestone, Wallet, Clock, Star, ArrowRight,
    Map as MapIcon, ChevronRight, Share2, Info, Leaf, Sparkles
} from 'lucide-react';

const PastRideDetails = () => {
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!rideId) {
            navigate('/');
            return;
        }

        const fetchPastRide = async () => {
            const { data, error } = await supabase
                .from('rides')
                .select(`*, driver:profiles!driver_id (id, full_name, avatar_url, rating)`)
                .eq('id', rideId)
                .single();

            if (data) {
                setRide(data);
            } else {
                toast.error("Este viaje no existe o ya no está disponible.");
                navigate('/my-rides');
            }
            setLoading(false);
        };

        fetchPastRide();
    }, [rideId, navigate]);

    if (loading) return (
        <div className="h-screen flex flex-col items-center justify-center bg-slate-50 space-y-4">
             <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="font-semibold text-slate-500">Recuperando memoria del viaje...</p>
        </div>
    );

    if (!ride) return <div className="h-screen flex items-center justify-center text-muted-foreground p-8">No se encontró el viaje.</div>;

    const formattedDate = format(new Date(ride.departure_time), "eeee, d 'de' MMMM", { locale: es });
    const formattedTime = format(new Date(ride.departure_time), "HH:mm", { locale: es });

    return (
        <div className="bg-slate-50 min-h-screen pb-40">
            <SubPageHeader title="Memoria de Viaje" />

            <main className="max-w-xl mx-auto px-4 -mt-12 relative z-10 space-y-8">

                <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white/60 backdrop-blur-xl p-8 text-center relative">
                    <div className={cn("h-20 w-20 rounded-2xl mx-auto flex items-center justify-center shadow-lg mb-4", ride.status === 'completed' ? "bg-green-500" : "bg-red-500")}>
                        {ride.status === 'completed' ? <BadgeCheck className="h-10 w-10 text-white" /> : <AlertTriangle className="h-10 w-10 text-white" />}
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800">Viaje {ride.status === 'completed' ? 'Completado' : 'Cancelado'}</h2>
                    <p className="text-sm text-slate-500">{formattedDate} a las {formattedTime}h</p>
                </Card>

                {ride.status === 'completed' && ride.co2_saved > 0 && (
                    <Card className="rounded-[2.5rem] border-none bg-gradient-to-br from-teal-500 to-green-600 text-white shadow-2xl shadow-green-200 overflow-hidden animate-in fade-in zoom-in-95 duration-700">
                        <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-4">
                            <div className="h-20 w-20 bg-white/20 rounded-2xl flex items-center justify-center border-2 border-white/30 backdrop-blur-lg animate-pulse">
                                <Leaf className="h-10 w-10 text-white" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-bold text-4xl">{ride.co2_saved.toFixed(2)} kg</p>
                                <p className="font-semibold text-lg text-white/80">de CO₂ ahorrados</p>
                            </div>
                             <p className="text-xs text-white/70 mt-2">¡Gracias por hacer del planeta un lugar mejor!</p>
                        </CardContent>
                    </Card>
                )}

                {/* ... (resto del JSX) ... */}
            </main>
        </div>
    );
};

export default PastRideDetails;
