
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useOutletContext, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

import SubPageHeader from './SubPageHeader';
import RideManagement from './RideManagement.jsx';
import MapComponent from './MapComponent';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, UserX, Armchair, BadgeCheck, Sparkles, Navigation, Euro, ShieldCheck, Car as CarIcon, MapPin as MapPinIcon, Phone, ShieldAlert, Share2, Copy, MessageCircle, CheckCircle, Star, Users, AlertCircle, Calendar, Clock, Leaf, Sprout, CreditCard, Radio, Shield, Heart, Ban, Fingerprint, Wallet, X, Trash2, Music, Dog, Baby, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { getRideDetailsSecure, getMyRidePin } from '@/lib/supabaseRPC';
import { useTranslation } from 'react-i18next';
import { triggerSOS, getEmergencyContacts } from '@/services/safetyService';
import { confirmTripAndPay, cancelBooking } from '@/services/bookingService';
import { calculateRideDetour } from '@/services/rideService';

import BookingPaymentModal from './BookingPaymentModal';

function RideDetails() {
    const { t } = useTranslation();
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, profile } = useOutletContext();
    const { wallet, refreshWallet } = useWallet(user);

    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [myPin, setMyPin] = useState(null);
    const [emergencyContacts, setEmergencyContacts] = useState([]);
    const [pickupLocation, setPickupLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState("");
    const [dynamicPricing, setDynamicPricing] = useState(null);
    const [isCalculatingPrice, setIsCalculatingPrice] = useState(false);

    const fetchRideDetails = useCallback(async () => {
        if (!rideId) return;
        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            const rawData = response.data?.data || response.data || response;

            if (!rawData || !rawData.id) {
                setRide(null);
                return;
            }

            const normalizedRide = {
                ...rawData,
                type: 'ride',
                dateTime: rawData.departure_time ? new Date(rawData.departure_time) : null,
                passengers: rawData.passengers || [],
                driver: {
                    id: rawData.driver_id,
                    full_name: rawData.driver_name,
                    photo_url: rawData.driver_photo,
                    phone: rawData.driver_phone,
                    verification: { status: rawData.driver_verified ? 'verified' : 'not_verified' },
                    rating: rawData.driver_rating || 5.0,
                    vehicle: rawData.vehicle || { brand: 'Vehículo', model: 'No especificado', color: 'N/A', plate: '****' }
                }
            };

            setRide(normalizedRide);

            if (user && normalizedRide.passengers) {
                const activePassenger = normalizedRide.passengers.find(p => String(p.id) === String(user.id) && p.status !== 'cancelled');
                if (activePassenger && ['confirmed', 'verified', 'on_board', 'picked_up'].includes(activePassenger.status)) {
                    if (activePassenger.pin) {
                        setMyPin(String(activePassenger.pin));
                    } else {
                        const pinRes = await getMyRidePin(rideId);
                        if (pinRes.success && pinRes.data) {
                            const rawPin = pinRes.data.pin || pinRes.data.get_my_ride_pin || (typeof pinRes.data === 'object' ? Object.values(pinRes.data)[0] : pinRes.data);
                            setMyPin(String(rawPin));
                        }
                    }
                }
            }
        } catch (error) {
            console.error("[RideDetails] Load Error:", error);
        } finally {
            setLoading(false);
        }
    }, [rideId, user]);

    useEffect(() => {
        if (!rideId || loading) return;
        const channel = supabase.channel(`ride-updates-${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, () => fetchRideDetails())
            .subscribe();
        return () => supabase.removeChannel(channel);
    }, [rideId, loading, fetchRideDetails]);

    useEffect(() => { fetchRideDetails(); }, [fetchRideDetails]);

    const { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant } = useMemo(() => {
        if (!ride || !user) return { isDriver: false, isParticipant: false, isRideCompleted: false, genderLock: false };
        const isDriver = String(ride.driver_id) === String(user.id);
        const activePassenger = (ride.passengers || []).find(p => String(p.id) === String(user.id) && !['cancelled', 'rejected'].includes(p.status));
        const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
        const isRideCompleted = ride.status === 'completed';
        const genderLock = ride.is_women_only && String(profile?.gender).toLowerCase() !== 'female';
        return { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant: isDriver || !!activePassenger };
    }, [ride, user, profile]);

    const handleCancelBooking = async () => {
        if (!ride || isProcessing) return;
        setIsProcessing(true);
        try {
            await cancelBooking(ride.id);
            toast.success("Reserva cancelada correctamente");
            fetchRideDetails();
            refreshWallet();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCallDriver = () => {
        if (ride?.driver?.phone) {
            window.location.href = `tel:${ride.driver.phone}`;
        } else {
            toast.error("El conductor no ha facilitado su teléfono");
        }
    };

    const handleShareRide = () => {
        const url = window.location.href;
        if (navigator.share) {
            navigator.share({ title: 'Viaje en Shareway', text: `¡Mira este viaje de ${ride.origin.address} a ${ride.destination.address}!`, url });
        } else {
            navigator.clipboard.writeText(url);
            toast.success("Enlace copiado al portapapeles");
        }
    };

    if (loading && !ride) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!ride) return <SubPageHeader title="No encontrado" backPath="/dashboard" />;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title="Detalles del Viaje" backPath="/dashboard" />

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                {/* MAPA CON SEGUIMIENTO */}
                <div className="h-64 w-full rounded-[2.5rem] overflow-hidden shadow-xl relative border-4 border-white">
                    <MapComponent
                        center={ride.current_location || ride.origin.coordinates || ride.origin}
                        itemsToDisplay={[{ ...ride, type: ride.status === 'in_progress' ? 'live-location' : 'ride' }]}
                        zoom={14}
                    />
                    {isRideActive && (
                        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg animate-pulse">
                            <Radio size={12} /> EN MARCHA
                        </div>
                    )}
                </div>

                {/* INFO PRINCIPAL */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-[10px]">
                                <Calendar size={12} /> {ride.dateTime ? format(ride.dateTime, "EEEE d 'de' MMMM", { locale: es }) : '--'}
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                {ride.dateTime ? format(ride.dateTime, "HH:mm") : '--:--'}
                            </h2>
                        </div>
                        <div className="text-right">
                            <p className="text-4xl font-black text-primary italic tracking-tighter leading-none">{ride.price}€</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Precio por plaza</p>
                        </div>
                    </div>

                    {/* BARRA DE ACCIONES RÁPIDAS (Solo para participantes) */}
                    {isParticipant && !isRideCompleted && (
                        <div className="flex gap-2">
                            <Button onClick={handleCallDriver} className="flex-1 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border-none hover:bg-emerald-100 font-black text-[10px] uppercase tracking-widest">
                                <Phone size={16} className="mr-2" /> Llamar
                            </Button>
                            <Button onClick={() => navigate(`/ride-chat/${ride.id}`)} className="flex-1 h-12 rounded-2xl bg-orange-50 text-orange-600 border-none hover:bg-orange-100 font-black text-[10px] uppercase tracking-widest">
                                <MessageCircle size={16} className="mr-2" /> Chat
                            </Button>
                            <Button onClick={handleShareRide} className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 p-0">
                                <Share2 size={18} />
                            </Button>
                        </div>
                    )}

                    {/* CONDUCTOR Y VEHÍCULO */}
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-[2rem]">
                            <div className="flex items-center gap-3">
                                <Avatar className="size-12 rounded-2xl border-2 border-white shadow-md">
                                    <AvatarImage src={ride.driver.photo_url} />
                                    <AvatarFallback className="font-black bg-primary/10 text-primary">{ride.driver.full_name?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <h4 className="font-black text-slate-900 uppercase italic tracking-tighter leading-none flex items-center gap-1.5">
                                        {ride.driver.full_name} {ride.driver.verification?.status === 'verified' && <BadgeCheck size={14} className="text-primary" />}
                                    </h4>
                                    <div className="flex items-center gap-1 mt-1">
                                        <Star size={10} className="text-amber-400 fill-amber-400" />
                                        <span className="text-[10px] font-bold text-slate-500">{ride.driver.rating}</span>
                                    </div>
                                </div>
                            </div>
                            <Link to={`/profile/${ride.driver.id}`} className="text-primary text-[10px] font-black uppercase tracking-widest hover:underline">Ver Perfil</Link>
                        </div>

                        {/* DETALLE VEHÍCULO */}
                        <div className="p-4 border-2 border-slate-50 rounded-[2rem] flex items-center gap-4">
                            <div className="bg-slate-100 p-3 rounded-2xl text-slate-500">
                                <CarIcon size={24} />
                            </div>
                            <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Vehículo Confirmado</p>
                                <h5 className="font-black text-slate-900 uppercase italic tracking-tighter">{ride.driver.vehicle.brand} {ride.driver.vehicle.model}</h5>
                                <div className="flex gap-2 mt-1">
                                    <span className="px-2 py-0.5 bg-slate-100 rounded-md text-[8px] font-bold uppercase text-slate-500">{ride.driver.vehicle.color}</span>
                                    <span className="px-2 py-0.5 bg-slate-100 rounded-md text-[8px] font-bold uppercase text-slate-500">{ride.driver.vehicle.plate}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* PREFERENCIAS */}
                    <div className="grid grid-cols-3 gap-2 pt-2">
                        <div className={cn("flex flex-col items-center p-3 rounded-2xl gap-1.5 border-2", ride.preferences?.music ? "bg-primary/5 border-primary/20 text-primary" : "bg-slate-50 border-transparent text-slate-300")}>
                            <Music size={18} /> <span className="text-[8px] font-black uppercase">Música</span>
                        </div>
                        <div className={cn("flex flex-col items-center p-3 rounded-2xl gap-1.5 border-2", ride.preferences?.pets ? "bg-primary/5 border-primary/20 text-primary" : "bg-slate-50 border-transparent text-slate-300")}>
                            <Dog size={18} /> <span className="text-[8px] font-black uppercase">Mascotas</span>
                        </div>
                        <div className={cn("flex flex-col items-center p-3 rounded-2xl gap-1.5 border-2", ride.preferences?.kids ? "bg-primary/5 border-primary/20 text-primary" : "bg-slate-50 border-transparent text-slate-300")}>
                            <Baby size={18} /> <span className="text-[8px] font-black uppercase">Niños</span>
                        </div>
                    </div>

                    {/* ESTADO DE RESERVA / BOTÓN ACCIÓN */}
                    <div className="pt-4 space-y-4">
                        {activePassenger ? (
                            <div className="space-y-4">
                                {myPin && activePassenger?.status === 'confirmed' && (
                                    <div className="bg-slate-900 text-white p-6 rounded-[2rem] text-center shadow-2xl relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10"><Fingerprint size={80} /></div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Código de Embarque</p>
                                        <p className="text-5xl font-black italic tracking-tighter animate-pulse">{myPin}</p>
                                        <p className="text-[9px] text-slate-400 mt-2">Muestra este código al conductor al llegar.</p>
                                    </div>
                                )}
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" className="w-full h-12 rounded-xl text-red-500 font-black text-[10px] uppercase tracking-widest hover:bg-red-50">
                                            <Trash2 size={16} className="mr-2" /> Cancelar Reserva
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="rounded-3xl">
                                        <AlertDialogHeader><AlertDialogTitle className="font-black text-xl italic uppercase">¿Cancelar plaza?</AlertDialogTitle></AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel className="rounded-xl">Volver</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleCancelBooking} className="bg-red-600 rounded-xl">Sí, cancelar</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <Button onClick={() => triggerSOS(user.id, ride.id)} variant="destructive" className="w-full h-16 rounded-[1.8rem] font-black uppercase italic shadow-lg">
                                    <ShieldAlert className="mr-2" /> ENVIAR SOS
                                </Button>
                            </div>
                        ) : (
                            !isDriver && (
                                <Button onClick={() => setIsSelectorOpen(true)} disabled={ride.seats_available <= 0 || genderLock} className="w-full h-20 rounded-[2.2rem] bg-slate-900 text-white font-black text-xl italic shadow-2xl uppercase">
                                    {genderLock ? 'SOLO MUJERES' : (ride.seats_available > 0 ? 'RESERVAR PLAZA' : 'VIAJE LLENO')}
                                </Button>
                            )
                        )}
                    </div>
                </Card>

                {isDriver && <RideManagement ride={ride} onRefresh={fetchRideDetails} />}
            </div>

            {/* DIALOGS DE PAGO IGUAL QUE ANTES... */}
            <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                <DialogContent className="rounded-[2.5rem] border-none p-8 space-y-6">
                    <DialogHeader><DialogTitle className="font-black text-xl italic uppercase">MÉTODO DE PAGO</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <Button onClick={() => { setIsSelectorOpen(false); /* Lógica pago cartera */ }} className="w-full h-16 rounded-2xl bg-slate-50 text-slate-900 border-none font-black italic flex justify-between px-6">
                            <span>SALDO CARTERA</span> <span>{wallet?.balance?.toFixed(2)}€</span>
                        </Button>
                        <Button onClick={() => { setIsSelectorOpen(false); setIsPaymentModalOpen(true); }} className="w-full h-16 rounded-2xl bg-slate-50 text-slate-900 border-none font-black italic flex justify-between px-6">
                            <span>TARJETA / OTROS</span> <CreditCard size={18} />
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <BookingPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} ride={ride} onSuccess={fetchRideDetails} />
        </div>
    );
}

export default RideDetails;
