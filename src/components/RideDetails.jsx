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

        const channel = supabase
            .channel(`ride-tracking-${rideId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                (payload) => {
                    fetchRideDetails();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId, loading, fetchRideDetails]);

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
        if (!ride || !user) return { isDriver: false, isParticipant: false, isRideCompleted: false, genderLock: false };

        const isDriver = String(ride.driver_id) === String(user.id);
        const activePassenger = (ride.passengers || []).find(p => String(p.id) === String(user.id) && !['cancelled', 'rejected'].includes(p.status));

        const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
        const isRideCompleted = ride.status === 'completed';
        const genderLock = ride.is_women_only && String(profile?.gender).toLowerCase() !== 'female';
        const isParticipant = isDriver || !!activePassenger;

        return { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant };
    }, [ride, user, profile]);

    // EFECTO: Recalcular precio por desvío cuando cambia el punto de recogida
    useEffect(() => {
        const recalculatePrice = async () => {
            if (!pickupLocation || !ride || isDriver || activePassenger || isRideCompleted) return;

            setIsCalculatingPrice(true);
            try {
                const destLat = searchParams.get('paxDestLat');
                const destLng = searchParams.get('paxDestLng');

                const paxDestination = (destLat && destLng)
                    ? { lat: parseFloat(destLat), lng: parseFloat(destLng) }
                    : (ride.destination?.coordinates || ride.destination);

                const result = await calculateRideDetour(ride.id, pickupLocation, paxDestination);
                if (result.success) {
                    setDynamicPricing(result.data);
                }
            } catch (err) {
                console.error("Detour Calc Err:", err);
            } finally {
                setIsCalculatingPrice(false);
            }
        };
        recalculatePrice();
    }, [pickupLocation, ride, isDriver, activePassenger, isRideCompleted, searchParams]);

    const handleConfirmTrip = async () => {
        if (!ride || isProcessing) return;
        setIsProcessing(true);
        const loadingToast = toast.loading("Procesando reserva...");

        try {
            const res = await confirmTripAndPay(
                ride.id,
                null, // No es una reserva desde 'Solicitud'
                {
                    pickupLocation: pickupLocation,
                    pickupAddress: pickupAddress,
                    price: dynamicPricing ? dynamicPricing.pricing.totalPrice : ride.price
                }
            );

            if (res.success) {
                toast.success("¡Viaje reservado con éxito!", { id: loadingToast });
                setIsSelectorOpen(false);
                fetchRideDetails();
                refreshWallet();
            } else {
                throw new Error(res.message || "Error al reservar");
            }
        } catch (error) {
            toast.error(error.message || "No se pudo realizar la reserva", { id: loadingToast });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMapClick = useCallback(async (latlng) => {
        if (isDriver || activePassenger || isRideCompleted) return;
        setPickupLocation({ lat: latlng.lat, lng: latlng.lng });
        setPickupAddress("Cargando dirección...");

        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}`);
            const data = await res.json();
            if (data && data.display_name) {
                const parts = data.display_name.split(',');
                const compactAddress = parts.length > 2 ? `${parts[0].trim()}, ${parts[1].trim()}` : data.display_name;
                setPickupAddress(compactAddress);
            } else {
                setPickupAddress(`Punto: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
            }
        } catch (err) {
            console.error("Reverse Geocode Error:", err);
            setPickupAddress(`Punto: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
        }
    }, [isDriver, activePassenger, isRideCompleted]);

    const handleSOS = async () => {
        if (!user) return;
        const loadingToast = toast.loading("Enviando alerta SOS...");
        try {
            await triggerSOS(user.id, rideId);
            toast.success("Alerta enviada a tus contactos", { id: loadingToast });
        } catch (error) {
            toast.error("Error al enviar SOS", { id: loadingToast });
        }
    };

    if (loading && !ride) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="mt-4 text-slate-500 font-bold uppercase tracking-widest text-[10px]">Cargando Sharway...</p>
            </div>
        );
    }

    if (!ride) return <SubPageHeader title="No encontrado" backPath="/explore" />;

    const rideDateTime = ride.dateTime;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-24">
            <SubPageHeader title="Detalles del Viaje" backPath="/explore" />

            <div className="max-w-4xl mx-auto px-4 lg:px-0 space-y-6 lg:space-y-10 mt-6 mb-20">
                {/* MAPA PREMIUM */}
                <div className="h-[250px] lg:h-[400px] w-full rounded-[2rem] lg:rounded-[3rem] overflow-hidden shadow-diamond relative group border-4 border-white">
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

                {pickupAddress && (
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
                            <div className="flex items-center gap-2 mt-3">
                                <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest", ride.seats_available > 0 ? "bg-primary/10 text-primary" : "bg-red-100 text-red-600")}>
                                    <Users size={12} />
                                    <span>{ride.seats_available > 0 ? `${ride.seats_available} PLAZAS LIBRES` : 'VIAJE COMPLETO'}</span>
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="flex flex-col items-end">
                                <p className={cn("text-3xl lg:text-4xl font-black tracking-tighter leading-none transition-all", isCalculatingPrice ? "opacity-20 translate-y-1" : "text-primary")}>
                                    {dynamicPricing ? dynamicPricing.pricing.totalPrice : (ride.price || 0)}€
                                </p>
                                {dynamicPricing && (
                                    <p className="text-[9px] font-bold text-slate-400 line-through decoration-red-500/50 mt-1">{ride.price}€</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 lg:gap-6">
                        <div className="bg-slate-50 p-4 lg:p-5 rounded-2xl lg:rounded-3xl space-y-1">
                            <p className="text-[8px] lg:text-[9px] font-black text-slate-400 uppercase tracking-widest">Origen</p>
                            <p className="text-xs lg:text-sm font-black text-slate-900 line-clamp-2 leading-snug">{ride.origin?.address || ride.origin}</p>
                        </div>
                        <div className="bg-slate-50 p-4 lg:p-5 rounded-2xl lg:rounded-3xl space-y-1">
                            <p className="text-[8px] lg:text-[9px] font-black text-slate-400 uppercase tracking-widest">Destino</p>
                            <p className="text-xs lg:text-sm font-black text-slate-900 line-clamp-2 leading-snug">{ride.destination?.address || ride.destination}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl lg:rounded-3xl">
                        <div className="flex items-center gap-3">
                            <Avatar className="size-10 lg:size-12 rounded-xl lg:rounded-2xl border-2 border-white shadow-md">
                                <AvatarImage src={ride.driver.photo_url} />
                                <AvatarFallback className="font-black text-primary bg-primary/10">{ride.driver.full_name?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="text-left">
                                <h4 className="text-xs lg:text-sm font-black text-slate-900 uppercase italic tracking-tighter flex items-center gap-1.5 leading-none">
                                    {ride.driver.full_name}
                                    {ride.driver.verification?.status === 'verified' && <BadgeCheck className="size-3.5 lg:size-4 text-primary fill-primary/10" />}
                                </h4>
                                <div className="flex items-center gap-1 mt-1">
                                    <Star className="size-3 text-amber-400 fill-amber-400" />
                                    <span className="text-[10px] font-bold text-slate-500">{ride.driver.rating || '5.0'}</span>
                                </div>
                            </div>
                        </div>
                        {isParticipant && <Link to={`/chat/${rideId}`} className="size-10 lg:size-12 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center text-primary shadow-sm hover:scale-110 active:scale-95 transition-all"><MessageCircle size={20} /></Link>}
                    </div>

                    {!isRideCompleted && (
                        <div className="pt-2">
                            {activePassenger ? (
                                <div className="space-y-4">
                                    {myPin && activePassenger?.status === 'confirmed' && (
                                        <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-diamond text-center space-y-3 relative overflow-hidden group">
                                            <div className="absolute inset-0 bg-gradient-premium opacity-10 group-hover:opacity-20 transition-opacity" />
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Tu PIN de llegada</p>
                                            <p className="text-5xl font-black italic tracking-tighter animate-pulse-elite leading-none">{myPin}</p>
                                            <p className="text-[9px] text-slate-400 font-medium px-4 leading-relaxed">Díselo al conductor cuando llegues al destino para completar el pago.</p>
                                        </div>
                                    )}
                                    {(activePassenger?.status === 'verified' || activePassenger?.status === 'on_board') && (
                                        <div className="bg-emerald-500 text-white p-6 rounded-3xl shadow-diamond text-center space-y-3 relative overflow-hidden group">
                                            <div className="absolute inset-0 bg-white/10 opacity-10 group-hover:opacity-20 transition-opacity" />
                                            <div className="bg-white/20 size-12 rounded-2xl flex items-center justify-center mx-auto mb-2">
                                                <BadgeCheck className="size-8" />
                                            </div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Estado del Pasajero</p>
                                            <p className="text-3xl font-black italic tracking-tighter leading-none">YA ESTÁS A BORDO</p>
                                            <p className="text-[9px] text-emerald-100 font-medium px-4 leading-relaxed italic">Tu viaje ha sido verificado. ¡Disfruta del trayecto!</p>
                                        </div>
                                    )}
                                    <Button onClick={handleSOS} variant="destructive" className="w-full h-14 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all">
                                        <ShieldAlert size={18} className="mr-2" /> ENVIAR ALERTA SOS
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {isDriver ? (
                                        <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20">
                                            <p className="text-[10px] text-center font-bold text-primary uppercase tracking-widest italic">Eres el conductor de este viaje</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <Button
                                                data-testid="booking-button"
                                                onClick={() => setIsSelectorOpen(true)}
                                                disabled={isProcessing || ride.seats_available <= 0 || genderLock}
                                                className={cn(
                                                    "w-full h-16 lg:h-20 rounded-[1.8rem] lg:rounded-[2.2rem] font-black text-base lg:text-lg italic shadow-elite active:scale-95 transition-all border-none",
                                                    genderLock ? "bg-pink-100 text-pink-600 cursor-not-allowed" : "bg-slate-900 text-white"
                                                )}
                                            >
                                                {isProcessing ? <Loader2 className="animate-spin" /> : (genderLock ? 'SOLO PARA MUJERES' : 'RESERVAR PLAZA')}
                                            </Button>
                                            <p className="text-[8px] lg:text-[9px] text-center font-black text-slate-400 uppercase tracking-widest px-2 leading-relaxed">
                                                Aceptas nuestras políticas al reservar.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </Card>

                {isDriver && (
                    <div className="mt-8 animate-in zoom-in duration-500">
                        <RideManagement
                            ride={ride}
                            onUpdate={fetchRideDetails}
                            wallet={wallet}
                        />
                    </div>
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

            <BookingPaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                ride={ride}
                pickupLocation={pickupLocation}
                pickupAddress={pickupAddress}
                dynamicPrice={dynamicPricing?.pricing.totalPrice}
                onSuccess={() => {
                    fetchRideDetails();
                    refreshWallet();
                }}
            />
        </div>
    );
}

export default RideDetails;
