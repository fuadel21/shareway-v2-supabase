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
import { Loader2, UserX, Armchair, BadgeCheck, Sparkles, Navigation, Euro, ShieldCheck, Car as CarIcon, MapPin as MapPinIcon, Phone, ShieldAlert, Share2, Copy, MessageCircle, CheckCircle, Star, Users, AlertCircle, Calendar, Clock, Leaf, Sprout, CreditCard, Radio, Shield, Heart, Ban, Fingerprint, Wallet, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { getRideDetailsSecure, getMyRidePin } from '@/lib/supabaseRPC';
import { useTranslation } from 'react-i18next';
import { triggerSOS, getEmergencyContacts } from '@/services/safetyService';
import { confirmTripAndPay } from '@/services/bookingService';
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
    const [hasCheckedContacts, setHasCheckedContacts] = useState(false);
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
                    verification: { status: rawData.driver_verified ? 'verified' : 'not_verified' },
                    rating: rawData.driver_rating || 0
                }
            };

            setRide(normalizedRide);

            if (user && normalizedRide.passengers) {
                const activePassenger = normalizedRide.passengers.find(p => String(p.id) === String(user.id) && p.status !== 'cancelled');
                if (activePassenger && ['confirmed', 'verified', 'on_board', 'picked_up'].includes(activePassenger.status)) {
                    const pinRes = await getMyRidePin(rideId);
                    if (pinRes.success) setMyPin(String(pinRes.data.pin || pinRes.data));
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

        const channel = supabase
            .channel(`ride-tracking-${rideId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                (payload) => {
                    const newStatus = payload.new.status;
                    const isDriverNow = String(payload.new.driver_id) === String(user?.id);

                    if (newStatus === 'completed' && !isDriverNow) {
                        toast.success("¡Viaje finalizado!", { description: "Valora tu experiencia con el conductor." });
                        navigate(`/leave-review/${rideId}/${payload.new.driver_id}`);
                        return;
                    }

                    setRide(prev => prev ? ({
                        ...prev,
                        status: newStatus,
                        current_location: payload.new.current_location,
                        seats_available: payload.new.seats_available,
                        passengers: payload.new.passengers
                    }) : null);
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [rideId, loading]);

    useEffect(() => {
        const loadSafetyData = async () => {
            if (user?.id) {
                const contacts = await getEmergencyContacts(user.id);
                setEmergencyContacts(contacts);
                setHasCheckedContacts(true);
            }
        };
        loadSafetyData();
    }, [user]);

    useEffect(() => {
        fetchRideDetails();
    }, [fetchRideDetails]);

    const { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant } = useMemo(() => {
        if (!ride || !user) return { isDriver: false, isParticipant: false, isRideCompleted: false };

        const isDriver = String(ride.driver_id) === String(user.id);
        const activePassenger = (ride.passengers || []).find(p => String(p.id) === String(user.id) && !['cancelled', 'rejected'].includes(p.status));

        const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
        const isRideCompleted = ride.status === 'completed';
        const genderLock = ride.is_women_only && profile?.gender !== 'female';
        const isParticipant = isDriver || !!activePassenger;

        return { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant };
    }, [ride, user, profile]);

    // EFECTO: Recalcular precio por desvío cuando cambia el punto de recogida
    useEffect(() => {
        const recalculatePrice = async () => {
            if (!pickupLocation || !ride || isDriver || activePassenger || isRideCompleted) return;

            setIsCalculatingPrice(true);
            try {
                // Intentar obtener destino de la búsqueda
                const destLat = searchParams.get('paxDestLat');
                const destLng = searchParams.get('paxDestLng');

                const paxDestination = (destLat && destLng)
                    ? { lat: parseFloat(destLat), lng: parseFloat(destLng) }
                    : (ride.destination?.coordinates || ride.destination);

                if (!paxDestination?.lat || !paxDestination?.lng || !pickupLocation?.lat || !pickupLocation?.lng) {
                    setIsCalculatingPrice(false);
                    return;
                }

                const result = await calculateRideDetour(
                    ride.id,
                    pickupLocation,
                    paxDestination
                );

                if (result.success) {
                    setDynamicPricing(result);
                    toast.info("Precio actualizado", {
                        description: `El precio se ha ajustado según tu punto de recogida y desvío.`
                    });
                }
            } catch (error) {
                console.error("[RideDetails] Price Recalculation Error:", error);
                setDynamicPricing(null);
            } finally {
                setIsCalculatingPrice(false);
            }
        };

        recalculatePrice();
    }, [pickupLocation, ride?.id, isDriver, activePassenger, isRideCompleted, searchParams]);

    const handleConfirmTrip = async (retry = false) => {
        const isRetry = retry === true;
        if (isProcessing) return;
        setIsProcessing(true);
        const toastId = toast.loading("Confirmando...");
        try {
            const res = await confirmTripAndPay(ride.id, searchParams.get('requestId'), {
                ...user,
                pickupLocation,
                pickupAddress,
                price: dynamicPricing ? parseFloat(dynamicPricing.pricing.totalPrice) : ride.price
            });
            if (res.success) {
                toast.success("¡Plaza confirmada!", { id: toastId });
                await refreshWallet();
                fetchRideDetails();
                setIsPaymentModalOpen(false);
                setIsSelectorOpen(false);
            }
        } catch (error) {
            console.error("[RideDetails] Booking Error:", error);
            if (!isRetry && (error.message.includes("Saldo insuficiente") || error.message.includes("wallet"))) {
                toast.dismiss(toastId);
                setIsSelectorOpen(false);
                setIsPaymentModalOpen(true);
            } else {
                toast.error("Error de reserva", {
                    id: toastId,
                    description: error.message || "No se pudo completar la reserva en este momento."
                });
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const copyPin = () => {
        if (myPin) {
            navigator.clipboard.writeText(myPin);
            toast.success("PIN copiado al portapapeles");
        }
    };

    const handleSOS = async () => {
        if (!rideId) return;
        try {
            setIsProcessing(true);
            await triggerSOS(rideId);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMapClick = async (latlng) => {
        if (!isDriver && !activePassenger && !isRideCompleted) {
            setPickupLocation({ lat: latlng.lat, lng: latlng.lng });
            setPickupAddress("Cargando dirección...");

            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`);
                const data = await res.json();
                const addr = data.display_name?.split(',').slice(0, 2).join(',') || "Punto seleccionado";
                setPickupAddress(addr);
                toast.info("Dirección de recogida", { description: addr });
            } catch (e) {
                setPickupAddress("Ubicación en el mapa");
            }
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary h-10 w-10 opacity-20" /></div>;
    if (!ride) return <div className="h-screen flex items-center justify-center bg-slate-50"><p className="font-black text-slate-400 uppercase tracking-widest">Viaje no encontrado</p></div>;

    const rideDateTime = ride.dateTime instanceof Date && isValid(ride.dateTime) ? ride.dateTime : null;

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans text-left">
            <SubPageHeader title="Detalles del Viaje" />

            <main className="max-w-4xl mx-auto px-4 -mt-10 relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 text-left animate-elite-in">
                <div className="lg:col-span-8 space-y-4 lg:space-y-6 text-left">
                    <div className="rounded-[1.5rem] lg:rounded-[2rem] overflow-hidden shadow-elite h-64 lg:h-80 relative border-4 border-white group">
                        <MapComponent
                            center={ride.current_location || ride.origin}
                            itemsToDisplay={ride.current_location ? [{ ...ride, type: 'live-location' }] : [ride]}
                            zoom={13}
                            onMapClick={handleMapClick}
                            pickupLocation={pickupLocation}
                        />
                        {isRideActive && (
                            <div className="absolute top-4 left-4 flex items-center gap-2 px-3 lg:px-4 py-1.5 lg:py-2 bg-emerald-500 text-white rounded-full text-[9px] lg:text-[10px] font-black uppercase tracking-widest shadow-lg animate-pulse">
                                <Radio size={12} className="lg:size-[14px]" /> EN CURSO
                            </div>
                        )}
                        {!isDriver && !activePassenger && (
                            <div className="absolute bottom-3 left-3 right-3 lg:bottom-4 lg:left-4 lg:right-4 bg-white/95 backdrop-blur-md p-2.5 lg:p-3 rounded-xl lg:rounded-2xl shadow-lg border border-white/20 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                <p className="text-[8px] lg:text-[9px] font-black text-slate-900 uppercase tracking-tighter italic flex items-center gap-2 justify-center lg:justify-start">
                                    <MapPinIcon size={10} className="text-primary lg:size-[12px]" />
                                    Toca el mapa para tu punto de recogida
                                </p>
                            </div>
                        )}
                    </div>

                        <div className="bg-primary/5 border border-primary/20 p-4 rounded-2xl flex items-center justify-between animate-elite-in shadow-sm">
                            <div className="flex items-center gap-3 lg:gap-4">
                                <div className="bg-primary text-white p-2 rounded-xl shadow-lg">
                                    <MapPinIcon size={18} className="lg:size-[20px]" />
                                </div>
                                <div>
                                    <p className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">Punto de recogida</p>
                                    <p className="text-xs lg:text-sm font-black text-slate-900 uppercase italic tracking-tighter line-clamp-1">{pickupAddress}</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setPickupLocation(null); setPickupAddress(""); }}
                                className="text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl size-8 lg:size-10"
                            >
                                <X size={18} className="lg:size-[20px]" />
                            </Button>
                        </div>
                    )}

                    <Card className="rounded-[1.5rem] lg:rounded-[2rem] border-none shadow-elite bg-white p-5 lg:p-8 space-y-6 lg:space-y-8 text-left">
                        <div className="flex justify-between items-start">
                            <div className="text-left">
                                <div className="flex items-center gap-2 text-primary font-bold mb-1">
                                    <Calendar className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                                    <span className="text-[10px] lg:text-xs uppercase tracking-widest">
                                        {rideDateTime ? format(rideDateTime, "EEEE d 'de' MMMM", { locale: es }) : 'Fecha no disponible'}
                                    </span>
                                </div>
                                <h2 className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                    {rideDateTime ? format(rideDateTime, "HH:mm") : '--:--'}
                                </h2>
                            </div>
                            <div className="text-right">
                                <div className="flex flex-col items-end">
                                    <p className={cn("text-3xl lg:text-4xl font-black tracking-tighter leading-none transition-all", isCalculatingPrice ? "opacity-20 translate-y-1" : "text-primary")}>
                                        {dynamicPricing ? dynamicPricing.pricing.totalPrice : (ride.price || 0)}€
                                    </p>
                                    {dynamicPricing && (
                                        <div className="flex flex-col items-end">
                                            <p className="text-[7px] font-black text-slate-400 uppercase tracking-tighter mt-1 line-through opacity-50">{ride.price}€ Base</p>
                                            <div className="flex items-center gap-1 text-[8px] font-black text-emerald-600 uppercase tracking-tighter">
                                                <Sparkles className="size-2 text-primary animate-pulse" />
                                                + {dynamicPricing.pricing.detourCost}€ desvío
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[9px] lg:text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">por asiento</p>
                            </div>
                        </div>

                        <div className="p-4 lg:p-6 bg-slate-50 rounded-2xl lg:rounded-3xl border border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3 lg:gap-4">
                                <Avatar className="h-12 w-12 lg:h-14 lg:w-14 border-4 border-white shadow-lg">
                                    <AvatarImage src={ride.driver?.photo_url} />
                                    <AvatarFallback className="bg-primary text-white font-black">{ride.driver?.full_name?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <p className="font-black text-slate-900 text-sm lg:text-base uppercase italic tracking-tighter">{ride.driver?.full_name}</p>
                                        {ride.driver?.verification?.status === 'verified' && <BadgeCheck size={14} className="text-emerald-500 lg:size-[16px]" />}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <Star size={10} className="fill-amber-400 text-amber-400" />
                                        <p className="text-[9px] lg:text-[10px] font-black text-slate-400">{ride.driver?.rating || 'Nuevo'}</p>
                                    </div>
                                </div>
                            </div>
                            <Link to={`/profile/${ride.driver?.id}`} className="text-[9px] lg:text-[10px] font-black text-primary uppercase tracking-widest bg-white px-3 py-2 rounded-xl shadow-sm border border-slate-100 hover:scale-105 transition-transform">Perfil</Link>
                        </div>

                        <div className="space-y-4 lg:space-y-6 relative text-left pl-2">
                            <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-100" />
                            <div className="relative flex gap-4 lg:gap-6">
                                <div className="h-5 w-5 lg:h-6 lg:w-6 rounded-full border-[3px] border-emerald-500 bg-white z-10" />
                                <div className="text-left flex-1"><p className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Origen</p><p className="font-bold text-slate-800 text-base lg:text-lg leading-tight">{ride.origin?.name || ride.origin?.address}</p></div>
                            </div>
                            <div className="relative flex gap-4 lg:gap-6">
                                <div className="h-5 w-5 lg:h-6 lg:w-6 rounded-full border-[3px] border-primary bg-slate-900 z-10" />
                                <div className="text-left flex-1"><p className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Destino</p><p className="font-bold text-slate-800 text-base lg:text-lg leading-tight">{ride.destination?.name || ride.destination?.address}</p></div>
                            </div>
                        </div>
                    </Card>

                    {isDriver && <div className="lg:block"><RideManagement ride={ride} onRefresh={fetchRideDetails} /></div>}
                </div>

                <div className="lg:col-span-4 space-y-4 lg:space-y-6">
                    {/* CENTRO SOS INTEGRADO */}
                    {isParticipant && isRideActive && (
                        <Card className="rounded-2xl lg:rounded-[2rem] border-none shadow-xl bg-red-600 p-4 lg:p-6 text-white space-y-3 lg:space-y-4 animate-pulse">
                            <div className="flex items-center gap-3">
                                <ShieldAlert size={24} className="lg:size-[28px]" />
                                <h3 className="text-base lg:text-lg font-black uppercase italic tracking-tighter">CENTRO SOS</h3>
                            </div>
                            <p className="text-[8px] lg:text-[10px] text-red-100 font-bold uppercase leading-relaxed">Úsalo solo en situaciones de peligro real.</p>
                            <Button
                                onClick={handleSOS}
                                disabled={isProcessing}
                                className="w-full h-14 lg:h-16 rounded-2xl bg-white text-red-600 font-black text-xs uppercase tracking-widest hover:bg-red-50 active:scale-95 transition-all shadow-lg"
                            >
                                {isProcessing ? <Loader2 className="animate-spin" /> : "ACTIVAR ALERTA SOS"}
                            </Button>
                        </Card>
                    )}

                    {!isDriver && (
                        <Card className="rounded-2xl lg:rounded-[2.5rem] border-none shadow-xl bg-white p-5 lg:p-8 space-y-5 lg:space-y-6 lg:sticky lg:top-24 text-left">
                            <p className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest">Tu Estado</p>
                            {activePassenger ? (
                                <div className="space-y-4 lg:space-y-6">
                                    <div className="p-4 lg:p-6 rounded-2xl lg:rounded-3xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-3 lg:gap-4">
                                        <CheckCircle className="h-5 w-5 lg:h-6 lg:w-6 shrink-0" />
                                        <p className="font-black text-xs lg:text-sm uppercase italic">Plaza Asegurada</p>
                                    </div>

                                    {myPin && (
                                        <div className="bg-slate-900 rounded-2xl lg:rounded-[2rem] p-5 lg:p-6 text-white space-y-4 shadow-2xl">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Fingerprint size={14} className="text-primary lg:size-[16px]" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Código Seguridad</span>
                                                </div>
                                                <Button size="icon" variant="ghost" onClick={copyPin} className="h-10 w-10 lg:h-11 lg:w-11 hover:bg-white/10 text-slate-400 rounded-xl active:scale-90 transition-all"><Copy size={14} /></Button>
                                            </div>
                                            <div className="flex justify-center">
                                                <div className="bg-white/5 border border-white/10 rounded-xl lg:rounded-2xl px-6 lg:px-8 py-3 lg:py-4">
                                                    <span className="text-3xl lg:text-4xl font-black tracking-[0.3em] text-primary font-mono">{myPin}</span>
                                                </div>
                                            </div>
                                            <p className="text-[7px] lg:text-[8px] font-bold text-slate-500 text-center uppercase tracking-widest leading-relaxed">
                                                Muestra este código al conductor <br /> al subir al vehículo.
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3 lg:gap-4">
                                        <Button onClick={() => navigate(`/rides/${ride.id}/chats`)} variant="secondary" className="h-14 lg:h-16 rounded-2xl font-black text-xs uppercase tracking-widest bg-white border-2 border-slate-100 shadow-sm active:scale-95 transition-all">
                                            <MessageCircle className="h-4 w-4 lg:h-5 lg:w-5 mr-2 text-primary" />
                                            CHATS
                                        </Button>
                                        <Button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${ride.destination?.lat},${ride.destination?.lng}`, '_blank')} variant="secondary" className="h-14 lg:h-16 rounded-2xl font-black text-xs uppercase tracking-widest bg-white border-2 border-slate-100 shadow-sm active:scale-95 transition-all">
                                            <Navigation className="h-4 w-4 lg:h-5 lg:w-5 mr-2 text-primary" />
                                            RUTA
                                        </Button>
                                    </div>

                                    {ride.status === 'scheduled' && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" className="w-full h-11 rounded-xl text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 hover:bg-red-50 transition-all active:scale-95">
                                                    Cancelar reserva
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent className="rounded-2xl lg:rounded-[2.5rem] border-none max-w-[90vw] lg:max-w-lg">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-lg lg:text-xl font-black uppercase italic tracking-tighter">¿Cancelar reserva?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-slate-500 text-xs lg:text-sm">
                                                        Se devolverá el importe menos un 20% por gastos de gestión y penalización.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="gap-2">
                                                    <AlertDialogCancel className="rounded-xl font-bold uppercase text-[9px] tracking-widest">Cerrar</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={async () => {
                                                            setIsProcessing(true);
                                                            try {
                                                                const { cancelBooking } = await import('@/services/rideService');
                                                                await cancelBooking(ride.id);
                                                                toast.success("Reserva cancelada");
                                                                fetchRideDetails();
                                                            } catch (e) {
                                                                toast.error(e.message);
                                                            } finally {
                                                                setIsProcessing(false);
                                                            }
                                                        }}
                                                        className="rounded-xl font-bold uppercase text-[9px] tracking-widest bg-red-600 hover:bg-red-700 text-white"
                                                    >
                                                        Confirmar
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="text-center p-4 lg:p-6 bg-slate-50 rounded-2xl lg:rounded-3xl border-2 border-dashed border-slate-200">
                                        <p className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase mb-0.5">Asientos Libres</p>
                                        <p className="text-2xl lg:text-3xl font-black text-slate-900 italic">{ride.seats_available}</p>
                                    </div>
                                    {genderLock ? (
                                        <div className="p-3 lg:p-4 bg-pink-50 text-pink-600 rounded-xl lg:rounded-2xl border border-pink-100 flex items-center gap-2 lg:gap-3">
                                            <ShieldAlert size={16} className="lg:size-[18px]" />
                                            <p className="text-[9px] lg:text-[10px] font-bold uppercase leading-tight">Exclusivo para mujeres.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <Button
                                                onClick={() => setIsSelectorOpen(true)}
                                                disabled={isProcessing || ride.seats_available <= 0}
                                                className="w-full h-16 lg:h-20 rounded-[1.8rem] lg:rounded-[2.2rem] bg-slate-900 text-white font-black text-base lg:text-lg italic shadow-elite active:scale-95 transition-all border-none"
                                            >
                                                {isProcessing ? <Loader2 className="animate-spin" /> : 'RESERVAR PLAZA'}
                                            </Button>
                                            <p className="text-[8px] lg:text-[9px] text-center font-black text-slate-400 uppercase tracking-widest px-2 leading-relaxed">
                                                Aceptas nuestras políticas al reservar.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>
                    )}
                </div>

                {/* SELECTOR PAGO */}
                <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                    <DialogContent className="max-w-[90vw] sm:max-w-[420px] rounded-2xl lg:rounded-[2.5rem] border-none shadow-2xl p-0 bg-white overflow-hidden outline-none">
                        <DialogHeader className="p-6 lg:p-8 pb-0 space-y-2 text-left">
                            <div className="flex items-center gap-3">
                                <div className="size-9 lg:size-10 bg-primary/10 rounded-xl flex items-center justify-center">
                                    <CreditCard className="h-4 w-4 lg:h-5 lg:w-5 text-primary" />
                                </div>
                                <div>
                                    <DialogTitle className="text-lg lg:text-xl font-black italic uppercase tracking-tighter text-slate-900 leading-tight">MÉTODO DE PAGO</DialogTitle>
                                    <DialogDescription className="text-[9px] font-black uppercase tracking-widest text-slate-400">Selecciona cómo deseas abonar tu reserva</DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="px-6 lg:px-8 pb-6 lg:pb-8 space-y-3 lg:space-y-4">
                            <button
                                onClick={() => handleConfirmTrip()}
                                disabled={isProcessing}
                                className="w-full group relative flex items-center gap-3 lg:gap-4 p-4 lg:p-5 rounded-2xl lg:rounded-3xl border-2 border-slate-50 bg-slate-50 hover:border-primary transition-all text-left"
                            >
                                <div className="size-10 lg:size-12 rounded-xl lg:rounded-2xl bg-white shadow-sm flex items-center justify-center">
                                    <Wallet className="h-5 w-5 lg:h-6 lg:w-6 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs lg:text-sm font-black uppercase italic tracking-tighter text-slate-900">Saldo Cartera</p>
                                    <p className="text-[9px] lg:text-[10px] font-bold text-slate-500">{wallet?.balance?.toFixed(2)}€ disp.</p>
                                </div>
                            </button>

                            <button
                                onClick={() => {
                                    setIsSelectorOpen(false);
                                    setIsPaymentModalOpen(true);
                                }}
                                className="w-full group relative flex items-center gap-3 lg:gap-4 p-4 lg:p-5 rounded-2xl lg:rounded-3xl border-2 border-slate-50 bg-slate-50 hover:border-primary transition-all text-left"
                            >
                                <div className="size-10 lg:size-12 rounded-xl lg:rounded-2xl bg-white shadow-sm flex items-center justify-center">
                                    <CreditCard className="h-5 w-5 lg:h-6 lg:w-6 text-slate-900" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs lg:text-sm font-black uppercase italic tracking-tighter text-slate-900">Tarjeta / Otros</p>
                                    <p className="text-[9px] lg:text-[10px] font-bold text-slate-400">Stripe Secure</p>
                                </div>
                            </button>
                        </div>

                        <Button
                            variant="ghost"
                            onClick={() => setIsSelectorOpen(false)}
                            className="w-full h-10 rounded-xl font-black text-[9px] uppercase tracking-widest text-slate-400"
                        >
                            Cancelar
                        </Button>
                    </DialogContent>
                </Dialog>

                {isDriver && (
                    <div className="p-6 lg:p-8 bg-slate-900 rounded-2xl lg:rounded-[2.5rem] text-white space-y-3 lg:space-y-4 shadow-2xl animate-in zoom-in duration-500">
                        <Sparkles className="size-8 lg:size-10 text-primary" />
                        <h3 className="text-lg lg:text-xl font-black uppercase italic tracking-tighter">Panel de Control</h3>
                        <p className="text-[10px] lg:text-xs text-slate-400 font-medium leading-relaxed">Gestiona pasajeros y el estado del trayecto desde el panel de gestión.</p>
                    </div>
                )}

                {!isDriver && isParticipant && !isRideCompleted && hasCheckedContacts && emergencyContacts.length === 0 && (
                    <div className="p-6 lg:p-8 bg-amber-50 rounded-2xl lg:rounded-[2.5rem] border-2 border-dashed border-amber-200 space-y-3 lg:space-y-4">
                        <div className="flex items-center gap-2 lg:gap-3 text-amber-600">
                            <Shield size={20} className="lg:size-[24px]" />
                            <h3 className="text-xs lg:text-sm font-black uppercase tracking-tighter">Seguridad</h3>
                        </div>
                        <p className="text-[10px] lg:text-xs text-amber-800 font-medium leading-relaxed">
                            Añade contactos de emergencia para viajar con más tranquilidad.
                        </p>
                        <Button
                            onClick={() => navigate('/settings/safety')}
                            variant="outline"
                            className="w-full h-10 lg:h-12 rounded-xl border-amber-300 text-amber-700 font-black text-[9px] lg:text-[10px] uppercase tracking-widest"
                        >
                            CONFIGURAR
                        </Button>
                    </div>
                )}
            </main>

            <BookingPaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => {
                    setIsPaymentModalOpen(false);
                    setIsSelectorOpen(true);
                }}
                rideId={ride.id}
                amount={dynamicPricing ? parseFloat(dynamicPricing.pricing.totalPrice) : parseFloat(ride?.price || 0)}
                pickupLocation={pickupLocation}
                pickupAddress={pickupAddress}
                onSuccess={() => {
                    setIsPaymentModalOpen(false);
                    fetchRideDetails();
                }}
            />
        </div>
    );
}

export default RideDetails;
