import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { fulfillRequest } from '@/services/rideService';
import * as rpc from '@/lib/supabaseRPC';

// Componentes UI
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar.jsx';
import MapComponent from './MapComponent';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SubPageHeader from './SubPageHeader';

// Iconos
import {
    Calendar, Clock, Users, ArrowLeft, Loader2,
    Handshake, MessageSquare, Phone, XCircle,
    MapPin, Milestone, Wallet, BadgeCheck,
    ShieldCheck, Sparkles, Navigation, ChevronRight,
    Euro, Search, User, ShieldAlert, CheckCircle,
    Info, Star, AlertTriangle
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const RequestDetails = () => {
    const { id: requestId } = useParams();
    const navigate = useNavigate();
    const { profile: currentUserProfile, user } = useOutletContext();

    const [request, setRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showAcceptDialog, setShowAcceptDialog] = useState(false);
    const [price, setPrice] = useState('');

    const fetchRequestDetails = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select(`*, requester:profiles!requester_id (*)`)
                .eq('id', requestId)
                .single();

            if (error) throw error;

            const depDate = data.departure_time ? new Date(data.departure_time) : null;

            setRequest({
                ...data,
                dateTime: isValid(depDate) ? depDate : new Date(),
                seats: data.seats_needed || 1,
                requester: {
                    ...data.requester,
                    photoURL: data.requester?.photo_url || data.requester?.avatar_url,
                    displayName: data.requester?.display_name || data.requester?.full_name || 'Usuario'
                }
            });
            setPrice(String(data.suggested_price || ''));
        } catch (error) {
            console.error("🛡️ [RequestDetails] Load Error:", error);
            toast.error("No se pudo cargar la solicitud.");
            navigate('/dashboard');
        } finally {
            setLoading(false);
        }
    }, [requestId, navigate]);

    useEffect(() => {
        if (!requestId) return;
        fetchRequestDetails();
        const channel = supabase.channel(`request_details_${requestId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `id=eq.${requestId}` }, fetchRequestDetails)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [requestId, fetchRequestDetails]);

    const isExpired = useMemo(() => {
        if (!request?.dateTime) return false;
        return new Date(request.dateTime) < new Date();
    }, [request?.dateTime]);

    const handleConfirmAcceptance = async () => {
        const numericPrice = Number(price.toString().replace(',', '.'));
        if (isNaN(numericPrice) || numericPrice <= 0) return toast.error("Por favor, introduce un precio válido.");

        setIsSubmitting(true);
        const toastId = toast.loading("Aceptando solicitud...");
        try {
            await fulfillRequest(request, numericPrice);
            toast.success("¡Solicitud aceptada! Viaje creado y plaza reservada.", { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            toast.error("Error al aceptar solicitud", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
            setShowAcceptDialog(false);
        }
    };

    const handleCancelRequest = async () => {
        setIsSubmitting(true);
        const toastId = toast.loading("Cancelando solicitud...");
        try {
            const { error } = await supabase
                .from('ride_requests')
                .update({ status: 'cancelled' })
                .eq('id', requestId)
                .eq('requester_id', user.id);

            if (error) throw error;
            toast.success("Solicitud cancelada con éxito", { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            toast.error("Error al cancelar", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
    if (!request) return null;

    const isRequester = user?.id === request.requester_id;
    const formattedDate = request.dateTime ? format(request.dateTime, "eeee, d 'de' MMMM", { locale: es }) : '—';
    const formattedTime = request.dateTime ? format(request.dateTime, "HH:mm", { locale: es }) : '--:--';

    return (
        <div className="bg-[#FDFCFB] min-h-screen pb-40 text-left">
            <SubPageHeader title="Detalles de Solicitud" />

            <main className="max-w-5xl mx-auto px-4 mt-4 space-y-8 animate-in fade-in duration-700">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        {/* PERFIL */}
                        <section className="bg-white rounded-[3rem] p-8 shadow-2xl border border-slate-100 flex flex-col md:flex-row items-center gap-8">
                            <Avatar className="h-32 w-32 border-4 border-white shadow-2xl">
                                <AvatarImage src={request.requester.photoURL} />
                                <AvatarFallback className="bg-primary text-white text-4xl font-black">{request.requester.displayName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 text-center md:text-left">
                                <h2 className="text-4xl font-black tracking-tighter uppercase italic">{request.requester.displayName}</h2>
                                <div className="flex items-center justify-center md:justify-start gap-3 mt-2">
                                    <div className="flex gap-0.5">
                                        {[1,2,3,4,5].map(s => <Star key={s} size={14} className="fill-primary text-primary" />)}
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Verificado</span>
                                </div>
                                <div className="flex gap-2 mt-4 justify-center md:justify-start">
                                    <div className="px-4 py-2 bg-slate-900 text-white rounded-full text-[9px] font-black uppercase">Busca {request.seats_needed} Plaza</div>
                                    <div className="px-4 py-2 bg-amber-50 text-amber-800 border border-amber-100 rounded-full text-[9px] font-black uppercase">Presupuesto: {request.suggested_price}€</div>
                                </div>
                            </div>
                        </section>

                        {/* RUTA */}
                        <section className="bg-slate-900 rounded-[3.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
                            <div className="relative z-10 space-y-10">
                                <div className="flex gap-6">
                                    <div className="flex flex-col items-center">
                                        <div className="size-5 bg-primary rounded-full" />
                                        <div className="w-0.5 h-16 bg-white/10 my-2" />
                                        <div className="size-5 bg-emerald-500 rounded-full" />
                                    </div>
                                    <div className="space-y-10">
                                        <div><p className="text-[9px] font-black uppercase text-primary mb-1">Recogida</p><p className="text-xl font-bold">{request.origin?.name || request.origin?.address}</p></div>
                                        <div><p className="text-[9px] font-black uppercase text-emerald-400 mb-1">Destino</p><p className="text-xl font-bold">{request.destination?.name || request.destination?.address}</p></div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-white/10">
                                    <div><p className="text-[9px] font-black text-white/40 uppercase mb-1">Fecha</p><div className="flex items-center gap-2"><Calendar size={16} className="text-primary"/><span className="font-bold">{formattedDate}</span></div></div>
                                    <div><p className="text-[9px] font-black text-white/40 uppercase mb-1">Hora</p><div className="flex items-center gap-2"><Clock size={16} className="text-primary"/><span className="font-bold">{formattedTime}</span></div></div>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* GESTIÓN */}
                    <div className="space-y-6">
                        <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white p-8 overflow-hidden">
                            <CardContent className="p-0 space-y-6">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 text-center">Estado: {request.status.toUpperCase()}</h3>
                                
                                {isRequester ? (
                                    <div className="space-y-4">
                                        {request.status === 'pending' && (
                                            <>
                                                <div className="p-6 bg-blue-50 text-blue-600 rounded-3xl border border-blue-100 text-center">
                                                    <Sparkles className="mx-auto mb-2 h-5 w-5" />
                                                    <p className="text-[10px] font-black uppercase">Buscando conductor</p>
                                                </div>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" className="w-full h-16 rounded-2xl text-red-500 hover:bg-red-50 font-black uppercase text-[10px]">
                                                            <XCircle className="mr-2 h-4 w-4" /> CANCELAR SOLICITUD
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent className="rounded-[2.5rem]">
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Retirar solicitud?</AlertDialogTitle>
                                                            <AlertDialogDescription>Esta acción eliminará tu petición del mapa y otros conductores no podrán verla.</AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel className="rounded-xl">VOLVER</AlertDialogCancel>
                                                            <AlertDialogAction onClick={handleCancelRequest} className="bg-red-600 rounded-xl">CONFIRMAR</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </>
                                        )}
                                        {request.status === 'cancelled' && (
                                            <div className="p-6 bg-slate-100 text-slate-400 rounded-3xl text-center">
                                                <XCircle className="mx-auto mb-2 h-5 w-5" />
                                                <p className="text-[10px] font-black uppercase">Solicitud Retirada</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {request.status === 'pending' && !isExpired ? (
                                            <Button 
                                                onClick={() => setShowAcceptDialog(true)}
                                                className="w-full h-20 bg-primary hover:bg-primary/90 text-white rounded-[2rem] shadow-xl flex flex-col gap-1 border-none transition-transform active:scale-95"
                                            >
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Aceptar Solicitud</span>
                                                <span className="text-[9px] font-bold opacity-80">Crear viaje y reservar plaza</span>
                                            </Button>
                                        ) : (
                                            <div className="p-6 bg-slate-50 text-slate-400 rounded-3xl border border-dashed text-center">
                                                <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
                                                <p className="text-[10px] font-black uppercase">{isExpired ? 'Solicitud Caducada' : 'No disponible'}</p>
                                            </div>
                                        )}
                                        <Button variant="outline" className="w-full h-16 rounded-2xl border-2 border-slate-100 font-black uppercase text-[10px]">
                                            <MessageSquare className="mr-2 h-4 w-4 text-primary" /> CHAT NEGOCIACIÓN
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <div className="h-80 rounded-[3rem] overflow-hidden shadow-2xl border-4 border-white">
                    <MapComponent center={request.origin} itemsToDisplay={[request]} zoom={13} interactive={false} />
                </div>

                {/* DIALOG DE ACEPTACIÓN */}
                <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
                    <DialogContent className="max-w-md rounded-[3rem] p-10 border-none">
                        <DialogHeader className="text-center space-y-4">
                            <div className="mx-auto size-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                                <CheckCircle className="text-primary h-8 w-8" />
                            </div>
                            <DialogTitle className="text-2xl font-black uppercase italic">Aceptar Solicitud</DialogTitle>
                            <DialogDescription className="text-center">
                                Al aceptar, crearás un nuevo viaje y reservarás automáticamente una plaza para {request.requester_display_name || 'el pasajero'}.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-6 space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest ml-4">Tu precio final (€)</Label>
                            <Input 
                                type="text" 
                                value={price} 
                                onChange={(e) => setPrice(e.target.value)} 
                                className="h-16 text-2xl font-black text-center rounded-2xl bg-slate-50 border-none shadow-inner" 
                                placeholder="0.00" 
                            />
                        </div>
                        <DialogFooter>
                            <Button 
                                onClick={handleConfirmAcceptance} 
                                disabled={isSubmitting}
                                className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] shadow-xl"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" /> : "ACEPTAR SOLICITUD"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    );
};

export default RequestDetails;
