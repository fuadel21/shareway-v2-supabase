
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { fulfillRequest } from '@/services/rideService';
import * as rpc from '@/lib/supabaseRPC';

import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar.jsx';
import MapComponent from './MapComponent';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SubPageHeader from './SubPageHeader';

import {
    Calendar, Clock, Users, Loader2, MessageCircle, Phone, 
    MapPin, Navigation, Share2, Star, BadgeCheck, Euro, 
    CheckCircle, AlertTriangle, ShieldCheck, ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const RequestDetails = () => {
    const { id: requestId } = useParams();
    const navigate = useNavigate();
    const { user, profile: myProfile } = useOutletContext();

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

            setRequest({
                ...data,
                dateTime: data.departure_time ? new Date(data.departure_time) : new Date(),
                requester: {
                    ...data.requester,
                    photoURL: data.requester?.photo_url,
                    displayName: data.requester?.full_name || 'Usuario',
                    rating: data.requester?.rating || 5.0,
                    phone: data.requester?.phone
                }
            });
            setPrice(String(data.suggested_price || ''));
        } catch (error) {
            toast.error("No se pudo cargar la solicitud");
            navigate('/dashboard');
        } finally {
            setLoading(false);
        }
    }, [requestId, navigate]);

    useEffect(() => {
        if (requestId) fetchRequestDetails();
    }, [requestId, fetchRequestDetails]);

    const handleCallRequester = () => {
        if (request?.requester?.phone) {
            window.location.href = `tel:${request.requester.phone}`;
        } else {
            toast.error("El pasajero no ha facilitado su teléfono");
        }
    };

    const handleConfirmAcceptance = async () => {
        const numericPrice = Number(price.replace(',', '.'));
        if (isNaN(numericPrice) || numericPrice <= 0) return toast.error("Precio no válido");

        setIsSubmitting(true);
        const toastId = toast.loading("Creando viaje y aceptando pasajero...");
        try {
            await fulfillRequest(request, numericPrice);
            toast.success("¡Solicitud aceptada!", { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            toast.error(error.message, { id: toastId });
        } finally {
            setIsSubmitting(false);
            setShowAcceptDialog(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!request) return null;

    const isMyRequest = user?.id === request.requester_id;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title="Detalle de Solicitud" backPath="/dashboard" />

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                {/* MAPA GRANDE */}
                <div className="h-64 w-full rounded-[2.5rem] overflow-hidden shadow-xl relative border-4 border-white">
                    <MapComponent center={request.origin} itemsToDisplay={[request]} zoom={13} />
                    <div className="absolute top-4 left-4 bg-indigo-500 text-white px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg">
                        SOLICITUD ACTIVA
                    </div>
                </div>

                {/* TARJETA DE INFO */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1 text-left">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-[10px]">
                                <Calendar size={12} /> {format(request.dateTime, "EEEE d 'de' MMMM", { locale: es })}
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                {format(request.dateTime, "HH:mm")}
                            </h2>
                        </div>
                        <div className="text-right">
                            <p className="text-4xl font-black text-primary italic tracking-tighter leading-none">{request.suggested_price}€</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Presupuesto</p>
                        </div>
                    </div>

                    {/* ACCIONES RÁPIDAS (Solo para el conductor que está viendo) */}
                    {!isMyRequest && (
                        <div className="flex gap-2">
                            <Button onClick={handleCallRequester} className="flex-1 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border-none hover:bg-emerald-100 font-black text-[10px] uppercase tracking-widest">
                                <Phone size={16} className="mr-2" /> Llamar
                            </Button>
                            <Button onClick={() => navigate(`/ride-chat/${request.id}`)} className="flex-1 h-12 rounded-2xl bg-orange-50 text-orange-600 border-none hover:bg-orange-100 font-black text-[10px] uppercase tracking-widest">
                                <MessageCircle size={16} className="mr-2" /> Chat
                            </Button>
                            <Button className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 p-0 border-none">
                                <Share2 size={18} />
                            </Button>
                        </div>
                    )}

                    {/* PERFIL DEL PASAJERO */}
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-[2rem]">
                        <div className="flex items-center gap-3">
                            <Avatar className="size-14 rounded-2xl border-2 border-white shadow-md">
                                <AvatarImage src={request.requester.photoURL} />
                                <AvatarFallback className="font-black bg-indigo-100 text-indigo-600">{request.requester.displayName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="text-left">
                                <h4 className="font-black text-slate-900 uppercase italic tracking-tighter leading-none flex items-center gap-1.5">
                                    {request.requester.displayName} <BadgeCheck size={14} className="text-blue-500" />
                                </h4>
                                <div className="flex items-center gap-1 mt-1">
                                    <Star size={10} className="text-amber-400 fill-amber-400" />
                                    <span className="text-[10px] font-bold text-slate-500">{request.requester.rating} · Pasajero Élite</span>
                                </div>
                            </div>
                        </div>
                        <Link to={`/profile/${request.requester_id}`} className="text-primary text-[10px] font-black uppercase tracking-widest">Ver Perfil</Link>
                    </div>

                    {/* ITINERARIO DETALLADO */}
                    <div className="space-y-4">
                        <div className="flex gap-4">
                            <div className="flex flex-col items-center pt-1">
                                <div className="size-3 rounded-full border-2 border-primary bg-white" />
                                <div className="w-0.5 h-10 bg-slate-100 my-1" />
                                <MapPin size={14} className="text-emerald-500" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-[8px] font-black text-slate-400 uppercase">Recogida</p>
                                <p className="text-sm font-bold text-slate-900 leading-tight">{request.origin?.address}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase mt-3">Destino</p>
                                <p className="text-sm font-bold text-slate-900 leading-tight">{request.destination?.address}</p>
                            </div>
                        </div>
                    </div>

                    {/* BOTÓN DE ACCIÓN PRINCIPAL */}
                    {!isMyRequest && request.status === 'pending' && (
                        <Button 
                            onClick={() => setShowAcceptDialog(true)}
                            className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-xl italic shadow-2xl uppercase active:scale-95 transition-all border-none"
                        >
                            ACEPTAR Y CREAR VIAJE
                        </Button>
                    )}

                    {isMyRequest && (
                        <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-center">
                            <p className="text-[10px] font-black text-indigo-600 uppercase italic">Esta es tu propia solicitud</p>
                        </div>
                    )}
                </Card>
            </div>

            {/* DIALOG DE NEGOCIACIÓN DE PRECIO */}
            <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
                <DialogContent className="max-w-[90vw] sm:max-w-[400px] rounded-[2.5rem] border-none p-8 space-y-6 outline-none">
                    <div className="text-center space-y-2">
                        <div className="size-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle size={32} />
                        </div>
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter">¿Aceptar pasajero?</DialogTitle>
                        <DialogDescription className="text-xs font-bold text-slate-400">
                            Confirmarás tu compromiso de recoger a {request.requester.displayName}.
                        </DialogDescription>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest ml-4">Precio final acordado (€)</Label>
                        <div className="relative">
                            <Euro className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                            <Input 
                                value={price} 
                                onChange={(e) => setPrice(e.target.value)}
                                className="h-16 pl-14 text-2xl font-black rounded-2xl bg-slate-50 border-none text-center shadow-inner"
                            />
                        </div>
                    </div>

                    <Button 
                        onClick={handleConfirmAcceptance} 
                        disabled={isSubmitting}
                        className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs shadow-xl flex gap-2"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <>CONFIRMAR INCORPORACIÓN <ChevronRight size={18} /></>}
                    </Button>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RequestDetails;
