import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { fulfillRequest } from '@/services/rideService';
import * as rpc from '@/lib/supabaseRPC';

// Componentes
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar.jsx';
import MapComponent from './MapComponent';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SubPageHeader from './SubPageHeader';

// Iconos y Utils
import {
    Calendar, Clock, Users, ArrowLeft, Loader2,
    Handshake, MessageSquare, Phone, XCircle,
    MapPin, Milestone, Wallet, BadgeCheck,
    ShieldCheck, Sparkles, Navigation, ChevronRight,
    Euro, Search, User, ShieldAlert, CheckCircle,
    Info, Star
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
    const [timeLeft, setTimeLeft] = useState(null);
    const [showAttachDialog, setShowAttachDialog] = useState(false);
    const [myRides, setMyRides] = useState([]);
    const [selectedRideId, setSelectedRideId] = useState(null);

    const fetchRequestDetails = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select(`
                    *,
                    requester:profiles!requester_id (*)
                `)
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
            console.error("🛡️ stability: fetchRequestDetails failed:", error);
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

    useEffect(() => {
        if (!request?.payment_expires_at) {
            setTimeLeft(null);
            return;
        }
        const end = new Date(request.payment_expires_at).getTime();
        const tick = () => {
            const now = Date.now();
            const diff = Math.max(0, Math.floor((end - now) / 1000));
            setTimeLeft(diff);
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [request?.payment_expires_at]);

    useEffect(() => {
        const fetchMyRides = async () => {
            if (!user?.id || !showAttachDialog) return;
            const { data, error } = await supabase
                .from('rides')
                .select('id, origin, destination, departure_time, seats_available, status')
                .eq('driver_id', user.id)
                .eq('status', 'scheduled')
                .gt('seats_available', 0)
                .order('departure_time', { ascending: true });
            if (!error) setMyRides(data || []);
        };
        fetchMyRides();
    }, [showAttachDialog, user?.id]);

    const handleConfirmAcceptance = async () => {
        const numericPrice = Number(price.toString().replace(',', '.'));
        if (isNaN(numericPrice) || numericPrice <= 0) return toast.error("Por favor, introduce un precio válido.");

        setIsSubmitting(true);
        const toastId = toast.loading("Creando viaje...");

        try {
            await fulfillRequest(request, numericPrice);
            toast.success("¡Oferta enviada!", { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            console.error("🛡️ stability: handleConfirmAcceptance failed:", error);
            toast.error("Error al aceptar", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
            setShowAcceptDialog(false);
        }
    };

    const handleCancelRequest = async () => {
        if (!window.confirm("¿Seguro que quieres retirar esta solicitud?")) return;

        setIsSubmitting(true);
        const toastId = toast.loading("Retirando solicitud...");
        try {
            const { error } = await supabase.from('ride_requests').update({ status: 'cancelled' }).eq('id', requestId);
            if (error) throw error;
            toast.success("Solicitud retirada", { id: toastId });
            navigate('/dashboard');
        } catch (error) {
            toast.error("Error al cancelar", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleContactRequester = async () => {
        if (!request?.requester_id || !user) return;
        setIsSubmitting(true);
        try {
            const { data, success, error } = await rpc.safeCall(
                supabase.rpc('get_or_create_chat', { p_other_user_id: request.requester_id }),
                'get_or_create_chat'
            );
            if (!success) throw new Error(error);
            navigate(`/chat/${data.chatId || data.chat_id || data}`);
        } catch (error) {
            toast.error("No se pudo iniciar el chat.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando...</p>
            </div>
        </div>
    );

    if (!request) return null;

    const formattedDate = request.dateTime ? format(request.dateTime, "eeee, d 'de' MMMM", { locale: es }) : '—';
    const formattedTime = request.dateTime ? format(request.dateTime, "HH:mm", { locale: es }) : '--:--';
    const isRequester = user?.id === request.requester_id;
    const isDriver = user?.id && request.ride?.driver_id === user.id;

    return (
        <div className="bg-[#FDFCFB] min-h-screen pb-40 lg:pb-10 lg:py-10">
            <SubPageHeader title="Detalles de Solicitud" />

            <main className="max-w-5xl mx-auto px-4 mt-4 lg:mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <section className="bg-white rounded-[3rem] p-8 shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden relative group">
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                                <Sparkles size={120} className="text-primary rotate-12" />
                            </div>

                            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                                <Avatar className="h-32 w-32 border-4 border-white shadow-2xl ring-8 ring-slate-50 transition-transform group-hover:rotate-2">
                                    <AvatarImage src={request.requester.photoURL} />
                                    <AvatarFallback className="bg-primary text-white text-4xl font-black italic">{request.requester.displayName?.[0]}</AvatarFallback>
                                </Avatar>

                                <div className="flex-1 text-center md:text-left space-y-4">
                                    <div>
                                        <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                                            <h2 className="text-4xl font-black tracking-tighter uppercase italic leading-none">{request.requester.displayName}</h2>
                                            <BadgeCheck className="h-6 w-6 text-primary" />
                                        </div>
                                        <div className="flex items-center justify-center md:justify-start gap-2">
                                            <div className="flex items-center gap-0.5">
                                                {[1, 2, 3, 4, 5].map(s => <Star key={s} size={12} className="fill-primary text-primary" />)}
                                            </div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Miembro Verificado</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                        <div className="px-4 py-2 bg-[#001F3F] text-white rounded-full text-[9px] font-black uppercase tracking-widest">
                                            Busca {request.seats_needed} Asiento{request.seats_needed > 1 ? 's' : ''}
                                        </div>
                                        <div className="px-4 py-2 bg-primary/10 text-primary rounded-full text-[9px] font-black uppercase tracking-widest">
                                            Presupuesto: {request.suggested_price}€
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="bg-[#001F3F] rounded-[3.5rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                                <Navigation size={200} className="text-white" />
                            </div>

                            <div className="relative z-10 space-y-10">
                                <div className="space-y-8">
                                    <div className="flex gap-6">
                                        <div className="flex flex-col items-center">
                                            <div className="size-6 bg-primary rounded-full ring-8 ring-primary/20" />
                                            <div className="w-1 h-20 bg-gradient-to-b from-primary to-emerald-500 rounded-full my-2" />
                                            <div className="size-6 bg-emerald-500 rounded-full ring-8 ring-emerald-500/20" />
                                        </div>
                                        <div className="flex-1 space-y-12 py-1">
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-primary mb-2">Punto de Recogida</p>
                                                <p className="text-xl font-bold tracking-tight">{request.origin?.name || request.origin?.address}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-400 mb-2">Destino Final</p>
                                                <p className="text-xl font-bold tracking-tight">{request.destination?.name || request.destination?.address}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-white/10">
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Fecha Prevista</p>
                                        <div className="flex items-center gap-3">
                                            <Calendar className="text-primary h-5 w-5" />
                                            <span className="font-bold text-lg">{formattedDate}</span>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Hora de Salida</p>
                                        <div className="flex items-center gap-3">
                                            <Clock className="text-primary h-5 w-5" />
                                            <span className="font-bold text-lg">{formattedTime}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <div className="space-y-8">
                        <Card className="rounded-[2.5rem] border-none shadow-2xl shadow-slate-200 overflow-hidden bg-white">
                            <CardContent className="p-8 space-y-6">
                                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-slate-400 text-center mb-4">Gestión de Solicitud</h3>

                                {isRequester ? (
                                    <div className="space-y-4">
                                        {request.status === 'accepted' && request.matched_ride_id ? (
                                            <div className="p-6 bg-amber-50 text-amber-700 rounded-3xl border border-amber-100">
                                                <div className="flex items-center gap-4">
                                                    <div className="size-10 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                                        <Wallet size={20} />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-[10px] font-black uppercase tracking-widest">Estado: Oferta Pendiente</p>
                                                        <p className="text-[9px] font-bold opacity-70 italic tracking-tight">
                                                            {timeLeft != null ? `Expira en ${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}` : 'Procede al pago pronto'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    onClick={() => navigate(`/ride/${request.matched_ride_id}?requestId=${requestId}`)}
                                                    className="mt-4 w-full h-14 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black uppercase text-[10px] tracking-widest"
                                                >
                                                    Proceder al pago seguro
                                                </Button>
                                            </div>
                                        ) : ['confirmed', 'on_board', 'completed'].includes(request.status) ? (
                                            <div className="p-6 bg-emerald-50 text-emerald-600 rounded-3xl border border-emerald-100 flex items-center gap-4">
                                                <div className="size-10 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                                    <CheckCircle size={20} />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-[10px] font-black uppercase tracking-widest">Estado: {request.status === 'completed' ? 'Viaje Finalizado' : 'Plaza Asegurada'}</p>
                                                    <Button variant="link" onClick={() => navigate(`/ride/${request.matched_ride_id}`)} className="text-[9px] h-auto p-0 font-bold text-emerald-700/70 italic tracking-tight uppercase">Ver detalles del viaje</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-6 bg-blue-50 text-blue-600 rounded-3xl border border-blue-100 flex items-center gap-4">
                                                <div className="size-10 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                                    <Sparkles size={20} />
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest">Estado: {request.status === 'pending' ? 'Buscando Driver' : request.status.toUpperCase()}</p>
                                                    <p className="text-[9px] font-bold opacity-70 italic tracking-tight">Tu solicitud está visible en el feed</p>
                                                </div>
                                            </div>
                                        )}
                                        <Button
                                            onClick={handleCancelRequest}
                                            disabled={isSubmitting}
                                            variant="ghost"
                                            className="w-full h-16 rounded-2xl text-red-500 hover:bg-red-50 font-black uppercase tracking-widest text-[10px]"
                                        >
                                            <XCircle className="mr-2 h-4 w-4" /> Retirar Solicitud
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <Button
                                            onClick={() => setShowAcceptDialog(true)}
                                            disabled={isSubmitting}
                                            className="w-full h-20 bg-primary hover:bg-primary/90 text-white rounded-[2rem] shadow-2xl shadow-primary/30 flex flex-col gap-1 transition-all hover:scale-105 active:scale-95 border-none"
                                        >
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Aceptar Solicitud</span>
                                            <span className="text-[9px] font-bold opacity-80">Publicar oferta de viaje</span>
                                        </Button>

                                        <Button
                                            onClick={() => setShowAttachDialog(true)}
                                            disabled={isSubmitting}
                                            variant="outline"
                                            className="w-full h-16 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-widest text-[10px] hover:bg-slate-50"
                                        >
                                            Vincular a un viaje existente
                                        </Button>

                                        <Button
                                            onClick={handleContactRequester}
                                            disabled={isSubmitting}
                                            variant="outline"
                                            className="w-full h-16 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-widest text-[10px] hover:bg-slate-50"
                                        >
                                            <MessageSquare className="mr-2 h-4 w-4 text-primary" /> Chat de Negociación
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="rounded-[2.5rem] border-none shadow-xl shadow-slate-200 overflow-hidden bg-white/50 backdrop-blur-md">
                            <CardContent className="p-8 space-y-6">
                                <div className="flex items-center gap-3">
                                    <div className="size-10 bg-white rounded-2xl flex items-center justify-center shadow-lg">
                                        <Info className="text-primary size-5" />
                                    </div>
                                    <h4 className="font-black text-[10px] uppercase tracking-widest">Nota del Pasajero</h4>
                                </div>
                                <p className="text-sm font-medium text-slate-600 leading-relaxed italic">
                                    "{request.details || request.note || 'No se han incluido detalles adicionales.'}"
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <section className="bg-white rounded-[4rem] p-4 shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden h-[400px]">
                    <MapComponent
                        center={request.origin?.coordinates || request.origin}
                        zoom={12}
                        itemsToDisplay={[{ ...request, id: request.id, type: 'request' }]}
                        interactive={false}
                    />
                </section>

                <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
                    <DialogContent className="max-w-md rounded-[3rem] p-10 border-none bg-white shadow-2xl">
                        <DialogHeader className="text-center space-y-4">
                            <div className="mx-auto size-20 bg-primary/10 rounded-[2rem] flex items-center justify-center">
                                <Euro className="text-primary h-10 w-10" />
                            </div>
                            <DialogTitle className="text-3xl font-black tracking-tighter uppercase italic leading-none">Confirmar Precio</DialogTitle>
                        </DialogHeader>

                        <div className="py-10 space-y-6">
                            <div className="space-y-4">
                                <Label className="text-[10px] font-black uppercase tracking-widest ml-4">Precio Sugerido (€)</Label>
                                <div className="relative">
                                    <Euro className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 size-6" />
                                    <Input
                                        type="text"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                        className="h-20 pl-16 pr-8 text-3xl font-black italic rounded-3xl bg-slate-50 border-none focus-visible:ring-primary shadow-inner"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="flex-col sm:flex-col gap-4">
                            <Button
                                onClick={handleConfirmAcceptance}
                                disabled={isSubmitting}
                                className="w-full h-16 bg-[#001F3F] hover:bg-[#00152a] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-slate-200 border-none"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" /> : "Publicar Oferta y Notificar"}
                            </Button>
                            <Button
                                onClick={() => setShowAcceptDialog(false)}
                                variant="ghost"
                                className="w-full text-slate-400 font-bold uppercase tracking-widest text-[9px]"
                            >
                                Cancelar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={showAttachDialog} onOpenChange={setShowAttachDialog}>
                    <DialogContent className="max-w-md rounded-[3rem] p-10 border-none bg-white shadow-2xl">
                        <DialogHeader className="space-y-2">
                            <DialogTitle className="text-2xl font-black tracking-tighter">Selecciona tu viaje</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 max-h-[40vh] overflow-y-auto">
                            {myRides.length === 0 ? (
                                <p className="text-slate-500 text-sm">No tienes viajes con plazas libres.</p>
                            ) : myRides.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => setSelectedRideId(r.id)}
                                    className={`w-full text-left p-4 rounded-2xl border-2 ${selectedRideId === r.id ? 'border-primary bg-primary/5' : 'border-slate-100 bg-slate-50'}`}
                                >
                                    <div className="font-black text-slate-900 text-sm">
                                        {(r.origin?.name || r.origin?.address)} → {(r.destination?.name || r.destination?.address)}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <DialogFooter>
                            <Button
                                onClick={async () => {
                                    if (!selectedRideId) return toast.error("Selecciona un viaje");
                                    setIsSubmitting(true);
                                    const toastId = toast.loading("Aceptando solicitud...");
                                    try {
                                        const { success, error } = await rpc.acceptRequest(requestId, selectedRideId);
                                        if (!success) throw new Error(error);
                                        toast.success("Solicitud aceptada correctamente.", { id: toastId });
                                        setShowAttachDialog(false);
                                        fetchRequestDetails();
                                    } catch (e) {
                                        toast.error(e.message || "No se pudo aceptar", { id: toastId });
                                    } finally {
                                        setIsSubmitting(false);
                                    }
                                }}
                                className="w-full h-12 bg-primary text-white rounded-xl"
                            >
                                Confirmar Aceptación
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    );
};

export default RequestDetails;
