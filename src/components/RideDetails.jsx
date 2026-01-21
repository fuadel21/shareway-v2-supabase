import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useOutletContext, Link } from 'react-router-dom';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, UserX, Armchair, BadgeCheck, Sparkles, Navigation, Euro, ShieldCheck, Car as CarIcon, MapPin as MapPinIcon, Phone, ShieldAlert, Share2, Copy, MessageCircle, CheckCircle, Star, Users, AlertCircle, Calendar, Clock, Leaf, Sprout, CreditCard, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { confirmTripAndPay, cancelBooking, calculateRefundAmount, confirmArrival } from '@/services/bookingService';
import { getRideDetailsSecure, getMyRidePin } from '@/lib/supabaseRPC';
import ReviewsList from './ReviewsList';
import BookingPaymentModal from './BookingPaymentModal';
import CreateDisputeDialog from './CreateDisputeDialog';

const getInitials = (name) => {
    if (!name) return '?';
    const nameStr = String(name);
    const words = nameStr.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

import { calculateImpact, getImpactEquivalency, formatImpactDisplay } from '@/utils/climateImpact';
import ClimateMethodologyDialog from './ClimateMethodologyDialog';

function RideDetails() {
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const { user, profile } = useOutletContext();
    const { wallet, loadingWallet, refreshWallet } = useWallet(user);

    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [driverRating, setDriverRating] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isDisputeDialogOpen, setIsDisputeDialogOpen] = useState(false);
    const [myPin, setMyPin] = useState(null);

    const fetchRideDetails = useCallback(async () => {
        if (!rideId) return;
        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);

            if (!response.success || !response.data) {
                setRide(null);
                return;
            }

            const data = response.data;
            
            const normalizedRide = {
                ...data,
                type: 'ride',
                dateTime: new Date(data.departure_time),
                passengers: data.safe_passengers || data.passengers || [],
                driver: {
                    id: data.driver_id,
                    full_name: data.driver_name || data.driver_display_name,
                    photo_url: data.driver_photo || data.driver_photo_url,
                    verification: { status: data.driver_verified ? 'verified' : 'not_verified' },
                    vehicle: data.vehicle || {}
                }
            };

            setRide(normalizedRide);

            if (user) {
                const activePassenger = (normalizedRide.passengers || [])?.find(p => p.id === user.id && p.status !== 'cancelled');
                if (activePassenger && ['confirmed', 'verified', 'confirmed_by_pin', 'on_board'].includes(activePassenger.status)) {
                    try {
                        const pinRes = await getMyRidePin(rideId);
                        if (pinRes.success && pinRes.data) {
                            const actualPin = typeof pinRes.data === 'object' ? (pinRes.data.data || pinRes.data.pin) : pinRes.data;
                            setMyPin(String(actualPin));
                        }
                    } catch (e) {
                        console.error("Error fetching secure PIN:", e);
                    }
                }
            }

            if (data.driver_id) {
                const { data: ratingData, error: ratingError } = await supabase.rpc('get_user_rating', { p_user_id: data.driver_id });
                if (ratingError) console.error("Error fetching driver rating:", ratingError);
                else setDriverRating(ratingData);
            }
        } catch (error) {
            console.error("⛔ Catch fetchRideDetails:", error);
            toast.error("Error al cargar los detalles del viaje.");
        } finally {
            setLoading(false);
        }
    }, [rideId, user]);

    useEffect(() => {
        if (!rideId) return;
        fetchRideDetails();

        const channel = supabase.channel(`ride_monitor_${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, () => fetchRideDetails())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [rideId, fetchRideDetails]);

    const { isDriver, passengerInfo, activePassenger, canBook, isPassengerVerified, isRideActive, isRideStarting, isRideFinished, otherPassengers, isLiveWindow, genderLock } = useMemo(() => {
        if (!ride || !user) return { isDriver: false, passengerInfo: null, canBook: false, isPassengerVerified: false, isRideActive: false, isRideFinished: false, otherPassengers: [], isLiveWindow: false, genderLock: false };

        const isDriver = ride.driver_id === user.id;
        const rawPassengers = ride.passengers || [];

        const normalizedPassengers = rawPassengers.map(p => ({
            ...p,
            id: p.id || p.userId,
            displayName: p.displayName || p.display_name || p.full_name || 'Usuario',
            photoURL: p.photoURL || p.photo_url || p.avatar_url
        }));

        const activePassenger = normalizedPassengers.find(p => p.id === user.id && !['cancelled', 'rejected', 'no_show'].includes(p.status));
        const passengerInfo = activePassenger || normalizedPassengers.find(p => p.id === user.id);

        const depTime = ride.dateTime;
        const now = new Date();
        const isLiveWindow = depTime && now.getTime() >= (depTime.getTime() - (15 * 60 * 1000));

        // FASE 22: Permitir reserva en viajes 'active' (en curso)
        const isRideBookable = (ride.status === 'scheduled' || ride.status === 'active') && (ride.seats_available || 0) > 0;
        const alreadyParticipant = Array.isArray(ride.participant_ids) && ride.participant_ids.includes(user.id);
        
        const genderLock = ride.is_women_only && (!profile?.gender || profile.gender.toLowerCase() !== 'female');
        
        const canBook = !isDriver && !activePassenger && !alreadyParticipant && isRideBookable;

        const isPassengerVerified = passengerInfo?.status === 'on_board' || passengerInfo?.status === 'verified';
        const isRideActive = ride.status === 'in_progress';
        const isRideStarting = ride.status === 'active';
        const isRideFinished = ['completed', 'cancelled', 'expired'].includes(ride.status);

        const otherPassengers = normalizedPassengers.filter(p =>
            p.id !== user.id &&
            (['confirmed', 'on_board', 'verified', 'completed'].includes(p.status))
        ) || [];

        return { isDriver, passengerInfo, activePassenger, canBook, isPassengerVerified, isRideActive, isRideStarting, isRideFinished, otherPassengers, isLiveWindow, genderLock };
    }, [ride, user, profile]);

    const mapItems = useMemo(() => {
        if (!ride) return [];
        const items = [{ ...ride, id: ride.id, type: 'ride' }];
        if (ride.current_location && (isRideStarting || isRideActive || isLiveWindow) && !isRideFinished) {
            items.push({
                id: `live-${ride.id}`,
                type: 'live-location',
                current_location: ride.current_location,
                driver_photo_url: ride.driver?.photo_url,
                status: ride.status
            });
        }
        return items;
    }, [ride, isRideStarting, isRideActive, isLiveWindow, isRideFinished]);

    const impactData = useMemo(() => {
        if (!ride || !ride.distance) return null;
        const distKm = parseFloat(ride.distance);
        const { savedKg } = calculateImpact(distKm, 1);
        const equivalency = getImpactEquivalency(savedKg);
        return { savedKg, equivalency, ...formatImpactDisplay(savedKg) };
    }, [ride]);

    const refundInfo = useMemo(() => calculateRefundAmount(ride, passengerInfo), [ride, passengerInfo]);

    const missingAmount = useMemo(() => {
        if (!ride || !wallet) return 0;
        return Math.max(0, parseFloat(ride.price || 0) - (wallet.balance || 0));
    }, [ride, wallet]);

    const hasEnoughBalance = useMemo(() => {
        if (!ride || !wallet) return false;
        return (wallet.balance || 0) >= parseFloat(ride.price || 0);
    }, [ride, wallet]);

    const handleConfirmTrip = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        const toastId = toast.loading("Confirmando plaza...");
        try {
            const res = await confirmTripAndPay(ride.id);
            if (res.success) {
                toast.success(res.status === 'pending' ? "Solicitud enviada." : "¡Plaza asegurada!", { id: toastId });
                await refreshWallet();
                fetchRideDetails();
            }
        } catch (error) {
            toast.error("Error al reservar", { id: toastId, description: error.message });
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePaymentSuccess = async () => {
        setIsPaymentModalOpen(false);
        await refreshWallet();
        handleConfirmTrip();
    };

    const handleCancelBooking = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            await cancelBooking(ride.id);
            toast.success("Reserva cancelada.");
            await refreshWallet();
            fetchRideDetails();
        } catch (error) {
            toast.error(error.message || "Error al cancelar.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleConfirmArrival = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            await confirmArrival(ride.id);
            toast.success("¡Llegada confirmada!");
            fetchRideDetails();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleContact = async (otherUserId) => {
        if (!user) return navigate('/login');
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            const { data, error } = await supabase.rpc('get_or_create_chat', { p_other_user_id: otherUserId });
            if (error) throw error;
            const targetChatId = data?.chatId || data?.chat_id || data;
            if (targetChatId) navigate(`/chat/${targetChatId}`);
            else throw new Error("No se pudo obtener el ID del chat");
        } catch (error) {
            console.error(error);
            toast.error("No se pudo iniciar el chat.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Viaje en ShareWay',
                    text: `Viaja de ${ride?.origin?.name || 'Origen'} a ${ride?.destination?.name || 'Destino'} por ${ride?.price || 0}€`,
                    url: window.location.href,
                });
            } catch (err) { console.error(err); }
        } else {
            navigator.clipboard.writeText(window.location.href);
            toast.success("Enlace copiado");
        }
    };

    const handlePanic = () => navigate('/emergency');

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
    if (!ride) return <div className="h-screen flex items-center justify-center"><p>Viaje no encontrado.</p></div>;

    const isConfirmed = activePassenger?.status === 'confirmed';
    const safeDate = isValid(ride.dateTime) ? format(ride.dateTime, "EEEE d 'de' MMMM", { locale: es }) : "Fecha no disponible";
    const safeTime = isValid(ride.dateTime) ? format(ride.dateTime, "HH:mm") : "--:--";

    return (
        <div className="bg-background min-h-screen pb-40">
            <SubPageHeader title="Detalles del Viaje" />
            <main className="max-w-4xl mx-auto px-4 -mt-10 relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-8 space-y-8">
                    <div className="rounded-[2.5rem] overflow-hidden shadow-xl h-80 relative border-4 border-white group">
                        <MapComponent
                            center={ride.current_location || ride.origin}
                            zoom={ride.current_location ? 15 : 12}
                            itemsToDisplay={mapItems}
                            selectedItemId={ride.id}
                            followLocation={!!ride.current_location}
                        />
                        <div className="absolute bottom-4 right-4 flex gap-2">
                            <Button size="icon" variant="secondary" className="rounded-full shadow-lg" onClick={handleShare}>
                                <Share2 className="h-4 w-4" />
                            </Button>
                        </div>
                        {ride.current_location && (isRideStarting || isRideActive || isLiveWindow) && !isRideFinished && (
                            <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg animate-in slide-in-from-left duration-500">
                                <Radio size={14} className="animate-pulse" /> SEGUIMIENTO EN VIVO
                            </div>
                        )}
                    </div>

                    <Card className="rounded-[2.5rem] border-none shadow-lg">
                        <CardContent className="p-8 space-y-8">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 text-primary font-bold mb-2">
                                        <Calendar className="h-5 w-5" />
                                        <span>{safeDate}</span>
                                    </div>
                                    <h2 className="text-3xl font-black text-slate-800">{safeTime}</h2>
                                </div>
                                <div className="text-right">
                                    <p className="text-3xl font-black text-primary">{ride.price || 0}€</p>
                                    <p className="text-sm text-slate-400 font-medium">por asiento</p>
                                </div>
                            </div>

                            <div className="space-y-6 relative text-left">
                                <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-gradient-to-b from-primary/20 via-primary/50 to-primary/20" />
                                <div className="relative flex gap-6 group">
                                    <div className="h-6 w-6 rounded-full border-[3px] border-primary bg-white shadow-sm z-10 group-hover:scale-110 transition-transform" />
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Origen</p>
                                        <p className="font-bold text-lg text-slate-800">
                                            {typeof ride.origin === 'string' ? ride.origin : (ride.origin?.name || ride.origin?.address || 'Origen')}
                                        </p>
                                        <p className="text-sm text-slate-500">{ride.origin?.address || ''}</p>
                                    </div>
                                </div>
                                <div className="relative flex gap-6 group">
                                    <div className="h-6 w-6 rounded-full border-[3px] border-primary bg-slate-800 shadow-sm z-10 group-hover:scale-110 transition-transform" />
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Destino</p>
                                        <p className="font-bold text-lg text-slate-800">
                                            {typeof ride.destination === 'string' ? ride.destination : (ride.destination?.name || ride.destination?.address || 'Destino')}
                                        </p>
                                        <p className="text-sm text-slate-500">{ride.destination?.address || ''}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                                        <Armchair className="h-4 w-4" />
                                        <span className="text-xs font-bold uppercase">Asientos</span>
                                    </div>
                                    <p className="font-bold text-slate-800">{ride.seats_available || 0} disponibles</p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                                        <Navigation className="h-4 w-4" />
                                        <span className="text-xs font-bold uppercase">Distancia</span>
                                    </div>
                                    <p className="font-bold text-slate-800">{parseFloat(ride.distance || 0).toFixed(1)} km</p>
                                </div>
                            </div>

                            {ride.details && (
                                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 italic text-left">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Comentarios del conductor</p>
                                    <p className="text-slate-600">"{ride.details}"</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {isDriver && <RideManagement ride={ride} profile={profile} onRefresh={fetchRideDetails} />}
                </div>

                <div className="lg:col-span-4 space-y-6">
                    {!isDriver && ride.driver?.id && (
                        <>
                            <Card className="rounded-[2.5rem] border-none shadow-lg overflow-hidden">
                                <CardHeader className="bg-slate-900 text-white p-8">
                                    <CardTitle className="flex items-center gap-2 text-lg"><CarIcon className="h-5 w-5 text-primary" /> Conductor</CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 pt-10 text-center relative">
                                    <Avatar className="h-24 w-24 mx-auto border-4 border-white shadow-xl -mt-20 mb-4">
                                        <AvatarImage src={ride.driver?.photo_url} />
                                        <AvatarFallback className="text-2xl bg-slate-100 text-slate-900">{getInitials(ride.driver?.full_name)}</AvatarFallback>
                                    </Avatar>
                                    <Link to={`/profile/${ride.driver?.id}`} className="block">
                                        <h3 className="font-black text-xl text-slate-800 hover:text-primary transition-colors mb-1">{ride.driver?.full_name || 'Conductor'}</h3>
                                    </Link>
                                    <div className="flex justify-center items-center gap-1 text-amber-500 mb-6">
                                        <Star className="h-4 w-4 fill-current" />
                                        <span className="font-bold">{driverRating?.average?.toFixed(1) || 'Nuevo'}</span>
                                        <span className="text-slate-400 text-xs font-normal">({driverRating?.count || 0} viajes)</span>
                                    </div>

                                    {(isPassengerVerified || isConfirmed) && ride.driver?.vehicle?.make && (
                                        <div className="mb-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left animate-in fade-in duration-500">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><CarIcon size={12} className="text-primary" /> Vehículo Confirmado</p>
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="font-bold text-slate-800">{ride.driver.vehicle.make} {ride.driver.vehicle.model || ''}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase">{ride.driver.vehicle.color || ''}</p>
                                                </div>
                                                <div className="bg-slate-900 text-white px-3 py-1.5 rounded-lg border-2 border-white shadow-md">
                                                    <p className="font-mono font-black text-xs tracking-tighter">{ride.driver.vehicle.plate || '----'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3 mb-6">
                                        {ride.is_women_only && <div className="col-span-2 py-2 px-3 bg-pink-50 text-pink-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><Sparkles className="h-3 w-3" /> Solo mujeres</div>}
                                        {ride.driver?.verification?.status === 'verified' && <div className="py-2 px-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center gap-2"><BadgeCheck className="h-3 w-3 text-emerald-500" /> Verificado</div>}
                                        <div className="py-2 px-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center gap-2"><ShieldCheck className="h-3 w-3 text-blue-500" /> Seguro</div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <Button variant="outline" className="w-full rounded-xl" onClick={() => handleContact(ride.driver?.id)}>Contactar</Button>
                                        <Dialog>
                                            <DialogTrigger asChild><Button variant="ghost" className="w-full rounded-xl text-slate-600">Ver reseñas</Button></DialogTrigger>
                                            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto rounded-3xl">
                                                <DialogHeader><DialogTitle>Reseñas de {ride.driver?.full_name}</DialogTitle></DialogHeader>
                                                <ReviewsList userId={ride.driver?.id} />
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                </CardContent>
                            </Card>

                            {otherPassengers.length > 0 && (
                                <Card className="rounded-[2.5rem] border-none shadow-lg overflow-hidden mt-6">
                                    <CardHeader className="bg-indigo-900 text-white p-6">
                                        <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5 text-indigo-300" /> Compañeros</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-6">
                                        <div className="space-y-4 text-left">
                                            {otherPassengers.map(p => (
                                                <div key={p.id} className="flex items-center gap-4">
                                                    <Avatar><AvatarImage src={p.photo_url || p.avatar_url} /><AvatarFallback>{getInitials(p.displayName)}</AvatarFallback></Avatar>
                                                    <div><p className="font-bold text-slate-800">{p.displayName}</p><p className="text-xs text-slate-400">Confirmado</p></div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </>
                    )}

                    {!isDriver && (
                        <Card className="rounded-[2.5rem] p-6 border-none shadow-lg bg-white/80 backdrop-blur-sm sticky top-24">
                            <div className="space-y-6">
                                <div>
                                    <p className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest text-left">TU ESTADO</p>
                                    {passengerInfo ? (
                                        <div className="space-y-4">
                                            {isRideFinished ? (
                                                <div className="text-center p-6 rounded-3xl bg-slate-50 border border-slate-100 italic">
                                                    <h3 className="font-bold text-lg text-slate-800 mb-1">{ride.status === 'completed' ? 'Viaje Completado' : 'Viaje Finalizado'}</h3>
                                                    <p className="text-sm text-slate-500">Este trayecto ya ha terminado.</p>
                                                    {ride.status === 'completed' && <Button className="mt-4 w-full rounded-xl bg-slate-900" onClick={() => navigate(`/leave-review/${ride.id}/${ride.driver?.id}`)}><Star className="mr-2 h-4 w-4" />Dejar reseña</Button>}
                                                </div>
                                            ) : passengerInfo.status === 'cancelled' ? (
                                                <div className="text-center p-6 rounded-3xl bg-red-50 border border-red-100 italic"><p className="text-xs font-black text-red-600 uppercase tracking-widest mb-1">Reserva Cancelada</p></div>
                                            ) : activePassenger?.status === 'pending' ? (
                                                <div className="text-center p-8 rounded-[2.5rem] bg-indigo-50 border border-indigo-100 space-y-4">
                                                    <div className="h-14 w-14 bg-indigo-100 rounded-[1.5rem] flex items-center justify-center mx-auto shadow-inner"><Clock className="h-7 w-7 text-indigo-600 animate-pulse" /></div>
                                                    <div className="space-y-1"><h3 className="font-black text-lg text-indigo-900 italic uppercase tracking-tight">Solicitud Enviada</h3><p className="text-sm text-indigo-800/60 font-medium">Esperando que el conductor valide tu perfil.</p></div>
                                                </div>
                                            ) : (isConfirmed || isPassengerVerified) ? (
                                                <div className="space-y-4">
                                                    <div className="text-center p-6 rounded-3xl bg-emerald-50 text-emerald-800 border border-emerald-100 border-b-4 border-b-emerald-200">
                                                        <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm"><CheckCircle className="h-6 w-6 text-emerald-600" /></div>
                                                        <h3 className="font-bold text-lg text-emerald-900">{isPassengerVerified ? 'A Bordo' : 'Plaza Asegurada'}</h3>
                                                        <p className="text-sm opacity-80 font-medium text-emerald-800/70">{isPassengerVerified ? '¡Disfruta del viaje!' : '¡Estás dentro! Tu PIN está listo.'}</p>
                                                    </div>

                                                    {!isPassengerVerified && (
                                                        <div className="bg-slate-900 p-8 rounded-[2.5rem] text-center border-4 border-white shadow-2xl relative overflow-hidden group">
                                                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-125 transition-transform"><ShieldCheck className="h-20 w-20 text-white" /></div>
                                                            <p className="text-[10px] font-black text-primary uppercase mb-4 tracking-[0.4em] italic">Boarding Pass PIN</p>
                                                            <div className="text-5xl font-black text-white tracking-[0.2em] mb-4 font-mono drop-shadow-lg">{myPin || '----'}</div>
                                                            <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest max-w-[80%] mx-auto leading-relaxed">Muestra este ID al conductor al subir.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {canBook ? (
                                                <>
                                                    <div className="text-center p-4 bg-slate-50 rounded-2xl border border-slate-100"><p className="text-sm text-slate-500 mb-1">Plazas disponibles</p><p className="text-2xl font-black text-slate-800">{ride.seats_available}</p></div>
                                                    
                                                    {genderLock && (
                                                        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                                                            <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-xs font-bold text-amber-900 uppercase tracking-tight">Restricción de Género</p>
                                                                <p className="text-[11px] text-amber-800/80 leading-relaxed mt-1">Este viaje es exclusivo para mujeres.</p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button 
                                                                className={cn("w-full py-6 text-lg font-bold rounded-xl shadow-xl transition-all", hasEnoughBalance && !genderLock ? "shadow-primary/20 bg-primary" : "bg-slate-200 text-slate-500 hover:bg-slate-300")} 
                                                                disabled={isProcessing || loadingWallet || genderLock}
                                                            >
                                                                {isProcessing ? <Loader2 className="animate-spin mr-2" /> : hasEnoughBalance ? <Euro className="mr-2 h-5 w-5" /> : <CreditCard className="mr-2 h-5 w-5" />}
                                                                {genderLock ? 'Acceso Restringido' : !hasEnoughBalance ? 'Saldo Insuficiente' : (ride?.approval_mode || 'automatic') === 'manual' ? 'Enviar solicitud' : 'Reservar Plaza'}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent className="rounded-[2.5rem] p-8 bg-white">
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle className="font-black italic uppercase tracking-tighter">{(ride?.approval_mode || 'automatic') === 'manual' ? 'Confirmar solicitud' : 'Confirmar reserva'}</AlertDialogTitle>
                                                                <AlertDialogDescription>Se descontarán <strong>{ride.price}€</strong> de tu saldo.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <div className="p-4 bg-slate-50 rounded-lg flex justify-between items-center my-4">
                                                                <span className="text-sm text-slate-600">Saldo actual:</span>
                                                                <span className={cn("font-bold", !hasEnoughBalance ? "text-red-500" : "text-emerald-600")}>{(wallet?.balance || 0).toFixed(2)}€</span>
                                                            </div>
                                                            <AlertDialogFooter className="gap-2">
                                                                <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                                                                {hasEnoughBalance ? (
                                                                    <AlertDialogAction onClick={handleConfirmTrip} className="rounded-xl bg-slate-900 text-white font-black">Confirmar y Pagar</AlertDialogAction>
                                                                ) : (
                                                                    <Button onClick={() => setIsPaymentModalOpen(true)} className="bg-primary text-white rounded-xl font-black">Pagar {missingAmount.toFixed(2)}€ y Reservar</Button>
                                                                )}
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </>
                                            ) : (
                                                <div className="text-center p-4 bg-red-50 text-red-800 rounded-2xl border border-red-100 animate-in fade-in duration-500">
                                                    <p className="font-black text-sm uppercase tracking-tighter mb-1">No disponible</p>
                                                    <p className="text-[10px] opacity-80 uppercase font-bold tracking-widest leading-tight">
                                                        {ride.seats_available <= 0 ? 'Viaje Lleno' : 'Trayecto Finalizado'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    )}
                </div>
            </main>
            <BookingPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} amount={missingAmount} onSuccess={handlePaymentSuccess} />
            <CreateDisputeDialog open={isDisputeDialogOpen} onOpenChange={setIsDisputeDialogOpen} rideId={rideId} onSuccess={fetchRideDetails} />
        </div>
    );
}

export default RideDetails;
