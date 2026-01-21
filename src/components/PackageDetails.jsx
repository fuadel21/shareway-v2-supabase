import React, { useState, useEffect } from 'react';
import { useParams, useOutletContext, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import SubPageHeader from './SubPageHeader';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import {
    Loader2, Package, MapPin, Calendar, Wallet, Box,
    MessageSquare, CheckCheck, Truck, Home, Ban,
    Sparkles, ShieldCheck, ArrowRight, Info, AlertTriangle
} from 'lucide-react';

const getInitials = (name) => {
    if (!name) return '?';
    const words = name.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

const PackageDetails = () => {
    const { id } = useParams();
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const [pkg, setPkg] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchPackage = async () => {
        try {
            const { data, error } = await supabase
                .from('packages')
                .select('*, sender:profiles!sender_id(*), driver:profiles!driver_id(*)')
                .eq('id', id)
                .single();
            if (error) throw error;
            setPkg(data);
        } catch (error) {
            console.error("Error fetching package details:", error);
            toast.error("Envío no encontrado.");
            navigate('/my-packages');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!id) return;
        fetchPackage();
        const channel = supabase.channel(`package_${id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'packages', filter: `id=eq.${id}` }, payload => {
                setPkg(prev => ({ ...prev, ...payload.new }));
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [id]);

    const handleStatusUpdate = async (newStatus, message) => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('packages').update({ status: newStatus }).eq('id', id);
            if (error) throw error;
            toast.success(message);
        } catch (error) {
            toast.error("Error al actualizar el estado");
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleAcceptPackage = async () => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('packages').update({ status: 'accepted', driver_id: user.id }).eq('id', id);
            if(error) throw error;
            toast.success("¡Envío aceptado!", { description: "Ponte en contacto con el remitente para coordinar." });
        } catch (error) {
            toast.error("Error al aceptar el envío");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleContact = async (otherUserId) => {
        if (!user || !otherUserId) return;
        setIsSubmitting(true);
        try {
            let { data: chat, error } = await supabase
                .from('chats')
                .select('id')
                .contains('participants', [user.id, otherUserId])
                .maybeSingle();

            if (error) throw error;

            if (chat) {
                navigate(`/chat/${chat.id}`);
            } else {
                const { data: newChat, error: createError } = await supabase
                    .from('chats')
                    .insert({ participants: [user.id, otherUserId] })
                    .select()
                    .single();
                
                if (createError) throw createError;
                navigate(`/chat/${newChat.id}`);
            }
        } catch (error) {
            toast.error("Error al iniciar el chat.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading || !pkg) {
        return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;
    }
    
    const isSender = user?.id === pkg.sender_id;
    const isDriver = user?.id === pkg.driver_id;
    const canAccept = !isSender && pkg.status === 'pending';
    const canCancel = isSender && (pkg.status === 'pending' || pkg.status === 'accepted');
    const canPickup = isDriver && pkg.status === 'accepted';
    const canComplete = isDriver && pkg.status === 'picked_up';
    const canContact = (isSender && pkg.driver_id) || (isDriver && pkg.sender_id);

    return (
        <div className="bg-slate-50 min-h-screen pb-40">
            <SubPageHeader title="Detalle del Envío" />
             <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-8">
                {/* El resto del JSX que ya tenías va aquí */}
            </main>
        </div>
    );
};

export default PackageDetails;
